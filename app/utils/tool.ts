import type { getToolName } from "ai"

export interface Source {
  url: string
  title?: string
}

type ToolPart = Parameters<typeof getToolName>[0]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function getSearchQuery(part: ToolPart): string | undefined {
  const input: unknown = part.input
  if (isRecord(input) && typeof input.query === "string") {
    return input.query
  }
  return undefined
}

function toSource(value: unknown): Source | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.url !== "string" || value.url === "") return undefined
  return {
    url: value.url,
    title: typeof value.title === "string" ? value.title : undefined,
  }
}

function sourcesFromArray(output: unknown[]): Source[] {
  const result: Source[] = []
  for (const item of output) {
    const source = toSource(item)
    if (source) result.push(source)
  }
  return result
}

function sourceFromGroundingChunk(chunk: unknown): Source | undefined {
  if (!isRecord(chunk)) return undefined
  const web = chunk.web
  if (!isRecord(web) || typeof web.uri !== "string" || web.uri === "") return undefined
  return {
    url: web.uri,
    title: typeof web.title === "string" ? web.title : undefined,
  }
}

function sourcesFromChunks(chunks: unknown[]): Source[] {
  const result: Source[] = []
  for (const chunk of chunks) {
    const source = sourceFromGroundingChunk(chunk)
    if (source) result.push(source)
  }
  return result
}

export function getSources(part: ToolPart): Source[] {
  const output: unknown = part.output
  if (!isRecord(output) && !Array.isArray(output)) return []

  // Anthropic: array of { url, title }
  if (Array.isArray(output)) {
    return sourcesFromArray(output)
  }

  // OpenAI: { sources: [{ type: 'url', url }] }
  if (Array.isArray(output.sources)) {
    return sourcesFromArray(output.sources).map((s) => ({ url: s.url }))
  }

  // Google: grounding chunks with { web: { uri, title } }
  const metadata = output.groundingMetadata
  const chunks = Array.isArray(output.groundingChunks)
    ? output.groundingChunks
    : isRecord(metadata) && Array.isArray(metadata.groundingChunks)
      ? metadata.groundingChunks
      : undefined
  if (chunks) {
    return sourcesFromChunks(chunks)
  }

  return []
}

export function sourceToInlineMdc(url: string): string {
  const domain = getDomain(url)
  const favicon = getFaviconUrl(url)
  const safeUrl = url.replace(/"/g, "&quot;")
  const safeFavicon = favicon.replace(/"/g, "&quot;")

  return ` :source-link{url="${safeUrl}" favicon="${safeFavicon}" label="${domain}"}`
}
