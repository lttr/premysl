# Premysl Glossary

The canonical terms for Premysl's access model. Premysl is a single-tenant,
self-hosted assistant: in normal use exactly one person — the **owner** — uses it.

## Access modes

**Open mode**:
The access mode where the app is ungated: anyone reaching it is served, no login
required. Selected when `NUXT_PUBLIC_REQUIRE_AUTH` is off. Typically how the app
runs locally during development.
_Avoid_: local mode, anonymous mode, dev mode

**Locked mode**:
The access mode where only the **owner** may obtain a session or access any data.
Selected when `NUXT_PUBLIC_REQUIRE_AUTH` is on. Typically how the app runs in
production. Fails closed: with no owner handle configured, no one is authorized.
_Avoid_: auth mode, production mode, private mode

## Identity

**Owner**:
The single GitHub account permitted to use the app in **locked mode**, identified
by the `NUXT_OWNER_GITHUB_HANDLE` configuration. The match is case-insensitive.
In locked mode, having a session implies being the owner — no other account is
ever issued one.
_Avoid_: admin, user, account

**Local user**:
The fixed anonymous identity (`id: "local"`) that owns every chat created in
**open mode**. Constant by design — not per-session — so locally-created chats
all belong to one identity and survive cookie or browser changes.
_Avoid_: guest, anonymous user, default user

## Transitions

**Adoption**:
The one-time reassignment of every **local user** chat to a real account on first
GitHub login, so work done in **open mode** is not orphaned when the app is later
opened by a logged-in **owner**.
_Avoid_: migration, claiming, import

## GitHub integration

**GitHub connection**:
The stored GitHub credential — the OAuth access token (with `repo` scope) kept
after the **owner** logs in — that grants Premysl the ability to call the GitHub
API on the owner's behalf. Exists independently of which repositories are chosen:
it answers "can we talk to GitHub at all".
_Avoid_: GitHub integration, GitHub auth, token (when the credential as a concept is meant)

**Linked repository**:
A specific GitHub repository the **owner** has chosen to associate with the
account so the assistant may retrieve data from it. The act is **linking**. A
linked repository answers "which repositories are in scope for retrieval",
distinct from the **GitHub connection** that makes retrieval possible at all.
_Avoid_: associated repository, connected repository, repo source

## Retrieval

**Snapshot**:
The local copy of a **linked repository**'s markdown files, extracted from a
repository archive downloaded at a point in time, that the assistant searches
during retrieval. The archive carries no git history, so the snapshot is shallow,
and only markdown is kept on disk. A snapshot is a frozen materialization, not a
live view: its contents change only when the owner **refreshes** it.
_Avoid_: cache, clone, mirror, index

**Refresh**:
The owner-initiated re-download that replaces a **linked repository**'s
**snapshot** with its current GitHub contents. Manual and on-demand only; there
is no automatic, scheduled, or webhook-driven refresh.
_Avoid_: sync, pull, update, reindex

**Grep retrieval**:
The retrieval method that searches **snapshots** with ripgrep over the question's
keywords and ranks files by match count, returning whole small files or a line
window around each match. One of the two methods a chat may use, selected by its
**retrieval mode**. Operates directly on the snapshot's files; needs no
preparation beyond the snapshot itself.
_Avoid_: text search, keyword search, lexical search

**RAG retrieval**:
The retrieval method that splits **snapshots** into chunks, ranks them against the
question by combining semantic similarity (embeddings) with keyword scoring
(BM25), and returns the best-matching chunks. The other method a chat may use,
selected by its **retrieval mode**. Hybrid by design: it is not purely semantic,
since the keyword half runs alongside the embedding half.
_Avoid_: semantic search, vector search, embeddings search

**Retrieval mode**:
The per-chat choice of which retrieval method — **grep retrieval** or **RAG
retrieval** — that chat uses. Fixed for the chat so every answer in it is
attributable to one method, which is what makes the two methods comparable.
_Avoid_: search mode, retrieval strategy, RAG toggle

## Example dialogue

> **Dev:** I ran it locally and never logged in, but my chats still saved. Whose
> are they?
>
> **Maintainer:** You were in open mode, so every request resolved to the local
> user — one fixed anonymous identity. That's why they persisted across restarts.
>
> **Dev:** Then I deployed and turned on locked mode. Now the login screen rejects
> my colleague.
>
> **Maintainer:** Right — in locked mode only the owner gets a session. Your
> colleague's GitHub handle isn't the configured owner handle, so it fails closed.
>
> **Dev:** And the chats I made locally?
>
> **Maintainer:** The first time you log in as the owner, adoption reassigns all
> local-user chats to your account. Nothing gets orphaned.
