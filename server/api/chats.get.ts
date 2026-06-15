import { db, schema } from "hub:db"
import { eq, desc } from "drizzle-orm"

function sessionUserId(session: unknown): string {
  if (typeof session !== "object" || session === null) {
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" })
  }
  const { id, user } = session as { id?: unknown; user?: { id?: unknown } }
  if (typeof user?.id === "string") return user.id
  if (typeof id === "string") return id
  throw createError({ statusCode: 401, statusMessage: "Unauthorized" })
}

export default defineEventHandler(async (event) => {
  const userId = sessionUserId(await getUserSession(event))

  return db.query.chats.findMany({
    where: () => eq(schema.chats.userId, userId),
    orderBy: () => desc(schema.chats.createdAt),
  })
})
