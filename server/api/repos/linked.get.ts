import { db, schema } from "hub:db"
import { eq, desc } from "drizzle-orm"

// The owner's linked repositories, for the sidebar list.
export default defineEventHandler(async (event) => {
  const { id: userId } = await requireRequestUser(event)
  const rows = await db.query.linkedRepositories.findMany({
    where: () => eq(schema.linkedRepositories.userId, userId),
    orderBy: () => desc(schema.linkedRepositories.createdAt),
  })
  return rows.map((row) => toLinkedRepo(row))
})
