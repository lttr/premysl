---
status: draft
glossary_terms:
  [Snapshot, Refresh, Grep retrieval, RAG retrieval, Retrieval mode, Linked repository, Owner]
adrs:
  [
    0001-github-oauth-for-repo-linking,
    0002-repo-retrieval-via-archive-and-ripgrep,
    0003-rag-retrieval-via-libsql-vectors-and-fts5,
  ]
---

# PRD: RAG Retrieval (phase 2)

## Problem Statement

The owner can already link GitHub repositories and have the assistant answer from
them, but the only retrieval method is **grep retrieval**: ripgrep over the
**snapshot**, matching the question's keywords and ranking files by match count.
That misses material phrased differently from the question — ask "how do we keep
snapshots from going stale" and a doc that says "refresh cadence" never surfaces,
because the two share no keywords. The owner also has no way to tell whether a
semantic method would actually answer better for their own docs, or whether grep
is good enough; there is nothing to compare against.

## Solution

Add **RAG retrieval** as a second method that runs _alongside_ grep, not instead
of it. RAG splits the snapshot into chunks, ranks them against the question by
combining meaning (embeddings) with keywords (BM25), and returns the best few
chunks. Each chat is fixed to one method via its **retrieval mode** (`grep` or
`rag`), so the owner can ask the same question in a grep chat and a rag chat and
see, side by side, which grounds the answer better and cites better sources. The
linking and refreshing experience is unchanged; the difference is only in how a
chat retrieves. Answers from both methods render identically in chat (same source
cards, same links), so the comparison is about retrieval quality, not UI.

## User Stories

### Choosing a method per chat

1. As the owner, I want each chat to use exactly one retrieval method, so that
   every answer in it is attributable to that method and the two are comparable.
2. As the owner, I want to choose the retrieval mode when I start a chat, so that
   I can decide up front whether that conversation uses grep or RAG.
3. As the owner, I want the retrieval mode to be independent of the model I pick
   (haiku/sonnet), so that I can vary retrieval method and model separately
   without entangling the two.
4. As the owner, I want new chats to default to the established grep method, so
   that RAG is an opt-in I reach for when I want to evaluate it.
5. As the owner, I want a chat's retrieval mode to be visible while I use it, so
   that I always know which method produced an answer.
6. As the owner, I want a chat's retrieval mode to stay fixed for the life of the
   chat, so that the comparison within one conversation is clean.

### Asking questions with RAG

7. As the owner, I want a RAG chat to search all my linked repositories at once,
   so that I do not have to tell it which repo to look in (matching grep).
8. As the owner, I want RAG to find material that means the same thing as my
   question even when it uses different words, so that vocabulary mismatch stops
   hiding relevant docs.
9. As the owner, I want RAG to still do well on exact-term questions (an error
   code, a proper noun, a function name), so that adding meaning-based search does
   not regress the keyword cases grep was good at.
10. As the owner, I want RAG to return the most relevant chunks of my docs, so
    that the assistant answers from coherent passages rather than stray lines.
11. As the owner, I want RAG results to identify the repository, file path, and
    location, so that I can open the source and the assistant can cite it.
12. As the owner, I want each RAG result to link to a commit-pinned GitHub URL
    with a line range, so that the citation stays accurate after later pushes
    (matching grep).
13. As the owner, I want each RAG result to carry its file's last-changed date, so
    that the assistant can reason about recency (matching grep).
14. As the owner, I want RAG to tell me when it found nothing relevant, so that I
    can rephrase or link a different repository.
15. As the owner, I want RAG results to render in chat exactly like grep results,
    so that I am comparing retrieval quality, not two different UIs.

### Indexing at link and refresh time

16. As the owner, I want a repository to be indexed for RAG the moment I link it,
    so that a RAG chat can use it immediately without an extra step.
17. As the owner, I want refreshing a repository to rebuild its RAG index from the
    new snapshot, so that RAG is exactly as fresh as grep and staleness does not
    confound my comparison.
18. As the owner, I want unlinking a repository to remove its RAG index along with
    its snapshot, so that nothing is left behind.
19. As the owner, I want indexing to happen during the link/refresh request I
    initiated, so that there is no background or scheduled work (consistent with
    the session-only GitHub credential).
20. As the owner, I want a repository's RAG index to be built completely during
    the link/refresh request or not at all, so that a repo is never left
    half-indexed when something fails partway (a timeout or a provider error).
21. As the owner, I want docs with no headings or odd structure to still be
    indexed sensibly, so that RAG works across my whole repo, not just
    well-structured files.

### Comparing the two methods

22. As the owner, I want to run the same question under grep and under RAG, so
    that I can judge which retrieves better for my material.
23. As the owner, I want the per-chunk ranking signals (semantic score, BM25
    score, fused score) recorded for analysis, so that I can understand _why_ RAG
    ranked things the way it did without cluttering the chat UI.
24. As the owner, I want both methods to feed the model a comparable amount of
    context, so that the comparison reflects retrieval quality rather than one
    method flooding the prompt.

