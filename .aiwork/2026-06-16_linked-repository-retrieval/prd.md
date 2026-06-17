---
status: draft
glossary_terms: [GitHub connection, Linked repository, Snapshot, Refresh, Owner]
adrs: [0001-github-oauth-for-repo-linking, 0002-repo-retrieval-via-archive-and-ripgrep]
---

# PRD: Linked Repository Retrieval

## Problem Statement

The owner keeps a lot of knowledge in GitHub repositories — especially markdown
docs and notes — and wants the assistant to answer from that material. Today the
assistant has no access to any repository content: it can authenticate the owner
via GitHub, but it cannot see, search, or cite anything inside the owner's repos.
The owner has to copy-paste relevant snippets into the chat by hand.

## Solution

From the left sidebar, the owner opens a picker, searches their own GitHub
repositories, and links the ones they want the assistant to use as sources.
Linking downloads a snapshot of the repository's files to the server. From then
on, when the owner asks a question in chat, the assistant can call a retrieval
tool that text-searches across all linked snapshots and pulls the relevant pieces
of files (a small whole file, or a window of lines around the match) back as context,
so its answers are grounded in the owner's own repositories and can cite where
each piece came from. When a repository changes on GitHub, the owner presses a
refresh button to re-download its snapshot.

## User Stories

### Linking and the connection

1. As the owner, I want my GitHub login to also grant repository access, so that I
   do not have to do a separate "connect GitHub" step before I can link repos.
2. As the owner, I want the app to keep my GitHub connection after I log in, so
   that it can call the GitHub API on my behalf during my session.
3. As the owner, I want to open a repository picker from a control in the left
   sidebar, so that linking is reachable from where I already work with chats.
4. As the owner, I want to search my repositories by name in the picker, so that I
   can find the one I want without scrolling a long list.
5. As the owner, I want the picker to show only repositories I own (public and
   private), so that the list reflects what I think of as "my" repos and stays
   short.
6. As the owner, I want to select a repository and link it, so that it becomes a
   source the assistant may retrieve from.
7. As the owner, I want linking to be confirmed visually, so that I know the repo
   is now in scope for retrieval.
8. As the owner, I want a snapshot of a repository to be downloaded the moment I
   link it, so that it is immediately searchable without an extra step.
9. As the owner, I want to see the list of repositories I have already linked, so
   that I know what the assistant currently has access to.
10. As the owner, I want to unlink a repository, so that it is no longer used as a
    source and its snapshot is removed from the server.
11. As the owner, I want a repository I already linked to be indicated in the
    picker, so that I do not link it twice.

### Refreshing snapshots

12. As the owner, I want a refresh button on each linked repository, so that I can
    pull its latest GitHub contents on demand.
13. As the owner, I want to see when a snapshot was last refreshed, so that I can
    judge whether it is current.
14. As the owner, I want refresh to replace the snapshot with the current default
    branch contents, so that subsequent searches reflect my latest docs.
15. As the owner, I want to understand that snapshots only update when I refresh
    them, so that I am not surprised by stale results after pushing to GitHub.

### Retrieval in chat

16. As the owner, I want the assistant to search my linked repositories when I ask
    a question, so that its answers draw on my own material.
17. As the owner, I want the assistant to search across all my linked repositories
    in one step, so that I do not have to tell it which repo to look in.
18. As the owner, I want the assistant to return the relevant piece of a file
    rather than just a single matching line, so that the context is coherent
    enough to answer from.
19. As the owner, I want retrieved results to identify the repository, file path,
    and location, so that the assistant can cite where an answer came from and I
    can open the source.
20. As the owner, I want retrieval to work over markdown docs, so that my notes
    and documentation are first-class sources.
21. As the owner, I want the assistant to tell me when it found nothing relevant,
    so that I can rephrase or link a different repository.
22. As the owner, I want the retrieval results to render readably in the chat, so
    that I can see the matched snippets and their sources inline.

### Access and safety

23. As the owner in locked mode, I want only my account to be able to link repos
    and trigger retrieval, so that no one else can reach my repositories through
    the app.
24. As the owner, I want my GitHub credential to live only in my session, so that
    there is no long-lived repository token stored at rest.
25. As the owner, I want my linked repositories and snapshots to survive a
    redeployment, so that I do not have to re-link after every deploy.

## Implementation Decisions

### Access and connection

- The existing GitHub login is extended to request the `repo` scope. There is no
  separate connect flow (ADR 0001). The OAuth handler captures the returned access
  token and stores it in the `nuxt-auth-utils` session in a server-only
  (`secure`) field; it is never sent to the client and never persisted to the
  database.
- All new server handlers that touch linked repositories or snapshots call the
  existing server gate so that, in locked mode, only the owner is served and the
  feature fails closed.
- Because the token is session-only, every operation that needs GitHub (listing
  repos, downloading/refreshing a snapshot) happens inside an authenticated
  request the owner made. There is no background, scheduled, or webhook-driven
  work (ADR 0001, ADR 0002).

### Repository picker

- A new control in the left sidebar opens the picker. The picker lists only repos
  the owner owns, public and private, via the authenticated GitHub API filtered to
  owner affiliation.
- The picker fetches the owner's repository list once (paginated) and filters
  client-side as the owner types. Server-side search is deferred unless the list
  grows into the hundreds.
