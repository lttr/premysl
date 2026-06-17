import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { db } from "hub:db"
import { sql } from "drizzle-orm"
import { z } from "zod"

// RAG retrieval (ADR 0003): build a snapshot's chunk index at link/refresh time,
// and answer a question by fusing semantic (vector) and lexical (BM25) ranks.
// Storage is libSQL-native — `vector_distance_cos` over an `F32_BLOB` column and
// FTS5 `bm25()` — so neither half is hand-rolled; the app only fuses the lists.

// Candidates pulled from each half before fusion, RRF constant, and how many
// chunks become source cards. Fixed defaults (PRD: not user-facing knobs).
const CANDIDATES_PER_SIDE = 30
const RRF_K = 60
const TOP_K = 3
// Files embedded concurrently — small cap to compress wall-clock while staying
// inside the one link/refresh request (PRD).
const EMBED_CONCURRENCY = 5

export interface IndexRepoInput {
  userId: string
  linkedRepositoryId: string
  repoFullName: string
  commitSha: string
  snapshotPath: string
  relPaths: string[]
}

interface ChunkRecord {
  id: string
  filePath: string
  startLine: number
  endLine: number
  content: string
  lastChanged: string | null
  embedding: number[]
}

// Bounded-concurrency map: at most `limit` workers in flight, results kept in
// input order. Recursive draining avoids an await-in-a-loop.
async function runPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  const queue = items.map((item, index) => ({ item, index }))
  async function drain(): Promise<void> {
    const job = queue.shift()
    if (job === undefined) return
    results[job.index] = await worker(job.item)
    await drain()
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => drain()))
  return results
}

// Prepend the heading path so each vector carries its section context (also
// gives headingless window chunks usable signal once embedded in document mode).
function embedText(chunk: { headingPath: string; content: string }): string {
  return chunk.headingPath === "" ? chunk.content : `${chunk.headingPath}\n\n${chunk.content}`
}

// Read one file, chunk it, and embed its chunks together (grouped per file).
async function embedFile(
  relPath: string,
  snapshotPath: string,
  dates: Record<string, string>,
): Promise<ChunkRecord[]> {
  const text = await readFile(join(snapshotPath, relPath), "utf8").catch(() => "")
  const chunks = chunkMarkdown(text)
  if (chunks.length === 0) return []
  const vectors = await embedDocumentChunks(chunks.map((chunk) => embedText(chunk)))
  if (vectors.length !== chunks.length) {
    throw createError({ statusCode: 502, statusMessage: `Embedding incomplete for ${relPath}` })
  }
  return chunks.map((chunk, i) => ({
    id: crypto.randomUUID(),
    filePath: relPath,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    content: chunk.content,
    lastChanged: dates[relPath] ?? null,
    embedding: vectors[i] ?? [],
  }))
}

// Insert statements for a repo's chunk rows + their FTS entries (the variable
// part of the index write). The fixed delete statements lead the batch inline.
function chunkInsertStatements(records: ChunkRecord[], input: IndexRepoInput) {
  const createdAt = Math.floor(Date.now() / 1000)
  const statements = []
  for (const r of records) {
    statements.push(
      db.run(
        sql`INSERT INTO repo_chunks (id, user_id, linked_repository_id, repo_full_name, commit_sha, file_path, start_line, end_line, content, last_changed, embedding, created_at) VALUES (${r.id}, ${input.userId}, ${input.linkedRepositoryId}, ${input.repoFullName}, ${input.commitSha}, ${r.filePath}, ${r.startLine}, ${r.endLine}, ${r.content}, ${r.lastChanged}, vector32(${JSON.stringify(r.embedding)}), ${createdAt})`,
      ),
      db.run(sql`INSERT INTO repo_chunks_fts (content, chunk_id) VALUES (${r.content}, ${r.id})`),
    )
  }
  return statements
}

// Build (or rebuild) a linked repository's RAG chunk index from its snapshot.
// Embeds every file first, then replaces the repo's rows wholesale in one atomic
// batch — all-or-nothing (ADR 0003): a partial embedding failure throws before
// this, leaving the prior index intact.
export async function indexRepoChunks(input: IndexRepoInput): Promise<{ chunkCount: number }> {
  const dates = await readDatesManifest(input.snapshotPath)
  const perFile = await runPool(input.relPaths, EMBED_CONCURRENCY, async (relPath) =>
    embedFile(relPath, input.snapshotPath, dates),
  )
  const records = perFile.flat()
  const repoId = input.linkedRepositoryId
  await db.batch([
    db.run(
      sql`DELETE FROM repo_chunks_fts WHERE chunk_id IN (SELECT id FROM repo_chunks WHERE linked_repository_id = ${repoId})`,
    ),
    db.run(sql`DELETE FROM repo_chunks WHERE linked_repository_id = ${repoId}`),
    ...chunkInsertStatements(records, input),
  ])
  return { chunkCount: records.length }
}

