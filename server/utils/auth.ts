import type { H3Event } from "h3"

// Anonymous identity used in open mode. A fixed id (not random) so locally
// created chats survive cookie/browser changes and all belong to one local user.
export const LOCAL_USER_ID = "local"

export interface RequestUser {
  id: string
  username: string
}

// Case-insensitive owner match. Fails closed when no owner handle is configured.
export function isOwner(handle: string, owner: string): boolean {
  return owner.length > 0 && handle.toLowerCase() === owner.toLowerCase()
}

// Effective user for a request, enforcing the access policy server-side.
//
// Locked mode (requireAuth on): the request is authorized only when it is both
// authenticated and the GitHub username equals the configured owner handle.
// Open mode (requireAuth off): the logged-in user if present, else the fixed
// anonymous local user — so the app works with zero login.
export async function requireRequestUser(event: H3Event): Promise<RequestUser> {
  const config = useRuntimeConfig(event)
  const session = await getUserSession(event)
  const user = session.user

  if (config.public.requireAuth) {
    if (user !== undefined && isOwner(user.username, config.ownerGithubHandle)) {
      return { id: user.id, username: user.username }
    }
    throw createError({ statusCode: 401, statusMessage: "Unauthorized" })
  }

  if (user !== undefined) {
    return { id: user.id, username: user.username }
  }
  return { id: LOCAL_USER_ID, username: LOCAL_USER_ID }
}
