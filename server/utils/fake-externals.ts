import { MockLanguageModelV3 } from "ai/test"
import { simulateReadableStream } from "ai"
import type { LanguageModel } from "ai"
import type { AvailableRepo } from "./github"

// Offline fakes for the external systems that sit behind auth, so e2e /
// agent-browser runs exercise the full behind-auth surface without hitting the
// LLM provider (and, later, Voyage and GitHub) — deterministically and for free.
//
// Fails closed, like the test-login endpoint: only active when NUXT_FAKE_EXTERNALS
// is set AND we are in a dev build (import.meta.dev is compiled to false in
// production, so the whole fake path is tree-shaken out). Off by default, so real
// behavior is unchanged. This is the single switch for offline dev. Never wire
// any fake into the UI.
export function fakeExternalsEnabled(): boolean {
  return import.meta.dev && flagEnabled(useRuntimeConfig().fakeExternals)
}

// Nuxt parses runtime-config env overrides with destr, so NUXT_*=1 arrives as the
// number 1 and =true as the boolean true (never the string "1"). Read these flags
// by truthiness; an unset key keeps its "" default, which is falsy.
export function flagEnabled(value: unknown): boolean {
  return Boolean(value)
}

// Derive the v3 stream/generate result shapes straight from the mock model, so
// this file needs no dependency on @ai-sdk/provider (a transitive package, not
// resolvable as a bare import here).
type StreamResult = Awaited<ReturnType<MockLanguageModelV3["doStream"]>>
type StreamPart = StreamResult["stream"] extends ReadableStream<infer P> ? P : never
type GenerateResult = Awaited<ReturnType<MockLanguageModelV3["doGenerate"]>>

// One synthetic token's worth of usage — enough to satisfy the result shape; the
// exact counts don't matter offline.
const FAKE_USAGE: GenerateResult["usage"] = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
}

const FAKE_REPLY =
  "This is a deterministic offline reply from the fake language model. " +
  "External providers are disabled (NUXT_FAKE_EXTERNALS), so no request left the machine."

// Canned text stream, split into a few deltas so the UI exercises its streaming
// path. Programmable behavior (branch on the last message, emit a tool call) is
// a deliberate upgrade for when a test needs to assert tool-calling — start
// canned (spec: offline-test fakes).
function cannedStream(): ReadableStream<StreamPart> {
  const deltas = FAKE_REPLY.match(/\S+\s*/g) ?? [FAKE_REPLY]
  const chunks: StreamPart[] = [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "0" },
    ...deltas.map((delta): StreamPart => ({ type: "text-delta", id: "0", delta })),
    { type: "text-end", id: "0" },
    { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage: FAKE_USAGE },
  ]
  return simulateReadableStream({ chunks, initialDelayInMs: 0, chunkDelayInMs: 0 })
}

// A MockLanguageModelV3 standing in for any real provider model. Implements both
// doStream (chat) and doGenerate (lazy chat titles) so the whole chat path runs
// offline; both return the same canned text.
export function fakeLanguageModel(modelId: string): LanguageModel {
  const generated: GenerateResult = {
    content: [{ type: "text", text: FAKE_REPLY }],
    finishReason: { unified: "stop", raw: undefined },
    usage: FAKE_USAGE,
    warnings: [],
  }
  return new MockLanguageModelV3({
    provider: "fake",
    modelId,
    doStream: async () => ({ stream: cannedStream() }),
    doGenerate: async () => generated,
  })
}

// --- GitHub fake (step 2) ---------------------------------------------------
//
// Fixed fixtures standing in for the GitHub API: the repo picker list, repo
// metadata, and a snapshot file tree. They make the real link / refresh code
// path (server/utils/github.ts) run fully offline, so step 1's seed-repo route
// is no longer the only way to get a linked repository on disk.

export const FAKE_REPO_FULL_NAME = "premysl-test/fixture-notes"
export const FAKE_DEFAULT_BRANCH = "main"
export const FAKE_COMMIT_SHA = "0000000000000000000000000000000000000000"
export const FAKE_COMMIT_DATE = "2026-01-01T00:00:00Z"

// A token that is non-empty so requireGithubToken's guard passes; never sent to
// GitHub because every github.ts chokepoint short-circuits in fake mode.
export const FAKE_GITHUB_TOKEN = "fake-github-token"

// A tiny markdown tree with distinctive words so grep and RAG retrieval have
// stable, assertable hits. Keyed by repo-relative path.
export const FAKE_FIXTURE_FILES: Record<string, string> = {
  "README.md":
    "# Fixture Notes\n\n" +
    "A deterministic offline fixture repository for testing linked-repository " +
    "retrieval. It contains notes about widgets and the deployment runbook.\n",
  "notes/widgets.md":
    "# Widgets\n\n" +
    "A widget is the core fixture concept. Widgets are assembled from sprockets " +
    "and cogs. The widget assembly line runs nightly.\n",
  "notes/deployment.md":
    "# Deployment Runbook\n\n" +
    "Deploy by pushing to main. The runbook covers rollback and the smoke test " +
    "checklist for the staging environment.\n",
}

// The picker list: the fixture repo plus a couple of inert entries so the
// client-side filter has something to filter.
export function fakeOwnerRepos(): AvailableRepo[] {
  return [
    {
      fullName: FAKE_REPO_FULL_NAME,
      name: "fixture-notes",
      owner: "premysl-test",
      description: "Deterministic offline fixture repository",
      private: false,
      defaultBranch: FAKE_DEFAULT_BRANCH,
    },
    {
      fullName: "premysl-test/empty-repo",
      name: "empty-repo",
      owner: "premysl-test",
      description: null,
      private: true,
      defaultBranch: FAKE_DEFAULT_BRANCH,
    },
  ]
}

// Fixed repo metadata for any fullName (the link / refresh flow only links the
// fixture repo, but stay total so callers never hit the network).
export function fakeRepoMeta(): { defaultBranch: string; commitSha: string; commitDate: string } {
  return {
    defaultBranch: FAKE_DEFAULT_BRANCH,
    commitSha: FAKE_COMMIT_SHA,
    commitDate: FAKE_COMMIT_DATE,
  }
}

// --- Voyage fake (step 3) ---------------------------------------------------
//
// Deterministic stand-in for Voyage embeddings: a normalized bag-of-words hash
// vector. Text sharing words lands nearby under cosine distance, so RAG ranking
// over the fixtures is stable and dependency-free. `dims` is passed in (rather
// than imported from voyage.ts) to avoid a circular module dependency.

function hashToken(token: string): number {
  // FNV-1a, 32-bit. Deterministic across runs, well-spread across buckets.
  let h = 2166136261
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function fakeEmbedding(text: string, dims: number): number[] {
  const vec: number[] = Array.from({ length: dims }, () => 0)
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? []
  for (const token of tokens) {
    const bucket = hashToken(token) % dims
    vec[bucket] = (vec[bucket] ?? 0) + 1
  }
  // Normalize to unit length so cosine distance is well-behaved.
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1
  return vec.map((v) => v / norm)
}
