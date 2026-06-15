import { db, schema } from "hub:db"
import { asc, eq } from "drizzle-orm"
import { z } from "zod"

export default defineEventHandler(async (event) => {
  const { id: userId } = await requireRequestUser(event)

  const { id } = await getValidatedRouterParams(event, (data) =>
    z.object({ id: z.string() }).parse(data),
  )

  const chat = await db.query.chats.findFirst({
    where: () => eq(schema.chats.id, id),
    with: {
      messages: {
        orderBy: () => asc(schema.messages.createdAt),
      },
    },
  })

  if (!chat) {
    throw createError({ statusCode: 404, statusMessage: "Chat not found" })
  }

  const isChatOwner = chat.userId === userId

  if (chat.visibility === "private" && !isChatOwner) {
    throw createError({ statusCode: 404, statusMessage: "Chat not found" })
  }

  const { userId: _, ...rest } = chat
  return { ...rest, isOwner: isChatOwner }
})
