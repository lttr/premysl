import { blob } from "hub:blob"
import { db, schema } from "hub:db"
import { and, eq } from "drizzle-orm"
import { z } from "zod"

export default defineEventHandler(async (event) => {
  const { id: userId, username } = await requireRequestUser(event)
  const { id } = await getValidatedRouterParams(event, (data) =>
    z.object({ id: z.string() }).parse(data),
  )

  const chat = await db.query.chats.findFirst({
    where: () => and(eq(schema.chats.id, id), eq(schema.chats.userId, userId)),
  })

  if (!chat) {
    throw createError({
      statusCode: 404,
      statusMessage: "Chat not found",
    })
  }

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
