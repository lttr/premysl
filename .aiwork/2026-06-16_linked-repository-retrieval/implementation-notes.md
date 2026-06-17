# Implementation Notes — Linked Repository Retrieval

Running log of how the implementation interprets or diverges from
`prd.md` + `visual-spec.html`. Updated as work proceeds.

## Naming / structure decisions

- **Tool name: `repo_search`.** The spec calls it "the retrieval tool" without a
  wire name. `repo_search` matches the snake_case of the existing provider tools
  (`web_search`) and is what the renderer dispatches on in `MessageContent.vue`.
- **Tool definition split shared/server.** `chartTool`/`weatherTool` live wholly
  in `shared/utils/tools/` because their `execute` is browser-safe. The retrieval
  tool's `execute` needs `node:fs` + ripgrep + the DB, so it cannot ship to the
  client. Split: `shared/utils/tools/repo-search.ts` holds the input/output zod
  schemas and a no-`execute` `repoSearchTool` placeholder (sole purpose: typing
  `RepoSearchUIToolInvocation` for the renderer). The executable tool is built
  per-request in `server/api/chats/[id].post.ts` from the same shared schemas.
- **Endpoints under `/api/repos/`.**
  - `GET  /api/repos/available` — owner's GitHub repos for the picker (needs token)
  - `GET  /api/repos/linked` — linked repos for the sidebar list
  - `POST /api/repos/linked` — link a repo (downloads snapshot synchronously)
  - `DELETE /api/repos/linked/[id]` — unlink + delete snapshot dir
  - `POST /api/repos/linked/[id]/refresh` — re-download snapshot

## Deviations

- **Retrieval tool closes over `userId` only, not the GitHub token.** ADR 0001
  says the per-request tool closes over "the session token and userId". In phase 1
  retrieval reads only _local_ snapshots (ripgrep over `.data/repos/`), so the
  token is never needed at search time — only at link/refresh time, which are
  their own authenticated endpoints. Closing over just `userId` keeps the tool
  surface minimal. The token-in-session mechanism (ADR 0001) is still implemented
  for the link/refresh/available endpoints.

## Per-file dates

- **`.dates.json` sidecar manifest.** Each snapshot gets a hidden
  `.data/repos/<id>/.dates.json` mapping relative path → ISO 8601 last-changed
  date. Hidden so ripgrep skips it during search. Chosen over file mtimes (the
  tarball stamps all files with the archive time, and mtime survival across the
  `.data` volume / redeploys isn't guaranteed) and over DB rows (the snapshot is
  the natural owner of per-file metadata; no migration needed).
- **Dates fetched at snapshot time, GraphQL-first.** `fetchFileDates` in
  `github.ts` batches aliased `history(first: 1, path: …)` GraphQL fields (100 per
  request), falling back to per-path REST `commits?path=` for anything GraphQL
  didn't resolve. Failures degrade silently to the snapshot commit date (from
  `getRepoMeta`, now also returning `commitDate`), so every file always has a date.
- **`lastChanged` is optional on the snippet schema.** Snapshots taken before this
  change have no manifest; `readDatesManifest` returns `{}` and the field is
  omitted, which the renderer guards with `v-if`.

## Design decisions where the spec was ambiguous

- **Query handling for ripgrep.** The assistant passes a free-text query. Phase 1
  tokenizes it into words (length > 2), regex-escapes each, joins with `|`, and
  runs `rg --json -i` (case-insensitive, OR over words). Files are ranked by match
  count. This is looser than an exact-phrase match (which would miss most prose)
  and is the pragmatic "plain text search" the PRD calls for. Section-aware and
  semantic ranking are explicitly phase 2.
- **Snippet sizing constants.** Whole file returned when ≤ ~12 KB; otherwise a
  window of 6 lines on each side of the first match cluster. Max 8 files returned.
  These are tunable; chosen to keep tool output within a sane token budget.
- **Snapshot directory = `linkedRepositories.id`.** `.data/repos/<uuid>/`, matching
  the data-model section ("id … also names the snapshot directory").

## Build-time decisions

- **Tarball buffered in memory before extraction.** `downloadAndExtractSnapshot`
  reads the whole tarball into a Buffer, then streams it through gunzip + tar.
  Fully streaming `response.body` would need an unsafe cast between the DOM and
  Node web-stream types (the strict oxc config rejects it). Markdown-only repos
  are small, so buffering is fine; revisit only if very large repos appear.
- **GitHub responses are zod-parsed**, not cast from `any` — required by the
  strict type-aware lint, and a real robustness win.
- **`server/utils/github.ts` gets a per-file `no-await-in-loop` override** in
  `vite.config.ts` (paginating the repo list and streaming tar entries are
  inherently sequential), mirroring the existing `default.vue` precedent.
- **`shared/utils/index.ts` must re-export new shared modules.** Nuxt auto-imports
  shared utils via the explicit `index.ts` re-exports here, not by scanning the
  tree, so `repo-search.ts` and `repos.ts` were added there.
- **Picker uses `UCommandPalette` in a `UModal`** per the PRD: client-side fuzzy
  filter over the once-fetched repo list, with the row's link state rendered in
  the `#item-trailing` slot (Link / Linking… / Linked badge).

## Open questions

- **Re-login is required to activate the feature for an already-logged-in owner.**
  The `repo` scope and the captured token only take effect on the next GitHub
  login, since the current session predates this change. Worth a heads-up in the
  release note.

- Picker "available repos" can be slow/large for accounts with many repos; phase 1
  fetches all owner repos paginated and filters client-side per the PRD. Fine for
  the owner's scale.
- In **open mode** (dev default) there is no login, hence no GitHub token. Linking
  therefore requires logging in via GitHub at least once even in open mode; the
  endpoints return a clear 400 ("GitHub connection required") when the token is
  absent. Flagging in case you want a different dev affordance.
