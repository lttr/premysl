import { blob } from "hub:blob"
import { z } from "zod"

const sessionUserSchema = z.object({
  username: z.string(),
})

export default defineEventHandler(async (event) => {
  const session: unknown = await requireUserSession(event)
  const {
    user: { username },
  } = z.object({ user: sessionUserSchema }).parse(session)

  const paramsSchema = z.object({
    pathname: z.string().min(1),
  })
  const { pathname } = await getValidatedRouterParams(event, (data) => paramsSchema.parse(data))

  if (!pathname.startsWith(`${username}/`)) {
    throw createError({
      statusCode: 403,
      statusMessage: "You do not have permission to delete this file",
    })
  }

  await blob.del(pathname)

  sendNoContent(event)
})
