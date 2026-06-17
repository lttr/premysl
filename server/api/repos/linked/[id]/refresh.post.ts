import { db, schema } from "hub:db"
import { and, eq } from "drizzle-orm"
import { z } from "zod"

// Refresh a snapshot: re-download the current default branch and replace the
// snapshot wholesale, updating the last-refreshed time. Manual, owner-initiated
// only (ADR 0002).
export default defineEventHandler(async (event) => {
  const { id: userId } = await requireRequestUser(event)
  const token = await requireGithubToken(event)
  const { id } = await getValidatedRouterParams(event, (data) =>
    z.object({ id: z.string() }).parse(data),
  )

  const row = await db.query.linkedRepositories.findFirst({
    where: () =>
      and(eq(schema.linkedRepositories.id, id), eq(schema.linkedRepositories.userId, userId)),
  })
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: "Linked repository not found" })
  }

  const { defaultBranch, commitSha, commitDate } = await getRepoMeta(token, row.fullName)
  const { relPaths } = await downloadAndExtractSnapshot({
    token,
    fullName: row.fullName,
    ref: defaultBranch,
    destDir: row.snapshotPath,
    commitDate,
  })

  // Rebuild the RAG index from the new snapshot so RAG is as fresh as grep
  // (ADR 0003). All-or-nothing: if embedding fails the prior index survives,
  // so it is never left half-rebuilt — surface it and the owner can retry.
  try {
    await indexRepoChunks({
      userId,
      linkedRepositoryId: id,
      repoFullName: row.fullName,
      commitSha,
      snapshotPath: row.snapshotPath,
      relPaths,
    })
  } catch (error) {
    console.error("[refresh] RAG re-indexing failed:", error)
    throw createError({
      statusCode: 502,
      statusMessage:
        "Snapshot refreshed for grep, but RAG re-indexing failed. Try refreshing again.",
    })
  }

  const [updated] = await db
    .update(schema.linkedRepositories)
    .set({ defaultBranch, commitSha, lastRefreshedAt: new Date() })
    .where(and(eq(schema.linkedRepositories.id, id), eq(schema.linkedRepositories.userId, userId)))
    .returning()
  if (!updated) {
    throw createError({ statusCode: 500, statusMessage: "Failed to refresh repository" })
  }
  return toLinkedRepo(updated)
})
