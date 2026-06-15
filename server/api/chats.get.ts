import { db, schema } from "hub:db"
import { eq, desc } from "drizzle-orm"

export default defineEventHandler(async (event) => {
  const { id: userId } = await requireRequestUser(event)

  return db.query.chats.findMany({
    where: () => eq(schema.chats.userId, userId),
    orderBy: () => desc(schema.chats.createdAt),
  })
})
