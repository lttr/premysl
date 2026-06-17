import { db, schema } from "hub:db"
import { and, eq } from "drizzle-orm"
import { z } from "zod"

// Unlink a repository: delete its record and remove its snapshot from disk, so
// it can never resurface in a search result (visual spec).
export default defineEventHandler(async (event) => {
  const { id: userId } = await requireRequestUser(event)
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

  await db
    .delete(schema.linkedRepositories)
    .where(and(eq(schema.linkedRepositories.id, id), eq(schema.linkedRepositories.userId, userId)))
  await deleteSnapshotDir(row.snapshotPath)

  return { ok: true }
})