// Remove a linked repository's chunk rows and their FTS entries (unlink). FTS is
// a standalone table, so it is cleared explicitly rather than by FK cascade.
export async function deleteRepoChunks(linkedRepositoryId: string): Promise<void> {
  await db.batch([
    db.run(
      sql`DELETE FROM repo_chunks_fts WHERE chunk_id IN (SELECT id FROM repo_chunks WHERE linked_repository_id = ${linkedRepositoryId})`,
    ),
    db.run(sql`DELETE FROM repo_chunks WHERE linked_repository_id = ${linkedRepositoryId}`),
  ])
}

const candidateRowSchema = z.object({
  id: z.string(),
  repo_full_name: z.string(),
  file_path: z.string(),
  commit_sha: z.string(),
  start_line: z.number(),
  end_line: z.number(),
  content: z.string(),
  last_changed: z.string().nullable(),
  score: z.number(),
})
type CandidateRow = z.infer<typeof candidateRowSchema>

// Top candidates by semantic distance (0 = identical). Scoped to the user's rows.
async function vectorCandidates(userId: string, vecJson: string): Promise<CandidateRow[]> {
  const rows: unknown = await db.all(
    sql`SELECT id, repo_full_name, file_path, commit_sha, start_line, end_line, content, last_changed, vector_distance_cos(embedding, vector32(${vecJson})) AS score FROM repo_chunks WHERE user_id = ${userId} ORDER BY score ASC LIMIT ${CANDIDATES_PER_SIDE}`,
  )
  return z.array(candidateRowSchema).parse(rows)
}

// Top candidates by BM25 (lower = better). The FTS table carries no user, so the
// user filter is a join back to repo_chunks before the limit.
async function bm25Candidates(userId: string, match: string): Promise<CandidateRow[]> {
  const rows: unknown = await db.all(
    sql`SELECT c.id AS id, c.repo_full_name AS repo_full_name, c.file_path AS file_path, c.commit_sha AS commit_sha, c.start_line AS start_line, c.end_line AS end_line, c.content AS content, c.last_changed AS last_changed, bm25(repo_chunks_fts) AS score FROM repo_chunks_fts JOIN repo_chunks c ON c.id = repo_chunks_fts.chunk_id WHERE repo_chunks_fts MATCH ${match} AND c.user_id = ${userId} ORDER BY score ASC LIMIT ${CANDIDATES_PER_SIDE}`,
  )
  return z.array(candidateRowSchema).parse(rows)
}

function toSnippet(row: CandidateRow): RepoSearchSnippet {
  return {
    repo: row.repo_full_name,
    path: row.file_path,
    startLine: row.start_line,
    endLine: row.end_line,
    url: `https://github.com/${row.repo_full_name}/blob/${row.commit_sha}/${row.file_path}#L${row.start_line}-L${row.end_line}`,
    content: row.content,
    whole: false,
    lastChanged: row.last_changed ?? undefined,
  }
}

// Record per-chunk semantic / BM25 / fused scores server-side for analysis, so
// the owner can see why RAG ranked things as it did — not surfaced in the UI
// (visual spec). Routine analysis output; warn is the only console level lint
// allows.
function logScores(query: string, fused: FusedRank[], byId: Map<string, CandidateRow>): void {
  const rows = fused.slice(0, TOP_K).map((f, rank) => {
    const row = byId.get(f.id)
    return {
      rank,
      repo: row?.repo_full_name,
      path: row?.file_path,
      lines: row ? `L${row.start_line}-${row.end_line}` : undefined,
      fused: Number(f.score.toFixed(5)),
    }
  })
  console.warn(`[rag] query="${query}" results:`, JSON.stringify(rows))
}

// Answer a RAG question: embed it once, take the top candidates from each half,
// fuse with RRF, and return the top chunks as snippets (the grep output shape).
export async function searchRagChunks(userId: string, query: string): Promise<RepoSearchOutput> {
  const queryVector = await embedQuery(query)
  const vectorRows = await vectorCandidates(userId, JSON.stringify(queryVector))
  const match = ftsMatchQuery(query)
  const bm25Rows = match === null ? [] : await bm25Candidates(userId, match)

  const byId = new Map<string, CandidateRow>()
  for (const row of [...vectorRows, ...bm25Rows]) byId.set(row.id, row)

  const fused = reciprocalRankFusion(
    vectorRows.map((r) => r.id),
    bm25Rows.map((r) => r.id),
    RRF_K,
  )
  logScores(query, fused, byId)

  const matches = fused.slice(0, TOP_K).flatMap(({ id }) => {
    const row = byId.get(id)
    return row === undefined ? [] : [toSnippet(row)]
  })
  return { query, matches }
}
