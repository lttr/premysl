import { db, schema } from "hub:db"
import { and, eq } from "drizzle-orm"
import { z } from "zod"

export default defineEventHandler(async (event) => {
  const { id: userId } = await requireRequestUser(event)

  const { id } = await getValidatedRouterParams(event, (data) =>
    z.object({ id: z.string() }).parse(data),
  )

  const { title } = await readValidatedBody(event, (data) =>
    z.object({ title: z.string().trim().min(1).max(100) }).parse(data),
  )

  const chat = await db.query.chats.findFirst({
    where: () => and(eq(schema.chats.id, id), eq(schema.chats.userId, userId)),
  })

  if (!chat) {
    throw createError({ statusCode: 404, statusMessage: "Chat not found" })
  }

  const [updated] = await db
    .update(schema.chats)
    .set({ title })
    .where(and(eq(schema.chats.id, id), eq(schema.chats.userId, userId)))
    .returning()

  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: "Chat not found" })
  }

  return updated
})
