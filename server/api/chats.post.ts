import type { UIMessage } from "ai"
import { db, schema } from "hub:db"
import { z } from "zod"

export default defineEventHandler(async (event) => {
  const { id: userId } = await requireRequestUser(event)
  const bodySchema = z.object({
    id: z.string(),
    message: z.custom<UIMessage>(),
  })
  const { id, message } = await readValidatedBody(event, (body) => bodySchema.parse(body))

  const [chat] = await db
    .insert(schema.chats)
    .values({
      id,
      title: "",
      userId,
    })
    .returning()

  if (!chat) {
    throw createError({ statusCode: 500, statusMessage: "Failed to create chat" })
  }

  await db.insert(schema.messages).values({
    id: message.id,
    chatId: chat.id,
    role: "user",
    parts: message.parts,
  })

  return chat
})
