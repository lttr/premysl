import { db, schema } from "hub:db"
import { and, eq } from "drizzle-orm"
import { z } from "zod"

export default defineEventHandler(async (event) => {
  const { id: userId } = await requireRequestUser(event)

  const { id } = await getValidatedRouterParams(event, (data) =>
    z.object({ id: z.string() }).parse(data),
  )

  const chat = await db.query.chats.findFirst({
    where: () => and(eq(schema.chats.id, id), eq(schema.chats.userId, userId)),
  })

  if (!chat) {
    throw createError({ statusCode: 404, statusMessage: "Chat not found" })
  }

  return db.select().from(schema.votes).where(eq(schema.votes.chatId, id))
})
