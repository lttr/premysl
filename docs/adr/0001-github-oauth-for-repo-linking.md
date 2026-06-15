# GitHub OAuth (repo scope) for linking repositories

To let the owner link GitHub repositories (the **GitHub connection** and
**linked repository** in GLOSSARY.md) and later retrieve data from them, we
extend the existing GitHub login to request the `repo` scope and store the
returned access token in the `nuxt-auth-utils` session. Retrieval always happens
inside an authenticated chat turn the owner made, so the session always carries
the token exactly when it is needed — no separate credential store. Only the
_selection_ of linked repos is persisted (the `linkedRepositories` table); the
credential is not.

## Considered Options

- **OAuth App + `repo` scope (chosen).** Reuses the login that already exists,
  gives an in-app "pick from your repos" UX, and makes the association plain app
  state. Cost: `repo` is all-or-nothing read/write to every repo the owner can
  reach. Acceptable here — it is the owner's own token in the owner's own
  single-tenant, self-hosted app, used only by the owner.
- **GitHub App installation (rejected).** Fine-grained, repo-by-repo consent at
  GitHub's install screen, but the most moving parts: app registration,
  installation callback, and installation tokens that expire hourly and need JWT
  refresh. Overkill for one user.
- **Fine-grained PAT pasted into settings (rejected).** Simplest to build and
  scoped to chosen repos, but offloads token creation and rotation onto the user
  and stores a long-lived credential out of band, with no in-app repo picker.

## Consequences

- Every owner login consents to `repo`; there is no separate "Connect GitHub"
  flow.
- The token lives only in the session. This forecloses background/offline repo
  work (webhook-driven indexing, cron) with no active session. The stated use is
  request-time Q&A, so this is acceptable; a persisted token can be added later
  if offline access is ever needed.
- The retrieval tool must be built per-request (closing over the session token
  and userId), unlike the current static `buildTools` in
  `server/api/chats/[id].post.ts`.
