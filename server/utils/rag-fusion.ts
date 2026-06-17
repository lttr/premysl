// Pure helpers for hybrid RAG ranking (ADR 0003). No network, no DB.

// Build an FTS5 MATCH expression from a free-text question: each word token
// (length > 1) quoted as a literal and OR-ed together. Quoting neutralizes FTS5
// operators in the raw text; OR matches the hybrid intent (the keyword half
// votes broadly, the vector half supplies precision). Null when no usable terms.
export function ftsMatchQuery(query: string): string | null {
  const words = query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []
  const usable = [...new Set(words.filter((word) => word.length > 1))]
  if (usable.length === 0) return null
  return usable.map((word) => `"${word}"`).join(" OR ")
}

export interface FusedRank {
  id: string
  score: number
}

// Reciprocal rank fusion of two ranked id lists (best-first). An id's score is
// the sum over the lists it appears in of 1/(k + rank), so an item ranked well
// by either signal floats up and agreement compounds. Returns all ids that
// appeared in at least one list, sorted best-first.
export function reciprocalRankFusion(
  vectorRanked: string[],
  bm25Ranked: string[],
  k: number,
): FusedRank[] {
  const scores = new Map<string, number>()
  for (const list of [vectorRanked, bm25Ranked]) {
    for (const [rank, id] of list.entries()) {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank))
    }
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .toSorted((a, b) => b.score - a.score)
}
