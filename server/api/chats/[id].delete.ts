import { blob } from "hub:blob"
import { db, schema } from "hub:db"
import { and, eq } from "drizzle-orm"
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

  const userId = session.user?.id ?? session.id

  const chat = await db.query.chats.findFirst({
    where: () => and(eq(schema.chats.id, id), eq(schema.chats.userId, userId)),
  })

  if (!chat) {
    throw createError({
      statusCode: 404,
      statusMessage: "Chat not found",
    })
  }

  // Fall back to session.id when username is missing or empty, to avoid an empty folder prefix.
  const username =
    session.user?.username !== undefined && session.user.username !== ""
      ? session.user.username
      : session.id
  const chatFolder = `${username}/${id}`

  try {
    const { blobs } = await blob.list({
      prefix: chatFolder,
    })

    if (blobs.length > 0) {
      await Promise.all(
        blobs.map(async (b) =>
          blob.del(b.pathname).catch((error: unknown) => {
            console.error("[delete-chat] Failed to delete file:", b.pathname, error)
          }),
        ),
      )
    }
  } catch (error) {
    console.error("Failed to list/delete chat files:", error)
  }

  return db
    .delete(schema.chats)
    .where(and(eq(schema.chats.id, id), eq(schema.chats.userId, userId)))
    .returning()
})
