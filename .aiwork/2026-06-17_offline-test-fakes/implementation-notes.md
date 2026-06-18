# Implementation notes

## Step 1 — LLM fake + grep seed (done)

### What shipped

- **`server/utils/fake-externals.ts`** — `fakeExternalsEnabled()` (gate: `import.meta.dev`
  AND `useRuntimeConfig().fakeExternals === "1"`) and `fakeLanguageModel(modelId)`, a
  `MockLanguageModelV3` (`ai/test`) that returns the same canned text from both `doStream`
  (chat) and `doGenerate` (lazy titles). Stream built with `simulateReadableStream` from
  `ai` (the `ai/test` export is deprecated).
- **`server/utils/ai-models.ts`** — `resolveModel` returns the fake when the flag is on,
  before touching any real provider.
- **`server/routes/test/seed-repo.get.ts`** — guarded fixture seed: writes a small markdown
  tree + `.dates.json` manifest under `.data/repos/<id>` and inserts one `linkedRepositories`
  row for the current (test-login) user. Idempotent. Returns the linked-repo JSON.
- **`server/routes/auth/test-login.get.ts`** — the prerequisite session seam, reworked to be
  lint-clean: reads flags via `useRuntimeConfig` and gates on `import.meta.dev` instead of
  `process.env` (the project bans `process.env` outside config files).
- **`nuxt.config.ts`** — added server-only runtime config: `allowTestLogin`, `testGithubToken`,
  `fakeExternals` (bound to `NUXT_ALLOW_TEST_LOGIN` / `NUXT_TEST_GITHUB_TOKEN` /
  `NUXT_FAKE_EXTERNALS`).
- **`.env.example`** — documented the three test-only flags.

### Decisions / deviations from spec

- **Production guard is `import.meta.dev`, not `NODE_ENV !== "production"`.** The project lints
  `process.env` out of server code; `import.meta.dev` compiles to `false` in a production
  build, so the whole fake path is tree-shaken out (strictly stronger fail-closed). Caveat:
  fakes only activate under `nuxt dev` — a built preview (`node .output/server`) will not enable
  them. e2e here runs the dev server on :5040, so this is fine.
- **LLM response is canned** (spec default). Upgrade to programmable (branch on last message,
  emit a tool call) only when a test needs to assert tool-calling.
- Seed route lives at `GET /test/seed-repo` and operates on the logged-in test user, so the
  e2e flow is: `GET /auth/test-login` → `GET /test/seed-repo` → chat in grep mode.

### Verified

`vp run verify` passes (vp check, eslint type-aware, nuxt typecheck, fallow dead-code, nuxt build).

## Step 2 — GitHub fake (done)

### What shipped

- **`server/utils/fake-externals.ts`** — added the shared GitHub fixtures and helpers:
  `FAKE_REPO_FULL_NAME` / `FAKE_DEFAULT_BRANCH` / `FAKE_COMMIT_SHA` / `FAKE_COMMIT_DATE` /
  `FAKE_GITHUB_TOKEN`, the `FAKE_FIXTURE_FILES` markdown tree (single source of truth),
  `fakeOwnerRepos()` (picker list), and `fakeRepoMeta()`.
- **`server/utils/github.ts`** — each chokepoint short-circuits when `fakeExternalsEnabled()`:
  `requireGithubToken` returns `FAKE_GITHUB_TOKEN` (so the flow works with no real PAT),
  `listOwnerRepos` → `fakeOwnerRepos()`, `getRepoMeta` → `fakeRepoMeta()`, and
  `downloadAndExtractSnapshot` → new `writeFakeSnapshot()` which writes the fixture tree +
  `.dates.json` (replace-wholesale, per-file date = fixture commit date), mirroring the real
  download's semantics.
- **`server/routes/test/seed-repo.get.ts`** — refactored to consume the shared
  `FAKE_FIXTURE_FILES`/constants instead of its own copies (no divergence). Still a shortcut
  that skips RAG indexing; use the real link flow (`POST /api/repos/linked`) for RAG fixtures.

### Outcome

