# Spec: offline-test fakes for behind-auth functionality

## Goal

Let automated tools (e2e / agent-browser) exercise the full behind-auth surface of
Premysl **without hitting external systems**, deterministically and for free. After
this work, when the real integrations are wired up and an error occurs, it can only
be in the integration glue itself — everything the app does _around_ the externals
is already covered offline.

## Problem

Three external boundaries sit behind auth. Two of them are needed at request time:

| Boundary                      | Chokepoint                                                       | Hit by                                            | At query time?            |
| ----------------------------- | ---------------------------------------------------------------- | ------------------------------------------------- | ------------------------- |
| LLM provider                  | `resolveModel(key)` in `server/utils/ai-models.ts`               | `chats/[id].post.ts` streaming                    | Yes                       |
| Voyage embeddings             | `embedQuery` / `embedDocumentChunks` in `server/utils/voyage.ts` | RAG index + RAG query                             | RAG only                  |
| GitHub API (`api.github.com`) | `server/utils/github.ts` (list + snapshot download)              | `repos/available`, `repos/linked.post`, `refresh` | No — only on link/refresh |

Grep retrieval (`server/utils/retrieval.ts`) is already fully local — bundled ripgrep
over the on-disk snapshot directory, no network. A "linked repository" is just three
local things: a `linkedRepositories` row, a file tree at `snapshotPath`
(`.data/repos/<id>`), and (for RAG) `repoChunks` rows.

`github.ts` and `voyage.ts` hardcode their base URLs (`GITHUB_API`,
`VOYAGE_ENDPOINT`) with no env override, so HTTP-level interception would itself
require code changes. Faking at the function seam is cleaner and faster.

## Approach

One env flag, three function-level fakes, plus a session seam.

### Flag

`NUXT_FAKE_EXTERNALS=1`, honored only when `NODE_ENV !== "production"` (same
fail-closed guard as the `test-login` endpoint). When off, behavior is unchanged.

### Session seam (prerequisite, already built)

`server/routes/auth/test-login.get.ts` — guarded by `NUXT_ALLOW_TEST_LOGIN=1`,
mints a session without the GitHub OAuth round-trip. Impersonates
`NUXT_OWNER_GITHUB_HANDLE` so it passes the locked-mode owner gate; upserts a real
`users` row (because `linkedRepositories`/`repoChunks` FK to it). Already in the tree.

## The three points

### 1. LLM + grep (highest value, no Voyage)

- Fake `resolveModel(key)`: when the flag is on, return a `MockLanguageModelV3`
  (from `ai/test`, verified present in `ai@6.0.185`) that streams a deterministic
  response via `simulateReadableStream`.
- Start with a **canned** stream. Make it **programmable** (branch on the last user
  message, optionally emit a repo-search tool call then a final answer) only when a
  test needs to assert tool-calling behavior.
- Seed seam: a tiny seed script that writes a fixture file tree to a `snapshotPath`
  under `.data/repos/` plus the dates manifest, and inserts one `linkedRepositories`
  row for the test user. This lets grep-mode chat run with zero network.
- **Outcome:** log in → seeded grep repo → chat → deterministic streamed answer with
  tool calls, fully offline.

### 2. GitHub fake (link / refresh flow)

- Fake the `github.ts` chokepoints: list-available returns a fixed fixture repo list;
  the snapshot download writes a small fixture file tree to `snapshotPath` (instead
  of fetching + extracting a tarball) and produces a fixed `commitSha`.
- **Outcome:** the link/refresh flow itself becomes testable, so step 1's seed script
  is no longer required — the app builds the snapshot through its own code path.

### 3. Voyage fake (RAG-mode chat)

- Fake `embedQuery` / `embedDocumentChunks`: deterministic hash-of-text vectors
  (1024-dim, matching `EMBEDDING_DIMENSIONS`), constructed so semantically similar
  text yields nearby vectors and RAG ranking over fixtures is stable.
- **Outcome:** RAG-mode chats index and retrieve offline and deterministically.

## Build order

1, then 2, then 3 — as listed. Step 1 alone makes most of the app testable offline.

- [x] **1. LLM + grep** — done. See `implementation-notes.md`.
- [x] **2. GitHub fake** (link / refresh flow) — done.
- [x] **3. Voyage fake** (RAG-mode chat) — done.

## Out of scope

- Mocking external HTTP at the transport layer.
- A test runner / harness choice and the actual test cases — this spec delivers the
  seams; tests consume them.
- Faking the real integration tests: those run deliberately with real keys and are
  the thing this work lets us trust as the _only_ remaining failure surface.

## Constraints / verification

- All fakes fail closed in production (`NODE_ENV` guard) and are off by default.
- Never wire any fake or the `test-login` endpoint into the UI.
- Run `vp run verify` before pushing (oxc lint is type-aware; `nuxt build`/typecheck
  are the real check for `hub:db` imports).

## Open question

Fake LLM response policy: canned (simplest) vs programmable (assert tool calls).
Default to canned; upgrade per test need.
