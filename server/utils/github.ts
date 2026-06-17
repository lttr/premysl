import type { H3Event } from "h3"
import { createGunzip } from "node:zlib"
import { Readable } from "node:stream"
import { buffer } from "node:stream/consumers"
import { mkdir, rm, writeFile } from "node:fs/promises"
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
// recorded so retrieved snippets cite a commit-pinned URL (ADR 0002).
export async function getRepoMeta(
  token: string,
  fullName: string,
): Promise<{ defaultBranch: string; commitSha: string }> {
  const { default_branch: defaultBranch } = await ghGet(
    token,
    `/repos/${fullName}`,
    z.object({ default_branch: z.string() }),
  )
  const { sha: commitSha } = await ghGet(
    token,
    `/repos/${fullName}/commits/${encodeURIComponent(defaultBranch)}`,
    z.object({ sha: z.string() }),
  )
  return { defaultBranch, commitSha }
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
// files into `destDir`. Returns the number of markdown files written.
async function extractMarkdown(tarball: Buffer, destDir: string): Promise<number> {
  const ex = extract()
  const gunzip = createGunzip()
  const src = Readable.from(tarball)
  src.on("error", (error: Error) => ex.destroy(error))
  gunzip.on("error", (error: Error) => ex.destroy(error))
  src.pipe(gunzip).pipe(ex)

  let fileCount = 0
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
    fileCount++
  }
  return fileCount
}

// Download the default-branch tarball and extract only its markdown files into
// `destDir`, in-process so no system `tar`/`rg` is needed (ADR 0002). Replaces
// any prior snapshot wholesale (refresh semantics).
export async function downloadAndExtractSnapshot(
  token: string,
  fullName: string,
  ref: string,
  destDir: string,
): Promise<{ fileCount: number }> {
  const response = await ghFetch(token, `/repos/${fullName}/tarball/${encodeURIComponent(ref)}`)
  const tarball = Buffer.from(await response.arrayBuffer())

  await rm(destDir, { recursive: true, force: true })
  await mkdir(destDir, { recursive: true })
  const fileCount = await extractMarkdown(tarball, destDir)
  return { fileCount }
}

// Remove a snapshot directory from disk (unlink, or before a failed link rolls back).
export async function deleteSnapshotDir(destDir: string): Promise<void> {
  await rm(destDir, { recursive: true, force: true })
}
