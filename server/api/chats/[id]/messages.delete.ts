import { db, schema } from "hub:db"
import { and, asc, eq, inArray } from "drizzle-orm"
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

  const { messageId, type } = await readValidatedBody(event, (data) =>
    z.object({ messageId: z.string(), type: z.enum(["edit", "regenerate"]) }).parse(data),
  )

  const chat = await db.query.chats.findFirst({
    where: () => and(eq(schema.chats.id, id), eq(schema.chats.userId, userId)),
  })

  if (!chat) {
    throw createError({ statusCode: 404, statusMessage: "Chat not found" })
  }

  const allMessages = await db
    .select({ id: schema.messages.id, role: schema.messages.role })
    .from(schema.messages)
    .where(eq(schema.messages.chatId, id))
    .orderBy(asc(schema.messages.createdAt), asc(schema.messages.id))

  const targetIndex = allMessages.findIndex((m) => m.id === messageId)
  const targetMessage = allMessages[targetIndex]
  if (targetIndex === -1 || !targetMessage) {
    throw createError({ statusCode: 404, statusMessage: "Message not found" })
  }

  const targetRole = targetMessage.role
  if (type === "edit" && targetRole !== "user") {
    throw createError({ statusCode: 400, statusMessage: "Can only edit user messages" })
  }
  if (type === "regenerate" && targetRole !== "assistant") {
    throw createError({ statusCode: 400, statusMessage: "Can only regenerate assistant messages" })
  }

  const startIndex = type === "edit" ? targetIndex + 1 : targetIndex
  const idsToDelete = allMessages.slice(startIndex).map((m) => m.id)

  if (idsToDelete.length > 0) {
    await db.delete(schema.messages).where(inArray(schema.messages.id, idsToDelete))
  }

  return { success: true }
})
