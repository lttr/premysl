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
  await downloadAndExtractSnapshot({
    token,
    fullName: row.fullName,
    ref: defaultBranch,
    destDir: row.snapshotPath,
    commitDate,
  })

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
