import type { UIMessage } from "ai"
import { db, schema } from "hub:db"
import { z } from "zod"

export default defineEventHandler(async (event) => {
  const { id: userId } = await requireRequestUser(event)
  const bodySchema = z.object({
    id: z.string(),
    message: z.custom<UIMessage>(),
    // Retrieval mode is chosen at creation and fixed for the chat's life
    // (GLOSSARY). Optional for backward compatibility; defaults to grep.
    retrievalMode: z.string().refine(isRetrievalMode).optional(),
  })
  const { id, message, retrievalMode } = await readValidatedBody(event, (body) =>
    bodySchema.parse(body),
  )

  const [chat] = await db
    .insert(schema.chats)
    .values({
      id,
      title: "",
      userId,
      ...(retrievalMode !== undefined && { retrievalMode }),
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
