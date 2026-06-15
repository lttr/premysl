import { blob } from "hub:blob"
import { db, schema } from "hub:db"
import { eq } from "drizzle-orm"
import { z } from "zod"

const sessionUserSchema = z.object({
  id: z.string(),
  username: z.string(),
})

export default defineEventHandler(async (event) => {
  const session: unknown = await requireUserSession(event)
  const { user } = z.object({ user: sessionUserSchema }).parse(session)

  const paramsSchema = z.object({
    chatId: z.string(),
  })
  const { chatId } = await getValidatedRouterParams(event, (data) => paramsSchema.parse(data))

  const userId = user.id

  const chat = await db.query.chats.findFirst({
    where: () => eq(schema.chats.id, chatId),
  })

  if (chat && chat.userId !== userId) {
    throw createError({
      statusCode: 403,
      statusMessage: "You do not have permission to upload files to this chat",
    })
  }

  const username = user.username

  return blob.handleUpload(event, {
    formKey: "files",
    multiple: false,
    ensure: {
      maxSize: FILE_UPLOAD_CONFIG.maxSize,
      types: [...FILE_UPLOAD_CONFIG.types],
    },
    put: {
      addRandomSuffix: true,
      prefix: `${username}/${chatId}`,
    },
  })
})
