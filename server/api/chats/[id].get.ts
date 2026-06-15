import { db, schema } from "hub:db"
import { asc, eq } from "drizzle-orm"
import { z } from "zod"

const sessionSchema = z.object({
  id: z.string(),
  user: z.object({ id: z.string().optional(), username: z.string().optional() }).optional(),
})

export default defineEventHandler(async (event) => {
  const session = sessionSchema.parse(await getUserSession(event))

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

  const userId = session.user?.id ?? session.id
  const isOwner = chat.userId === userId

  if (chat.visibility === "private" && !isOwner) {
    throw createError({ statusCode: 404, statusMessage: "Chat not found" })
  }

  const { userId: _, ...rest } = chat
  return { ...rest, isOwner }
})