### Access and safety

25. As the owner in locked mode, I want only my account to trigger RAG indexing
    and retrieval, so that no one else can reach my repositories (matching grep).
26. As the owner, I want the embedding provider credential kept in server config
    only, so that it is never exposed to the client.

## Implementation Decisions

### Two parallel paths, shared snapshot

- RAG retrieval is added as a parallel method to grep retrieval (ADR 0003); grep
  is unchanged. Everything up to and including the **snapshot** (archive download,
  markdown-only extraction, the dates manifest) is shared between the two methods
  — `downloadAndExtractSnapshot` and the dates manifest are reused as-is.
- A chat carries a **retrieval mode** (`grep` | `rag`). `buildTools()` (already
  per-request) exposes only that chat's one retrieval tool, so the model never
  sees both and cannot mix methods.
- Retrieval mode is a new column on the `chats` table, defaulting to `grep`. It is
  orthogonal to the model key. The migration is generated with the project's
  Drizzle tooling (applied migrations are never hand-edited).

### Indexing pipeline (link / refresh)

- On link and on refresh, after the snapshot is written, each markdown file is
  split into chunks, the chunks are embedded, and the chunk rows (text + vector)
  are written to the database. Refresh rebuilds the chunk rows from the new
  snapshot; unlink deletes them alongside the snapshot directory. This runs
  synchronously inside the owner's link/refresh request — no background, scheduled,
  or webhook-driven work (ADR 0001, ADR 0002).
- Indexing happens at **link time unconditionally** — a repository is indexed for
  RAG the moment it is linked, regardless of whether the owner ever opens a `rag`
  chat. The alternative (index lazily on first RAG use) was rejected: it would make
  the first RAG question pay the whole indexing latency, and it complicates "is
  this repo ready". The cost is that linking always calls Voyage; the free tier
  absorbs it at this scale.
- The index is built **all-or-nothing per repository.** All chunk rows are
  embedded, then written in a single transaction (`delete existing → insert new`),
  so a failure partway (request timeout, Voyage rate-limit or error) never leaves a
  half-indexed repo: on refresh the prior index survives, on first link the repo is
  left unindexed, and the failure is surfaced so the owner can retry by
  refreshing. This is the request-time mitigation for the one genuinely slow,
  failure-prone step in the pipeline.
- Embedding is the wall-clock bottleneck (one Voyage call per file, sequential
  would risk the proxy request timeout on a large repo). Files are embedded
  **concurrently with a small cap** (≈4–6 in flight) to compress wall-clock while
  staying inside one request. If a corpus ever grows large enough to blow the proxy
  timeout even so, that is the trigger to revisit the no-background-worker stance
  (ADR 0001) — not before.
- **Chunking** splits each file at markdown headings (one chunk per section),
  prepending the heading path to the chunk's embedded text. Regions with no
  heading (a headingless file, or the preamble before the first heading) fall back
  to fixed-size token windows (~500 tokens, ~50 overlap). YAML frontmatter is
  stripped before chunking. Every chunk records its `startLine`/`endLine` so
  citations reuse the grep path's commit-pinned URL + line range and the dates
  manifest's last-changed date.
- **Embeddings** use Voyage `voyage-context-3` (contextualized chunk embeddings,
  1024 dims). At index time, a file's chunks are sent grouped together
  (`List[List[str]]` per the contextualized API) with `input_type: "document"`, so
  each chunk's vector carries its document's context — which also gives
  headingless fallback chunks usable signal. Embedding is reached through a small
  `fetch`-based Voyage client behind a `VOYAGE_API_KEY`, kept separate from the
  Anthropic-direct chat providers in `ai-models.ts` (no AI SDK provider exists for
  Voyage).

### Storage and search (ADR 0003)

- Chunks live in a new Drizzle table in the prod SQLite file: the chunk text, an
  `F32_BLOB(1024)` vector column, provenance (linked-repository id, file path,
  line range), and an FTS5 virtual table over the chunk text for BM25. This uses
  libSQL's built-in vector and FTS5 support — verified live on the dev DB — rather
  than a sidecar manifest or the `sqlite-vec` extension (which libSQL does not
  load and does not need).
- At search time: embed the question once via Voyage (`input_type: "query"`); take
  the top 30 candidates from the vector side (`vector_distance_cos`) and the top
  30 from the BM25 side (FTS5 `bm25()`); fuse the two ranked lists with reciprocal
  rank fusion (k = 60); return the top 3 chunks. Per-chunk semantic/BM25/fused
  scores are logged server-side for analysis, not returned in the tool output.

### Retrieval tool and rendering

- A new tool `repo_rag` is added alongside `repo_search`, taking a single
  free-text query and no repository argument (it searches all of the owner's
  linked repositories). It reuses the existing `repoSearchSnippet` output shape
  (each chunk → `content`, commit-pinned `url`, `startLine`/`endLine`,
  `lastChanged`, `whole: false`), so the existing chat tool-render component serves
  both paths and the comparison is visually apples-to-apples.
