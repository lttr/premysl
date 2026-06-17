# RAG retrieval via libSQL-native vectors + FTS5, run as a parallel path to grep

To evaluate whether semantic retrieval beats the phase-1 ripgrep search (ADR
0002), we add **RAG retrieval** as a _second, parallel_ method rather than
replacing grep. Each chat picks one method via its **retrieval mode** (`grep` |
`rag`), so every answer is attributable to one method and the two are directly
comparable. The download + markdown extract + dates manifest (the **snapshot**)
stays shared; only the retrieval below it differs.

RAG retrieval is the course-standard hybrid: split each markdown file into
section-aware chunks (fixed-size token windows as a fallback for headingless or
oddly-structured files), embed them, rank chunks against the question by fusing
semantic similarity and BM25 with reciprocal rank fusion (RRF, k=60), and return
the top 3. Embeddings use Voyage **`voyage-context-3`** (contextualized chunk
embeddings, 1024 dims): chunks are sent grouped per file so each chunk's vector
carries its document's context, which also salvages headingless chunks that
would otherwise embed with no surrounding signal. Embedding happens **at snapshot
time** (link/refresh), in the same synchronous owner-initiated request as the
snapshot itself — no background work (ADR 0001), and RAG's freshness matches
grep's so staleness can't confound the comparison. Only the `rag` path ever calls
Voyage.

## Storage: libSQL native vectors + FTS5, not a sidecar or sqlite-vec

Chunks (text + 1024-dim vector) live in a Drizzle table in the prod SQLite file,
not in a sidecar manifest beside the snapshot (as the dates manifest does) and
not behind the `sqlite-vec` extension. The deciding fact: prod runs on **libSQL**
(`@libsql/client`, via `hub: { db: "sqlite" }`), which has vector search and FTS5
built in. Both were verified live against the dev DB before deciding:

- **Semantic half** — `F32_BLOB(1024)` column + `vector_distance_cos()`
  (returns 0 for identical, 1 for orthogonal vectors). Brute-force cosine over a
  personal docs corpus (a few thousand chunks) is sub-millisecond; the
  `libsql_vector_idx` ANN index exists but is unnecessary at this scale.
- **Lexical half** — an FTS5 virtual table + the built-in `bm25()` ranking
  function, which _is_ the course's `BM25Index`. RRF over the two ranked lists is
  done in JS.

## Considered Options

- **libSQL native vectors + FTS5 (chosen).** Both halves of RAG run natively in
  one store already shipped with the app; no hand-rolled BM25, no JS cosine loop,
  no compiled extension. Cost: per-snapshot state is split — the dates manifest
  stays a filesystem sidecar while chunks live in the DB.
- **Sidecar index file in the snapshot dir (rejected).** Mirrors the
  `.dates.json` pattern and keeps all per-snapshot state in one place, with
  brute-force cosine + in-memory BM25 in JS. Rejected once libSQL was found to do
  both halves natively: the sidecar would reimplement BM25 and cosine by hand for
  no benefit.
- **`sqlite-vec` extension (rejected).** A compiled loadable extension. libSQL
  does not load `sqlite-vec`-style C extensions, and it doesn't need to — native
  vectors cover it. This is the same "no system binaries in the stock Node image"
  constraint ADR 0002 hit with ripgrep.
- **External / managed vector store, e.g. NuxtHub Vectorize (rejected).** Same
  reasoning ADR 0002 used to reject Blob: the deployment is a Coolify VPS with a
  mounted volume, not Cloudflare, and ANN is overkill for a single-user docs set.

## Consequences

- The `rag` tool (`repo_rag`) reuses the phase-1 `repoSearchSnippet` output shape
  (each chunk → `content` + commit-pinned `url` + line range + `lastChanged`), so
  the existing chat render component serves both paths and the comparison is
  visually apples-to-apples. A chat only ever sees its one tool, so the model
  can't mix methods.
- Per-chunk vector / BM25 / RRF scores are logged server-side for analysis, not
  carried in the tool output or UI.
- Unlinking or refreshing a repository must now also delete/rebuild that repo's
  chunk rows, alongside the existing snapshot + dates-manifest cleanup.
- Adopting `voyage-context-3` adds a `VOYAGE_API_KEY` and a small `fetch`-based
  embedding client (no AI SDK provider exists for Voyage), kept separate from the
  Anthropic-direct chat providers in `server/utils/ai-models.ts`.
- Retrieval mode is a new per-chat column; it is independent of the model axis
  (`haiku` | `sonnet`) so retrieval method and model don't get entangled as
  variables.
