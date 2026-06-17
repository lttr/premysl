import { db, schema } from "hub:db"
import { and, eq } from "drizzle-orm"
import { z } from "zod"

// Link a repository: record it and download its initial snapshot synchronously so
// it is immediately searchable (visual spec, ADR 0002).
export default defineEventHandler(async (event) => {
  const { id: userId } = await requireRequestUser(event)
  const token = await requireGithubToken(event)

  const { fullName } = await readValidatedBody(event, (data) =>
    z.object({ fullName: z.string().min(1) }).parse(data),
  )

  const existing = await db.query.linkedRepositories.findFirst({
    where: () =>
      and(
        eq(schema.linkedRepositories.userId, userId),
        eq(schema.linkedRepositories.fullName, fullName),
      ),
  })
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: "Repository already linked" })
  }

  const { defaultBranch, commitSha, commitDate } = await getRepoMeta(token, fullName)

  const id = crypto.randomUUID()
  const snapshotPath = snapshotPathFor(id)
  const { relPaths } = await downloadAndExtractSnapshot({
    token,
    fullName,
    ref: defaultBranch,
    destDir: snapshotPath,
    commitDate,
  })

  let row: typeof schema.linkedRepositories.$inferSelect | undefined
  try {
    ;[row] = await db
      .insert(schema.linkedRepositories)
      .values({ id, userId, fullName, defaultBranch, snapshotPath, commitSha })
      .returning()
    if (!row) {
      throw createError({ statusCode: 500, statusMessage: "Failed to link repository" })
    }
  } catch (error) {
    // Roll back the on-disk snapshot if the record could not be written.
    await deleteSnapshotDir(snapshotPath)
    throw error
  }

  // Index for RAG within this request (ADR 0003). All-or-nothing: if embedding
  // fails the repo is left unindexed (no half-index) but stays linked and
  // grep-searchable; surface it so the owner can refresh to retry.
  try {
    await indexRepoChunks({
      userId,
      linkedRepositoryId: id,
      repoFullName: fullName,
      commitSha,
      snapshotPath,
      relPaths,
    })
  } catch (error) {
    console.error("[link] RAG indexing failed:", error)
    throw createError({
      statusCode: 502,
      statusMessage:
        "Repository linked and searchable with grep, but RAG indexing failed. Refresh the repository to retry RAG indexing.",
    })
  }

  return toLinkedRepo(row)
})