- The executable tool is built per-request (like `repo_search`) so it can close
  over the authenticated user id and search that user's chunk rows. The chat
  endpoint selects which of the two tools to register from the chat's retrieval
  mode.

### Access

- All new handlers and the indexing path call the existing server gate, so in
  locked mode only the owner is served and the feature fails closed (matching
  grep). The Voyage credential is server-only config, never sent to the client.

## Testing Decisions

- A good test here exercises external behavior, not internals. The project has no
  test runner and states "No unit tests"; this PRD does not introduce a harness.
  Verification is the existing pre-push gate (`vp run verify`) plus manual exercise
  via the dev server, matching the phase-1 (grep) PRD.
- The highest-value seams, if automated tests are ever added:
  - **Pure functions:** `chunkMarkdown(fileText) → chunks[]` (section split,
    window fallback, frontmatter strip, correct line ranges) and
    `reciprocalRankFusion(vectorRanked, bm25Ranked, k) → ranked[]`. Both are
    deterministic with no network or DB.
  - **DB seam:** "index a snapshot's chunks" and "search chunks for a query"
    against an in-memory libSQL (`:memory:`) with a faked Voyage embedding call —
    exercises `F32_BLOB` / `vector_distance_cos` + FTS5 `bm25()` + RRF end to end
    without the network. This is the RAG analog of phase-1's pure
    "search-a-snapshot-directory" seam.
  - **Network boundary to fake:** the Voyage embedding client — the one external
    call in the path.
- Existing HTTP seams (manual, as in phase 1): link/refresh/unlink (now also
  build/rebuild/delete chunk rows) and the chat endpoint driven by retrieval mode.
- A good manual check: link a repo and confirm chunk rows appear; in a `rag` chat,
  ask a question whose answer is phrased differently from the docs and confirm RAG
  retrieves and cites it where grep would miss it; ask the same question in a
  `grep` chat and compare; refresh after editing the repo and confirm new content
  is found; unlink and confirm both snapshot and chunk rows are gone; in locked
  mode, confirm a non-owner cannot reach the endpoints.

## Out of Scope

- Replacing or changing grep retrieval — it stays exactly as shipped in phase 1;
  RAG is purely additive.
- Switching a chat's retrieval mode after creation — mode is fixed for the chat's
  life (that fixity is what makes the comparison clean).
- ANN vector indexes (`libsql_vector_idx`) — brute-force `vector_distance_cos`
  over a personal docs corpus is sub-millisecond, so ANN is unnecessary.
- Re-embedding or migrating snapshots taken before RAG existed — RAG indexing
  happens on the next link/refresh.
- Incremental re-indexing on refresh — refresh does a **full rebuild** (replace
  all of the repo's chunk rows), not a diff. See Further Notes for the planned
  future improvement.
- Tuning embedding model, dimension, chunk size, candidate counts, RRF k, or
  top-k as user-facing settings — these are fixed defaults (`voyage-context-3`,
  1024, ~500-token windows, 30 candidates/side, k=60, top 3).
- Non-markdown files (unchanged from ADR 0002 — only markdown is snapshotted).
- Automatic, scheduled, or webhook-driven indexing or refresh.
- A formal evaluation harness or metrics dashboard for the grep-vs-RAG comparison
  beyond the server-side score logging.
- Surfacing the ranking scores in the chat UI.

## Further Notes

- The architecture follows the Anthropic course's hybrid RAG pipeline
  (section chunking → embeddings + BM25 → reciprocal rank fusion), ported onto the
  Premysl stack: the course's in-memory `VectorIndex` and `BM25Index` map directly
  onto libSQL's native `F32_BLOB`/`vector_distance_cos` and FTS5 `bm25()`, so
  neither half is hand-rolled.
- `voyage-context-3` was chosen over the general `voyage-4` family specifically
  because contextualized chunk embeddings salvage headingless / oddly-structured
  files; the 200M-token Voyage free tier makes a personal docs corpus effectively
  free regardless of model.
- Returning whole files is left to grep; RAG deliberately returns smaller,
  higher-precision chunks (top 3), which is why its per-result content is bounded
  by chunk size rather than grep's whole-file-vs-window rule.
- **Future: incremental re-indexing.** Refresh currently re-embeds every file. A
  later improvement can re-embed only the files that changed by diffing the new
  snapshot against the stored chunk rows — the inputs are already on hand (the
  per-file last-changed dates in the dates manifest, plus the recorded commit SHA;
  a per-file content hash on the chunk rows would make the diff exact). This cuts
  embedding cost and link/refresh latency on large repos, and is the same lever
  that would let indexing stay inside one request as a corpus grows. Out of scope
  now: full rebuild is correct and fast enough at personal-docs scale.
- Glossary terms used here are canonical: Snapshot, Refresh, Grep retrieval, RAG
  retrieval, Retrieval mode, Linked repository, Owner. Avoid the aliases listed in
  GLOSSARY.md.
