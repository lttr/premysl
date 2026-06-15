import type { UIMessage } from "ai"
import { db, schema } from "hub:db"
import { z } from "zod"

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
