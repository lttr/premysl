import type { H3Event } from "h3"
import { createGunzip } from "node:zlib"
import { Readable } from "node:stream"
import { buffer } from "node:stream/consumers"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve, sep } from "node:path"
import { extract } from "tar-stream"
import { z } from "zod"

const GITHUB_API = "https://api.github.com"

// A repository the owner owns, as shown in the picker.
export interface AvailableRepo {
  fullName: string
  name: string
  owner: string
  description: string | null
  private: boolean
  defaultBranch: string
}

// The owner's GitHub connection (OAuth access token) lives only in the session's
// server-only `secure` field. Fail closed with a clear message when it is absent
// (e.g. open mode with no GitHub login yet).
export async function requireGithubToken(event: H3Event): Promise<string> {
  const session = await getUserSession(event)
  const token = session.secure?.githubToken
  if (token === undefined || token === "") {
    throw createError({
      statusCode: 400,
      statusMessage: "GitHub connection required — log in with GitHub first",
    })
  }
  return token
}

async function ghFetch(token: string, path: string): Promise<Response> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "premysl",
    },
  })
  if (!response.ok) {
    throw createError({
      statusCode: 502,
      statusMessage: `GitHub request failed (${response.status}) for ${path}`,
    })
  }
  return response
}

// Fetch and validate a JSON GitHub response, so no unsafe `any` crosses into the
// app.
async function ghGet<T>(token: string, path: string, schema: z.ZodType<T>): Promise<T> {
  const response = await ghFetch(token, path)
  return schema.parse(await response.json())
}

// Run and validate a GitHub GraphQL query. Used to fetch many files' last-commit
// dates in a few batched requests, where REST would be one request per file.
async function ghGraphQL<T>(
  token: string,
  query: string,
  variables: Record<string, string>,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await fetch(`${GITHUB_API}/graphql`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "premysl",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!response.ok) {
    throw createError({
      statusCode: 502,
      statusMessage: `GitHub GraphQL request failed (${response.status})`,
    })
  }
  return schema.parse(await response.json())
}

const rawRepoSchema = z.object({
  name: z.string(),
  full_name: z.string(),
  owner: z.object({ login: z.string() }),
  description: z.string().nullable(),
  private: z.boolean(),
  default_branch: z.string(),
})

// List every repository the owner owns (public and private), paginated. Filtered
// to `owner` affiliation so the list matches "my repos" and stays short; the
// picker filters it client-side (PRD).
export async function listOwnerRepos(token: string): Promise<AvailableRepo[]> {
  const repos: AvailableRepo[] = []
  const perPage = 100
  for (let page = 1; page <= 20; page++) {
    const batch = await ghGet(
      token,
      `/user/repos?affiliation=owner&per_page=${perPage}&page=${page}&sort=updated`,
      z.array(rawRepoSchema),
    )
    for (const repo of batch) {
      repos.push({
        fullName: repo.full_name,
        name: repo.name,
        owner: repo.owner.login,
        description: repo.description,
        private: repo.private,
        defaultBranch: repo.default_branch,
      })
    }
    if (batch.length < perPage) break
  }
  return repos
}

// Resolve a repository's default branch and the current commit on it. The SHA is
// recorded so retrieved snippets cite a commit-pinned URL (ADR 0002); the commit
// date is the per-file fallback when a file's own last-changed date can't be
// resolved.
export async function getRepoMeta(
  token: string,
  fullName: string,
): Promise<{ defaultBranch: string; commitSha: string; commitDate: string }> {
  const { default_branch: defaultBranch } = await ghGet(
    token,
    `/repos/${fullName}`,
    z.object({ default_branch: z.string() }),
  )
  const { sha: commitSha, commit } = await ghGet(
    token,
    `/repos/${fullName}/commits/${encodeURIComponent(defaultBranch)}`,
    z.object({ sha: z.string(), commit: z.object({ committer: z.object({ date: z.string() }) }) }),
  )
  return { defaultBranch, commitSha, commitDate: commit.committer.date }
}

// Sidecar manifest inside each snapshot: relative file path -> ISO 8601
// last-changed date. A hidden dotfile, so ripgrep skips it during search.
export const DATES_MANIFEST = ".dates.json"

const datesManifestSchema = z.record(z.string(), z.string())

// Read a snapshot's date manifest; {} when absent or unreadable (e.g. a snapshot
// taken before per-file dates were tracked).
export async function readDatesManifest(snapshotPath: string): Promise<Record<string, string>> {
  try {
    const raw = await readFile(join(snapshotPath, DATES_MANIFEST), "utf8")
    return datesManifestSchema.parse(JSON.parse(raw))
  } catch {
    return {}
  }
}

const historyFieldSchema = z.object({ nodes: z.array(z.object({ committedDate: z.string() })) })
const graphqlDatesSchema = z.object({
  data: z
    .object({
      repository: z
        .object({ object: z.record(z.string(), historyFieldSchema).nullable() })
        .nullable(),
    })
    .nullable(),
})
const restCommitsSchema = z.array(
  z.object({ commit: z.object({ committer: z.object({ date: z.string() }) }) }),
)

// Aliased history(first:1) fields per GraphQL request. Conservative, to stay well
// within GraphQL node/complexity limits.
const DATES_BATCH = 100

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

