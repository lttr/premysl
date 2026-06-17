import { tool } from "ai"
import type { UIToolInvocation } from "ai"
import { repoSearchInputSchema, repoSearchOutputSchema } from "./repo-search"

// RAG retrieval tool (ADR 0003). Same single free-text query and the same
// output shape as repo_search, so the chat render component and source cards
// serve both paths — the comparison is retrieval quality, not two UIs. A chat
// only ever sees one of the two tools, picked from its retrieval mode, so the
// model can't mix methods.
export const REPO_RAG_DESCRIPTION =
  "Search the owner's linked GitHub repositories (their docs and notes) by meaning and keywords, and return grounded, citable snippets. Takes only a free-text query and searches all linked repositories at once — there is no repository argument. It matches passages that mean the same thing as the question even when they use different words, while still handling exact terms. Use this when the question is about the owner's own projects, notes, or documentation. Always cite the repository and file path of any snippet you use."

// Type-only definition for rendering the invocation in the chat UI; the
// executable version (with `execute`) is built per-request on the server because
// its search touches the database (server/api/chats/[id].post.ts → searchRagChunks).
export const repoRagTool = tool({
  description: REPO_RAG_DESCRIPTION,
  inputSchema: repoSearchInputSchema,
  outputSchema: repoSearchOutputSchema,
})

export type RepoRagUIToolInvocation = UIToolInvocation<typeof repoRagTool>
