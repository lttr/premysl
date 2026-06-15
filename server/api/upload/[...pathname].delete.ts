import { blob } from "hub:blob"
import { z } from "zod"

export default defineEventHandler(async (event) => {
  const { username } = await requireRequestUser(event)

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