// Last-changed dates for one batch of paths via a single GraphQL request. Paths
// the query did not resolve are simply absent from the returned map.
async function graphqlDates(
  token: string,
  vars: { owner: string; name: string; ref: string },
  batch: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const fields = batch
    .map(
      (p, i) => `f${i}: history(first: 1, path: ${JSON.stringify(p)}) { nodes { committedDate } }`,
    )
    .join("\n")
  const query = `query($owner: String!, $name: String!, $ref: String!) {
    repository(owner: $owner, name: $name) {
      object(expression: $ref) { ... on Commit { ${fields} } }
    }
  }`
  try {
    const parsed = await ghGraphQL(token, query, vars, graphqlDatesSchema)
    const object = parsed.data?.repository?.object
    if (object === null || object === undefined) return out
    for (const [i, p] of batch.entries()) {
      const date = object[`f${i}`]?.nodes[0]?.committedDate
      if (date !== undefined) out.set(p, date)
    }
  } catch {
    // Caller's REST fallback covers this batch's paths.
  }
  return out
}

// Last-changed date for a single path via the REST commits API; undefined on
// failure or no commits.
async function restDate(
  token: string,
  fullName: string,
  ref: string,
  path: string,
): Promise<string | undefined> {
  try {
    const commits = await ghGet(
      token,
      `/repos/${fullName}/commits?sha=${encodeURIComponent(ref)}&per_page=1&path=${encodeURIComponent(path)}`,
      restCommitsSchema,
    )
    return commits[0]?.commit.committer.date
  } catch {
    return undefined
  }
}

// Resolve each file's last-changed date (the most recent commit touching it on
// `ref`). The tarball carries no history, so dates come from the API: batched
// GraphQL first, per-path REST as a fallback for anything GraphQL did not return.
// Paths still unresolved are absent from the map (caller substitutes the commit date).
async function fetchFileDates(
  token: string,
  fullName: string,
  ref: string,
  paths: string[],
): Promise<Map<string, string>> {
  const dates = new Map<string, string>()
  const [owner, name] = fullName.split("/")
  if (owner === undefined || name === undefined) return dates

  for (const batch of chunk(paths, DATES_BATCH)) {
    const batchDates = await graphqlDates(token, { owner, name, ref }, batch)
    for (const [p, date] of batchDates) dates.set(p, date)
  }

  for (const p of paths) {
    if (dates.has(p)) continue
    const date = await restDate(token, fullName, ref, p)
    if (date !== undefined) dates.set(p, date)
  }

  return dates
}

// Everything needed to build a snapshot: the GitHub token, the repo and ref to
// download, where to put it, and the snapshot commit date used as the per-file
// date fallback.
export interface SnapshotInput {
  token: string
  fullName: string
  ref: string
  destDir: string
  commitDate: string
}

// Fetch per-file dates and write the snapshot's date manifest. Every extracted
// file gets an entry: its own last-changed date, or the snapshot commit date as
// fallback, so retrieval always has a date to report.
async function writeDatesManifest(input: SnapshotInput, relPaths: string[]): Promise<void> {
  const { token, fullName, ref, destDir, commitDate } = input
  const fetched = await fetchFileDates(token, fullName, ref, relPaths)
  const manifest: Record<string, string> = {}
  for (const p of relPaths) manifest[p] = fetched.get(p) ?? commitDate
  await writeFile(join(destDir, DATES_MANIFEST), JSON.stringify(manifest))
}

// Base directory for all snapshots, under the persistent .data volume (ADR 0002).
export function reposBaseDir(): string {
  return resolve(process.cwd(), ".data", "repos")
}

// Absolute snapshot directory for a linked-repository id.
export function snapshotPathFor(id: string): string {
  return join(reposBaseDir(), id)
}

const MARKDOWN_RE = /\.(md|mdx|markdown)$/i

// Drop the tarball's top-level `owner-repo-sha/` directory from an entry name.
function stripTopDir(name: string): string {
  const slash = name.indexOf("/")
  return slash === -1 ? "" : name.slice(slash + 1)
}

// Guard against path traversal from a malicious entry name.
function isInside(base: string, target: string): boolean {
  return target === base || target.startsWith(base + sep)
}

// Stream the tarball through gunzip + a tar reader and write ONLY its markdown
// files into `destDir`. Returns the relative paths of the files written.
async function extractMarkdown(tarball: Buffer, destDir: string): Promise<string[]> {
  const ex = extract()
  const gunzip = createGunzip()
  const src = Readable.from(tarball)
  src.on("error", (error: Error) => ex.destroy(error))
  gunzip.on("error", (error: Error) => ex.destroy(error))
  src.pipe(gunzip).pipe(ex)

  const relPaths: string[] = []
  for await (const entry of ex) {
    const rel = stripTopDir(entry.header.name)
    const target = join(destDir, rel)
    if (
      entry.header.type !== "file" ||
      rel === "" ||
      !MARKDOWN_RE.test(rel) ||
      !isInside(destDir, target)
    ) {
      entry.resume()
      continue
    }
    const data = await buffer(entry)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, data)
    relPaths.push(rel)
  }
  return relPaths
}

// Download the default-branch tarball and extract only its markdown files into
// `destDir`, in-process so no system `tar`/`rg` is needed (ADR 0002). Replaces
// any prior snapshot wholesale (refresh semantics).
export async function downloadAndExtractSnapshot(
  input: SnapshotInput,
): Promise<{ fileCount: number }> {
  const { token, fullName, ref, destDir } = input
  const response = await ghFetch(token, `/repos/${fullName}/tarball/${encodeURIComponent(ref)}`)
  const tarball = Buffer.from(await response.arrayBuffer())

  await rm(destDir, { recursive: true, force: true })
  await mkdir(destDir, { recursive: true })
  const relPaths = await extractMarkdown(tarball, destDir)
  await writeDatesManifest(input, relPaths)
  return { fileCount: relPaths.length }
}

// Remove a snapshot directory from disk (unlink, or before a failed link rolls back).
export async function deleteSnapshotDir(destDir: string): Promise<void> {
  await rm(destDir, { recursive: true, force: true })
}
