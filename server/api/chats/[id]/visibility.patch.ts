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

  const { visibility } = await readValidatedBody(event, (data) =>
    z.object({ visibility: z.enum(["public", "private"]) }).parse(data),
  )

  const chat = await db.query.chats.findFirst({
    where: () => and(eq(schema.chats.id, id), eq(schema.chats.userId, userId)),
  })

  if (!chat) {
    throw createError({ statusCode: 404, statusMessage: "Chat not found" })
  }

  const [updated] = await db
    .update(schema.chats)
    .set({ visibility })
    .where(and(eq(schema.chats.id, id), eq(schema.chats.userId, userId)))
    .returning()

  if (!updated) {
    throw createError({ statusCode: 404, statusMessage: "Chat not found" })
  }

  return updated
})
