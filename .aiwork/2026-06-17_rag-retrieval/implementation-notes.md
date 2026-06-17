# Implementation notes — RAG Retrieval (phase 2)

Running log of decisions, deviations, tradeoffs, and open questions while
implementing `prd.md` + `visual-spec.html`. Read alongside ADR 0003.

## Design decisions (spec was ambiguous or silent)

- **Vector + FTS data access via raw SQL, not the Drizzle query builder.**
  `repo_chunks` is declared in `schema.ts` (so `nuxt db generate` emits the
  scalar columns and the `F32_BLOB(1024)` vector column), but all inserts and
  searches use raw `sql`` `` through drizzle's `db.run`/`db.all`/`db.batch`.
Reason: `vector32(?)`, `vector_distance_cos(...)`, FTS5 `MATCH`and`bm25()`
  are libSQL-native constructs the typed builder can't express. This keeps the
  ADR's "no hand-rolled BM25/cosine" promise (the DB does the math) while
  staying honest about what Drizzle can model.

- **FTS5 as a standalone (own-content) table, not external-content + triggers.**
  `repo_chunks_fts(content, chunk_id UNINDEXED)` is written to in the same
  atomic batch as `repo_chunks`. Indexing is already a wholesale
  delete-then-insert per repo, so trigger-based sync buys nothing and adds a
  hand-written-trigger migration to maintain. User scoping at search time is a
  JOIN from the FTS hit back to `repo_chunks.user_id` (FTS table carries no
  user), so the top-30 BM25 candidates are user-correct before the limit.

- **`repo_chunks` is keyed by `user_id` AND `linked_repository_id`**, both with
  `ON DELETE CASCADE`. Unlink deletes the linked-repo row and the cascade clears
  its chunks (plus the FTS rows, deleted explicitly in the same path) — the PRD
  asks unlink to "remove its RAG index"; cascade is the least-code way that also
  survives a user delete. Snapshot-dir deletion stays as-is.

- **Denormalized provenance on each chunk row** (`repo_full_name`, `commit_sha`,
  `file_path`, `start_line`, `end_line`). Mirrors the grep path's `SnapshotRepo`
  and lets a search build the commit-pinned URL with no join to
  `linked_repositories`. `commit_sha` is captured at index time so the citation
  pins to the snapshot's commit (matching grep).

- **FTS5 MATCH query is built defensively** from the question: word tokens
  (length > 1), each double-quoted, joined with `OR`. Raw user text can contain
  FTS5 operators that throw; OR-of-terms matches the hybrid intent (keyword half
  votes broadly, the vector half supplies precision).

- **Voyage response parsing is zod-validated** against the documented
  `{ data: [{ data: [{ embedding, index }], index }] }` shape; chunks within a
  group are reordered by their `index` before use.

- **`last_changed` is denormalized onto each chunk row** (copied from the
  snapshot's dates manifest at index time). Avoids a manifest read + a join to
  `linked_repositories` at search time, and keeps the RAG snippet's `lastChanged`
  exactly matching grep's. Added as an additive migration `0005` rather than
  folding it into `0004` — generated migrations are append-only; deleting one and
  hand-editing `_journal.json` is fragile (and was the wrong first instinct).

## Deviations

- **Oversized heading sections are not sub-windowed.** The PRD says "each section
  is one chunk"; a very long section embeds as a single (large) chunk rather than
  being split into windows. At personal-docs scale this is fine and stays within
  Voyage's per-chunk token limit. Window-splitting big sections is a candidate
  future improvement.

## Tradeoffs considered

- **`db.batch([...])` over `db.transaction(async tx => ...)`** for the
  all-or-nothing index write. batch is atomic on libSQL for both local-file
  (prod) and remote, and needs no interactive-transaction support. Cost: every
  statement is prepared up front (fine at personal-docs scale, a few hundred
  inserts per repo).

- **Score logging goes to `console.warn`** with a `[rag]` prefix (one line per
  query: top-3 repo/path/lines + fused score). The lint config only permits
  `console.warn`/`console.error`, and consola is a transitive (not direct) dep —
  so warn is the pragmatic server-log channel. Semantic distance and BM25 are
  computed per candidate; the line logs the fused ordering that produced the
  cards. Not surfaced in the UI (visual spec).
- **`repo_rag` reuses the grep render component.** Output schema is identical, so
  `MessageContent.vue` routes both `repo_search` and `repo_rag` to
  `ChatToolRepoSearch`; `repo-rag.ts` only needs to supply the tool description
  and (type-only) tool def. No second source-card component.
- **New-chat retrieval picker is a cookie** (`useRetrievalMode`, mirroring
  `useModels`), so the choice sticks across reloads. A chat's own mode comes from
  its DB record, never the cookie. Sidebar shows a colored dot per chat (blue =
  grep, violet = rag); the chat page shows a read-only badge.

## Verification

- `vp run verify` passes (check, eslint, typecheck, fallow, build).
- libSQL `vector32` / `vector_distance_cos` / FTS5 `bm25()` + the user-scoping
  JOIN were exercised live against an in-memory `@libsql/client` before building
  on them. The chunker's line-numbering and heading paths were smoke-tested
  against the spec's "Refresh › Cadence" example.
- Migrations `0004` (repo_chunks + retrieval_mode + FTS5 virtual table) and
  `0005` (last_changed) apply automatically on next `nuxt dev` / deploy. Requires
  `VOYAGE_API_KEY` in the environment for indexing/search to function.

## Open questions (please confirm/revise)

- **Embedding concurrency cap** set to 5 (PRD says ≈4–6). Fine?
- **Token estimate for the ~500-token window fallback** uses a chars≈4/token
  heuristic (no tokenizer dependency in the stack). Acceptable, or do you want a
  real tokenizer?
- **Retrieval-mode picker placement**: implemented on the _new chat_ composer
  (index page) only; the chat page shows the mode read-only (a badge), since
  mode is fixed for the chat's life. Matches the visual spec's "shown while you
  chat" + "fixed".
