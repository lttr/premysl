import { execFile } from "node:child_process"
import { readFile, stat } from "node:fs/promises"
import { relative, sep } from "node:path"
import { rgPath } from "@vscode/ripgrep"
import { db, schema } from "hub:db"
import { eq } from "drizzle-orm"
import { z } from "zod"

// Whole file returned when at or under this size; otherwise a line window.
const WHOLE_FILE_MAX_BYTES = 12_000
// Lines of context kept on each side of the matched range.
const WINDOW_PADDING = 6
// Cap on files returned, to keep tool output within a sane token budget.
const MAX_FILES = 8

interface SnapshotRepo {
  fullName: string
  commitSha: string
  snapshotPath: string
}

interface FileHits {
  matchCount: number
  lines: number[]
}

// Build a case-insensitive OR regex from the query's words (length > 2). This is
// looser than exact-phrase matching, which would miss most prose. Returns null
// when the query has no usable words.
function queryToRegex(query: string): string | null {
  const words = query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []
  const usable = [...new Set(words.filter((w) => w.length > 2))]
  if (usable.length === 0) return null
  return usable.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")
}

// A single ripgrep `--json` "match" event (other event types are ignored).
const rgMatchSchema = z.object({
  type: z.literal("match"),
  data: z.object({
    path: z.object({ text: z.string() }),
    line_number: z.number(),
    submatches: z.array(z.unknown()),
  }),
})

// Run ripgrep (bundled binary, not a $PATH lookup) over the snapshot directories
// and return per-file hit info keyed by absolute file path.
async function runRipgrep(regex: string, dirs: string[]): Promise<Map<string, FileHits>> {
  return new Promise((resolve, reject) => {
    execFile(
      rgPath,
      ["--json", "--ignore-case", "-e", regex, ...dirs],
      { maxBuffer: 32 * 1024 * 1024 },
      (error, stdout) => {
        // ripgrep exits 1 when there are no matches — that is not an error.
        if (error && error.code !== 1) {
          reject(error instanceof Error ? error : new Error("ripgrep failed"))
          return
        }
        const hits = new Map<string, FileHits>()
        for (const line of stdout.split("\n")) {
          if (line === "") continue
          let parsed: unknown
          try {
            parsed = JSON.parse(line)
          } catch {
            continue
          }
          const event = rgMatchSchema.safeParse(parsed)
          if (!event.success) continue
          const path = event.data.data.path.text
          const entry = hits.get(path) ?? { matchCount: 0, lines: [] }
          entry.matchCount += event.data.data.submatches.length
          entry.lines.push(event.data.data.line_number)
          hits.set(path, entry)
        }
        resolve(hits)
      },
    )
  })
}

// Map an absolute matched file path back to the repo whose snapshot contains it.
function repoForPath(path: string, repos: SnapshotRepo[]): SnapshotRepo | undefined {
  return repos.find((r) => path === r.snapshotPath || path.startsWith(r.snapshotPath + sep))
}

async function buildSnippet(
  path: string,
  hit: FileHits,
  repo: SnapshotRepo,
  dates: Record<string, string>,
): Promise<RepoSearchSnippet | null> {
  let content: string
  let size: number
  try {
    content = await readFile(path, "utf8")
    size = (await stat(path)).size
  } catch {
    return null
  }
  const lines = content.split("\n")
  const relPath = relative(repo.snapshotPath, path).split(sep).join("/")

  let startLine: number
  let endLine: number
  let body: string
  let whole: boolean
  if (size <= WHOLE_FILE_MAX_BYTES) {
    startLine = 1
    endLine = lines.length
    body = content
    whole = true
  } else {
    const sorted = [...hit.lines].toSorted((a, b) => a - b)
    const first = sorted[0] ?? 1
    const last = sorted[sorted.length - 1] ?? first
    startLine = Math.max(1, first - WINDOW_PADDING)
    endLine = Math.min(lines.length, last + WINDOW_PADDING)
    body = lines.slice(startLine - 1, endLine).join("\n")
    whole = false
  }

  return {
    repo: repo.fullName,
    path: relPath,
    startLine,
    endLine,
    url: `https://github.com/${repo.fullName}/blob/${repo.commitSha}/${relPath}#L${startLine}-L${endLine}`,
    content: body,
    whole,
    lastChanged: dates[relPath],
  }
}

// Text-search every linked repository's snapshot for this user and return ranked
// snippets. The tool takes a query only — no repository argument (ADR 0002).
export async function searchLinkedRepos(userId: string, query: string): Promise<RepoSearchOutput> {
  const linked = await db.query.linkedRepositories.findMany({
    where: () => eq(schema.linkedRepositories.userId, userId),
  })
  const repos: SnapshotRepo[] = linked.map((r) => ({
    fullName: r.fullName,
    commitSha: r.commitSha,
    snapshotPath: r.snapshotPath,
  }))

  const regex = queryToRegex(query)
  if (repos.length === 0 || regex === null) {
    return { query, matches: [] }
  }

  const hits = await runRipgrep(
    regex,
    repos.map((r) => r.snapshotPath),
  )

  const ranked = [...hits.entries()]
    .toSorted((a, b) => b[1].matchCount - a[1].matchCount)
    .slice(0, MAX_FILES)

  // Load each snapshot's date manifest (relative path -> ISO date) once, so every
  // snippet can report its file's last-changed date.
  const datesByPath = new Map<string, Record<string, string>>()
  await Promise.all(
    repos.map(async (r) => {
      datesByPath.set(r.snapshotPath, await readDatesManifest(r.snapshotPath))
    }),
  )

  const built = await Promise.all(
    ranked.map(async ([path, hit]) => {
      const repo = repoForPath(path, repos)
      return repo === undefined
        ? null
        : buildSnippet(path, hit, repo, datesByPath.get(repo.snapshotPath) ?? {})
    }),
  )
  const matches = built.filter((snippet): snippet is RepoSearchSnippet => snippet !== null)

  return { query, matches }
}
