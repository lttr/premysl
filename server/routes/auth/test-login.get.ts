import { db, schema } from "hub:db"
import { eq } from "drizzle-orm"

// Test-only login: mints a session WITHOUT the GitHub OAuth round-trip so e2e /
// agent-browser runs can exercise behind-auth functionality without a real
// account. Fails closed: only available when NUXT_ALLOW_TEST_LOGIN is "1" and
// never in production. Never wire this into the UI.
//
// In locked mode requireRequestUser only authorizes the owner, so the minted
// session impersonates NUXT_OWNER_GITHUB_HANDLE by default (override with ?as=).
// A real users row is upserted because linkedRepositories/repoChunks FK to it.
// Repo snapshot features additionally need a real token: set
// NUXT_TEST_GITHUB_TOKEN (a PAT with `repo` scope) to populate secure.githubToken.
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  // Fail closed: dev build only (import.meta.dev is false in production). Enabled
  // by NUXT_ALLOW_TEST_LOGIN, or implicitly whenever the offline fakes are on (so
  // NUXT_FAKE_EXTERNALS alone is enough for rapid offline dev).
  if (!import.meta.dev || !(flagEnabled(config.allowTestLogin) || fakeExternalsEnabled())) {
    throw createError({ statusCode: 404, statusMessage: "Not Found" })
  }

  const asParam = getQuery(event).as
  const requested = typeof asParam === "string" && asParam !== "" ? asParam : undefined
  // Default the impersonated handle to the owner; when only fakes are on (no owner
  // configured), fall back to "tester" so NUXT_FAKE_EXTERNALS=1 alone is enough.
  const username =
    requested ?? (config.ownerGithubHandle || (fakeExternalsEnabled() ? "tester" : ""))
  if (!username) {
    throw createError({
      statusCode: 400,
      statusMessage: "No username: pass ?as=<handle> or set NUXT_OWNER_GITHUB_HANDLE",
    })
  }

  // Deterministic identity so repeat logins reuse the same user/chats.
  const providerId = `test:${username.toLowerCase()}`

  let user = await db.query.users.findFirst({
    where: () => eq(schema.users.providerId, providerId),
  })
  if (!user) {
    ;[user] = await db
      .insert(schema.users)
      .values({
        name: username,
        email: `${username}@test.local`,
        avatar: "",
        username,
        provider: "github",
        providerId,
      })
      .returning()
  }
  if (!user) {
    throw createError({ statusCode: 500, statusMessage: "Failed to create test user" })
  }

  const githubToken = config.testGithubToken
  await setUserSession(event, {
    user,
    ...(githubToken === "" ? {} : { secure: { githubToken } }),
  })

  return sendRedirect(event, "/")
})
