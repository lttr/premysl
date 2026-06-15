import type { H3Error, H3Event } from "h3"
import { db, schema } from "hub:db"
import { and, eq } from "drizzle-orm"
import { z } from "zod"

interface GitHubUser {
  id: number
  login: string
  name: string | null
  email: string | null
  avatar_url: string
}

const sessionSchema = z.object({
  id: z.string(),
})

export default defineOAuthGitHubEventHandler({
  async onSuccess(event: H3Event, { user: ghUser }: { user: GitHubUser }) {
    const session = sessionSchema.parse(await getUserSession(event))

    let user = await db.query.users.findFirst({
      where: () =>
        and(eq(schema.users.provider, "github"), eq(schema.users.providerId, ghUser.id.toString())),
    })
    if (!user) {
      ;[user] = await db
        .insert(schema.users)
        .values({
          id: session.id,
          name: ghUser.name ?? "",
          email: ghUser.email ?? "",
          avatar: ghUser.avatar_url,
          username: ghUser.login,
          provider: "github",
          providerId: ghUser.id.toString(),
        })
        .returning()
    } else {
      // Assign anonymous chats with session id to user
      await db
        .update(schema.chats)
        .set({
          userId: user.id,
        })
        .where(eq(schema.chats.userId, session.id))
    }

    await setUserSession(event, { user })

    return sendRedirect(event, "/")
  },
  // Optional, will return a json error and 401 status code by default
  async onError(event: H3Event, error: H3Error) {
    console.error("GitHub OAuth error:", error)
    return sendRedirect(event, "/")
  },
})