- For each repository the app retains its full name (`owner/name`), which keys the
  snapshot and the linked-repository record. A repository renamed on GitHub must
  be re-linked.

### Data model

- A new `linkedRepositories` table is added, following existing schema conventions
  (UUID primary key, `user_id` foreign key with cascade delete, integer timestamp
  columns). Columns: an id, the owning user id, the full name, the default branch,
  the on-disk snapshot location, a last-refreshed timestamp, and a created-at
  timestamp.
- The migration is generated with the project's Drizzle tooling; applied
  migrations are never hand-edited.

### Snapshots

- A snapshot is created by downloading the repository archive (tarball) for the
  repository's default branch via the GitHub API and extracting it into a plain
  directory under the persistent `.data` volume (e.g. `.data/repos/<id>/`). This
  volume is already mounted in production, so snapshots survive redeployment. The
  on-disk layout is used because retrieval needs a real directory tree to search;
  NuxtHub Blob is intentionally not used for snapshots (ADR 0002).
- The initial snapshot is downloaded automatically when a repository is linked.
- Refresh is owner-initiated and manual only: a refresh action re-downloads the
  archive and replaces the snapshot, updating the last-refreshed timestamp. There
  is no automatic refresh.
- Unlinking a repository deletes both its `linkedRepositories` record and its
  on-disk snapshot.

### Retrieval tool

- A new custom retrieval tool is added under the project's tools directory,
  alongside the existing tools, defining its input schema and execute function in
  the same style.
- The tool's input is a single free-text query. It has no repository argument: it
  searches the snapshots of all of the owner's linked repositories.
- Search is performed by running ripgrep over the snapshot directories. For each
  match the tool returns the repository identity, the file path, the matched
  location, and the relevant piece of the file: the whole file when it is under a
  size cap, otherwise a window of lines around the match. Markdown-section-aware
  extraction is deferred (see Out of Scope).
- `buildTools()` in the core chat endpoint becomes per-request so the retrieval
  tool can close over the authenticated user id (to resolve that user's linked
  repositories) and the session GitHub token. This is a change from the current
  static tool object.

### Rendering

- A new tool-render component is added under the chat tool components directory and
  wired into the message content dispatch by tool name, in the same pattern as the
  existing chart and weather tools. It renders the retrieved snippets with their
  repository and file-path provenance.

## Testing Decisions

- The project has no automated test infrastructure (no test runner, no test
  files) and explicitly states "No unit tests." This PRD does not introduce a test
  harness. Verification is the existing pre-push gate (`vp run verify`: format
  check, lint, typecheck, dead-code, build) plus manual exercise via the dev
  server.
- A good check here exercises external behavior, not internals: link a repo and
  confirm a snapshot appears under the data volume; ask a question whose answer
  lives in a linked repo and confirm the assistant retrieves and cites it; press
  refresh after changing the repo and confirm new content is found; unlink and
  confirm the snapshot is gone and retrieval no longer returns it; in locked mode,
  confirm a non-owner cannot reach any of the endpoints.
- If automated tests are ever added, the highest useful seams are: the HTTP
  endpoints (request to response) for listing/linking/unlinking/refreshing, and
  the pure "search a snapshot directory and shape the result" function, which
  takes a directory and a query and needs no network. The GitHub-facing calls
  (repo listing, tarball download) are the parts that would need a fake.
- There is no prior art for tests in this codebase; the prior art for manual
  verification is the documented `vp run verify` gate and `vp dev`.

## Out of Scope

- RAG / semantic retrieval (embeddings, vector search). This is the deliberate
  phase 2; phase 1 is text search over snapshots only.
- Repositories the owner does not own (collaborator and organization repos).
- Automatic, scheduled, or webhook-driven snapshot refresh, and any background or
  offline repository work.
- Persisting the GitHub token at rest (would only be needed for the foreclosed
  background work; revisiting it means amending ADR 0001).
- Writing to repositories, opening issues/PRs, or any GitHub action beyond reading
  content.
- Branch selection: snapshots track the repository's default branch only.
- Per-chat repository scoping: linked repositories are account-level and available
  to all of the owner's chats.
- Markdown-section-aware result extraction. Phase 1 returns whole small files or a
  line window; returning the enclosing markdown section is a later refinement.
- Indexing or searching files larger than what is reasonable to return as context;
  binary assets are not a retrieval target.

## Further Notes

- Phase 1 deliberately downloads whole repositories and searches them locally
  rather than using GitHub's code-search API, whose limits (default branch only,
  384 KB file cap, ~9 requests/minute, weak keyword matching over prose) make it a
  poor fit for a docs assistant. The on-disk snapshots are also the natural input
  for the future RAG phase (ADR 0002).
- Markdown is the primary expected content, and docs files are typically small
  enough to return whole; larger files fall back to a line window around the match.
  Markdown-section-aware extraction is a later refinement, not part of phase 1.
- Freshness is bounded by the owner's last manual refresh, which is acceptable for
  a personal, request-time assistant.
- Glossary terms used here are canonical: GitHub connection, Linked repository
  (the act is linking), Snapshot, Refresh, Owner. Avoid the aliases listed in
  GLOSSARY.md.
