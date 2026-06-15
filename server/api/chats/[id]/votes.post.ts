import { db, schema } from "hub:db"
import { and, eq } from "drizzle-orm"
import { z } from "zod"

const sessionSchema = z.object({
  id: z.string(),
  user: z.object({ id: z.string() }).partial().optional(),
})

export default defineEventHandler(async (event) => {
  const session = sessionSchema.parse(await getUserSession(event))
  const userId = session.user?.id ?? session.id

  const { id } = await getValidatedRouterParams(event, (data) =>
    z.object({ id: z.string() }).parse(data),
  )

  const { messageId, isUpvoted } = await readValidatedBody(event, (data) =>
    z.object({ messageId: z.string(), isUpvoted: z.boolean().optional() }).parse(data),
  )

  const chat = await db.query.chats.findFirst({
    where: () => and(eq(schema.chats.id, id), eq(schema.chats.userId, userId)),
  })

  if (!chat) {
    throw createError({ statusCode: 404, statusMessage: "Chat not found" })
  }

  const message = await db.query.messages.findFirst({
    where: () => and(eq(schema.messages.id, messageId), eq(schema.messages.chatId, id)),
  })

  if (!message) {
    throw createError({ statusCode: 404, statusMessage: "Message not found" })
  }

  if (message.role !== "assistant") {
    throw createError({ statusCode: 400, statusMessage: "Can only vote on assistant messages" })
  }

  if (isUpvoted === undefined) {
    await db
      .delete(schema.votes)
      .where(and(eq(schema.votes.chatId, id), eq(schema.votes.messageId, messageId)))
  } else {
    await db
      .insert(schema.votes)
      .values({
        chatId: id,
        messageId,
        isUpvoted,
      })
      .onConflictDoUpdate({
        target: [schema.votes.chatId, schema.votes.messageId],
        set: { isUpvoted },
      })
  }

  return { chatId: id, messageId, isUpvoted }
})
