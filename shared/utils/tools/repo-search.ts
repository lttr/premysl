import { tool } from "ai"
import { z } from "zod"
import type { UIToolInvocation } from "ai"

// One retrieved piece of a file: provenance on top, content below (visual spec).
export const repoSearchSnippetSchema = z.object({
  // owner/name of the linked repository the match came from.
  repo: z.string(),
  // Path of the file inside that repository.
  path: z.string(),
  startLine: z.number(),
  endLine: z.number(),
  // Commit-pinned GitHub URL (blob/{sha}/{path}#L{a}-L{b}) — stays line-accurate.
  url: z.string(),
  // Whole small file, or a window of lines around the match.
  content: z.string(),
  // True when the whole file was returned; false for a line window.
  whole: z.boolean(),
})

export const repoSearchInputSchema = z.object({
  query: z
    .string()
    .describe("Free-text search query. Searches all of the owner's linked repositories at once."),
})

export const repoSearchOutputSchema = z.object({
  query: z.string(),
  matches: z.array(repoSearchSnippetSchema),
})

export type RepoSearchSnippet = z.infer<typeof repoSearchSnippetSchema>
export type RepoSearchOutput = z.infer<typeof repoSearchOutputSchema>

export const REPO_SEARCH_DESCRIPTION =
  "Search the owner's linked GitHub repositories (their docs and notes) for material relevant to the question, and return grounded, citable snippets. Takes only a free-text query and searches all linked repositories at once — there is no repository argument. Use this when the question is about the owner's own projects, notes, or documentation. Always cite the repository and file path of any snippet you use."

// Type-only tool definition for rendering the invocation in the chat UI. The
// executable version (with `execute`) is built per-request on the server because
// its search touches the database and the local filesystem (see
// server/api/chats/[id].post.ts and server/utils/retrieval.ts).
export const repoSearchTool = tool({
  description: REPO_SEARCH_DESCRIPTION,
  inputSchema: repoSearchInputSchema,
  outputSchema: repoSearchOutputSchema,
})

export type RepoSearchUIToolInvocation = UIToolInvocation<typeof repoSearchTool>
