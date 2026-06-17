import { z } from "zod"

// Small fetch-based client for Voyage's contextualized chunk embeddings
// (`voyage-context-3`, 1024 dims). No AI SDK provider exists for Voyage, so this
// is kept separate from the Anthropic-direct chat providers in ai-models.ts
// (ADR 0003). The key is server-only runtime config, never sent to the client.

const VOYAGE_ENDPOINT = "https://api.voyageai.com/v1/contextualizedembeddings"
const EMBEDDING_MODEL = "voyage-context-3"
export const EMBEDDING_DIMENSIONS = 1024

// Response shape of the contextualized embeddings API: one outer `data` entry
// per input group (file/query), each carrying its chunks' embeddings. `index`
// fields order both levels.
const voyageResponseSchema = z.object({
  data: z.array(
    z.object({
      index: z.number(),
      data: z.array(z.object({ index: z.number(), embedding: z.array(z.number()) })),
    }),
  ),
})

function voyageKey(): string {
  const key = useRuntimeConfig().voyageApiKey
  if (key === "") {
    throw createError({
      statusCode: 500,
      statusMessage: "VOYAGE_API_KEY is not configured — RAG indexing is unavailable",
    })
  }
  return key
}

// Embed grouped inputs in one request. `inputs` is a list of groups; each group
// is a list of texts that share context (a file's chunks, or a single query).
// Returns embeddings shaped like `inputs`, reordered by the API's index fields.
async function contextualizedEmbeddings(
  inputs: string[][],
  inputType: "document" | "query",
): Promise<number[][][]> {
  const response = await fetch(VOYAGE_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${voyageKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      inputs,
      input_type: inputType,
      output_dimension: EMBEDDING_DIMENSIONS,
    }),
  })
  if (!response.ok) {
    throw createError({
      statusCode: 502,
      statusMessage: `Voyage embedding request failed (${response.status})`,
    })
  }
  const parsed = voyageResponseSchema.parse(await response.json())

  const groups: number[][][] = []
  for (const group of [...parsed.data].toSorted((a, b) => a.index - b.index)) {
    groups[group.index] = [...group.data]
      .toSorted((a, b) => a.index - b.index)
      .map((chunk) => chunk.embedding)
  }
  return groups
}

// Embed one file's chunks together so each vector carries its document's
// context (which also salvages headingless fallback chunks). Returns one
// embedding per chunk, in input order.
export async function embedDocumentChunks(chunks: string[]): Promise<number[][]> {
  if (chunks.length === 0) return []
  const [group] = await contextualizedEmbeddings([chunks], "document")
  return group ?? []
}

// Embed a single search query.
export async function embedQuery(query: string): Promise<number[]> {
  const [group] = await contextualizedEmbeddings([[query]], "query")
  const embedding = group?.[0]
  if (embedding === undefined) {
    throw createError({ statusCode: 502, statusMessage: "Voyage returned no query embedding" })
  }
  return embedding
}
