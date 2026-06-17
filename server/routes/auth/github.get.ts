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
  // Extend the login to consent to `repo` scope (ADR 0001). There is no separate
  // "connect GitHub" flow — the access token captured here is the GitHub
  // connection used to list and snapshot linked repositories.
  config: {
    scope: ["repo"],
  },
  async onSuccess(
    event: H3Event,
    { user: ghUser, tokens }: { user: GitHubUser; tokens: { access_token: string } },
  ) {
    const config = useRuntimeConfig(event)

    // In locked mode, only the owner may obtain a session. Fail closed (no
    // session issued) for any non-owner or when no owner handle is configured.
    if (config.public.requireAuth && !isOwner(ghUser.login, config.ownerGithubHandle)) {
      return sendRedirect(event, "/login?error=forbidden")
    }

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
    }

    if (!user) {
      throw createError({ statusCode: 500, statusMessage: "Failed to create user" })
    }

    // Adopt any anonymous local chats created in open mode into this account.
    await db
      .update(schema.chats)
      .set({ userId: user.id })
      .where(eq(schema.chats.userId, LOCAL_USER_ID))

    // Store the access token in the session's server-only `secure` field: it is
    // never serialized to the client and never written to the database (ADR 0001).
    await setUserSession(event, { user, secure: { githubToken: tokens.access_token } })

    return sendRedirect(event, "/")
  },
  // Optional, will return a json error and 401 status code by default
  async onError(event: H3Event, error: H3Error) {
    console.error("GitHub OAuth error:", error)
    return sendRedirect(event, "/")
  },
})