The full link / refresh flow (`/api/repos/available`, `/api/repos/linked`, `…/refresh`) runs
offline with no GitHub token: picker lists fixtures, link builds the snapshot through the app's
own code path, and RAG indexing runs (via step 3's Voyage fake).

## Step 3 — Voyage fake (done)

### What shipped

- **`server/utils/fake-externals.ts`** — `fakeEmbedding(text, dims)`: a normalized
  bag-of-words FNV-1a hash vector. Tokens hash into `dims` buckets; shared words → nearby
  vectors under cosine distance, so RAG ranking over fixtures is deterministic and stable.
  `dims` is a parameter (not imported) to avoid a circular module dependency with voyage.ts.
- **`server/utils/voyage.ts`** — `embedDocumentChunks` and `embedQuery` short-circuit to
  `fakeEmbedding(_, EMBEDDING_DIMENSIONS)` when the flag is on, before any network call.

### Outcome

RAG-mode chat indexes (at link/refresh) and retrieves offline and deterministically, with no
`VOYAGE_API_KEY` required.

### Decisions / deviations

- Fake embeddings are lexical (bag-of-words), not truly semantic — sufficient for stable,
  assertable RAG ranking over fixtures; the spec only requires "semantically similar text
  yields nearby vectors," which word overlap satisfies for fixture content.
- Empty text yields a zero vector (norm guarded by `|| 1`); fixture chunks are never empty so
  `vector_distance_cos` stays well-defined in practice.

### Verified

`vp run verify` passes (after `vpx nuxi prepare` to refresh auto-import types for the new
fake-externals exports — the WATCH OUT from step 1 recurred for the new exports).

## Runtime smoke test (done — all three fakes verified offline)

Driven over HTTP against `nuxt dev` with `NUXT_FAKE_EXTERNALS=1` (open mode, test-login as
`tester`). Results:

- **LLM fake** — `POST /api/chats/<id>` streamed the canned deterministic reply token-by-token,
  `finishReason: "stop"`, http 200. No provider call.
- **GitHub fake** — `GET /api/repos/available` returned the fixture list; `POST /api/repos/linked`
  built the snapshot through the app's own code path (README.md + notes/widgets.md +
  notes/deployment.md + `.dates.json` on disk); `POST …/refresh` succeeded. No GitHub call, no PAT.
- **Voyage fake** — link/refresh indexed 3 chunks into `repo_chunks` (embedding = 4096 bytes =
  1024 × f32, matching `EMBEDDING_DIMENSIONS`) plus 3 FTS rows. `searchRagChunks` ranked sensibly
  and identically across runs: "widget…" → widgets.md, "deployment…" → deployment.md,
  "fixture…" → README.md. No Voyage call, no key.

### Bug found and fixed during the smoke test

`fakeExternalsEnabled()` and test-login compared the flag with `=== "1"`, but Nuxt parses
runtime-config env overrides with **destr**, so `NUXT_FAKE_EXTERNALS=1` arrives as the **number
`1`** (and `=true` as boolean `true`), never the string. Every gate silently failed closed at
runtime even though `verify` (build-time) passed. Replaced the string compares with a truthy
`flagEnabled(value)` helper (`server/utils/fake-externals.ts`), used by the fake gate and
test-login. Public config (`requireAuth`) was unaffected because it is already read as a boolean.

### Single-switch simplification (per request)

`NUXT_FAKE_EXTERNALS=1` is now the only var needed for offline dev: it also enables test-login
(folded into the fake gate) and test-login now defaults the impersonated handle to `"tester"`
when no owner is configured. `NUXT_ALLOW_TEST_LOGIN` / `NUXT_TEST_GITHUB_TOKEN` remain for the
separate "test-login against the real externals" case. `.env.example` updated accordingly.

### Dev-server env caveat (for future smoke tests)

`vp run dev` / `nuxt dev` rebuild the Nitro worker's env from `.env` and drop inline `NUXT_*`
vars passed on the command line — they do not reach `useRuntimeConfig()`. To run with test flags
without touching the real `.env`, launch `./node_modules/.bin/nuxt dev --dotenv <file>` pointing
at an alternate dotenv (all externals faked, so only a dev `NUXT_SESSION_PASSWORD` is needed).
