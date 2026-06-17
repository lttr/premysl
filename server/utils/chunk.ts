// Pure markdown chunking for RAG indexing (ADR 0003). No network, no DB.
//
// Where a file has headings, each section (a heading and its body up to the next
// heading) becomes one chunk, tagged with its heading path for citation and
// embedding context. Headingless regions — a bare file, or the preamble before
// the first heading — fall back to fixed-size token windows, so every file is
// covered, not just tidy ones. YAML frontmatter is stripped first; line numbers
// stay accurate to the original file so citations and dates line up with grep.

export interface MarkdownChunk {
  // The passage as it appears in the file — shown in the source card, indexed
  // for BM25, and the base of the embedded text.
  content: string
  // Heading path of the section ("Refresh › Cadence"), empty for window chunks.
  // Prepended to the embedded text so each vector carries its section context.
  headingPath: string
  // 1-based inclusive line range in the ORIGINAL file (frontmatter included).
  startLine: number
  endLine: number
}

const HEADING_RE = /^#{1,6}\s+\S/
const HEADING_PARTS_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/

// ~500-token target window with ~50-token overlap, approximated at ~4 chars per
// token (no tokenizer dependency in the stack).
const WINDOW_CHARS = 2000
const WINDOW_OVERLAP_CHARS = 200

// Remove a leading YAML frontmatter block, reporting how many lines it spanned
// so chunk line numbers can be offset back to the original file.
function stripFrontmatter(text: string): { body: string; lineOffset: number } {
  const match = /^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/.exec(text)
  if (match === null) return { body: text, lineOffset: 0 }
  const removed = match[0]
  return { body: text.slice(removed.length), lineOffset: removed.split("\n").length - 1 }
}

function lineLen(lines: string[], i: number): number {
  return (lines[i] ?? "").length + 1
}

// Find the window end: advance from `start` until the char budget is reached.
function windowEnd(lines: string[], start: number): number {
  let end = start
  let chars = 0
  while (end < lines.length && chars < WINDOW_CHARS) {
    chars += lineLen(lines, end)
    end++
  }
  return end
}

// Step back ~one overlap's worth of characters from `end`, always staying ahead
// of `start` so the walk makes forward progress.
function overlapStart(lines: string[], start: number, end: number): number {
  let back = 0
  let next = end
  while (next > start + 1 && back < WINDOW_OVERLAP_CHARS) {
    next--
    back += lineLen(lines, next)
  }
  return next
}

// Split a headingless run of lines into overlapping fixed-size windows. `origin`
// is the original 1-based line number of `lines[0]`.
function windowChunks(lines: string[], origin: number): MarkdownChunk[] {
  const chunks: MarkdownChunk[] = []
  let start = 0
  while (start < lines.length) {
    const end = windowEnd(lines, start)
    const content = lines.slice(start, end).join("\n").trim()
    if (content !== "") {
      chunks.push({
        content,
        headingPath: "",
        startLine: origin + start,
        endLine: origin + end - 1,
      })
    }
    if (end >= lines.length) break
    start = overlapStart(lines, start, end)
  }
  return chunks
}

// Heading-path stack: dropping deeper-or-equal levels as new headings open.
function makeHeadingPath() {
  const stack: { level: number; text: string }[] = []
  return (level: number, text: string): string => {
    while (stack.length > 0 && (stack.at(-1)?.level ?? 0) >= level) stack.pop()
    stack.push({ level, text })
    return stack.map((entry) => entry.text).join(" › ")
  }
}

// One chunk for a heading section (lines[start..end), origin-relative).
function sectionChunk(
  lines: string[],
  range: { start: number; end: number },
  origin: number,
  pathFor: (level: number, text: string) => string,
): MarkdownChunk | null {
  const { start, end } = range
  const parts = HEADING_PARTS_RE.exec(lines[start] ?? "")
  const level = parts?.[1]?.length ?? 1
  const headingPath = pathFor(level, parts?.[2]?.trim() ?? "")
  const content = lines.slice(start, end).join("\n").trim()
  if (content === "") return null
  return { content, headingPath, startLine: origin + start, endLine: origin + end - 1 }
}

export function chunkMarkdown(fileText: string): MarkdownChunk[] {
  const { body, lineOffset } = stripFrontmatter(fileText)
  const lines = body.split("\n")
  const origin = lineOffset + 1

  const headings = lines.flatMap((line, i) => (HEADING_RE.test(line) ? [i] : []))
  const firstHeading = headings[0]
  if (firstHeading === undefined) return windowChunks(lines, origin)

  const chunks: MarkdownChunk[] = []
  // Preamble before the first heading falls back to windows.
  if (firstHeading > 0) chunks.push(...windowChunks(lines.slice(0, firstHeading), origin))

  const pathFor = makeHeadingPath()
  for (const [n, start] of headings.entries()) {
    const end = headings[n + 1] ?? lines.length
    const chunk = sectionChunk(lines, { start, end }, origin, pathFor)
    if (chunk !== null) chunks.push(chunk)
  }
  return chunks
}
