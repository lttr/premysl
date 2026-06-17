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

  const { defaultBranch, commitSha } = await getRepoMeta(token, fullName)

  const id = crypto.randomUUID()
  const snapshotPath = snapshotPathFor(id)
  await downloadAndExtractSnapshot(token, fullName, defaultBranch, snapshotPath)

  try {
    const [row] = await db
      .insert(schema.linkedRepositories)
      .values({ id, userId, fullName, defaultBranch, snapshotPath, commitSha })
      .returning()
    if (!row) {
      throw createError({ statusCode: 500, statusMessage: "Failed to link repository" })
    }
    return toLinkedRepo(row)
  } catch (error) {
    // Roll back the on-disk snapshot if the record could not be written.
    await deleteSnapshotDir(snapshotPath)
    throw error
  }
})
