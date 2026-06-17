// Repositories the owner owns (public and private), for the picker. Gated like
// every repo handler; needs the session GitHub connection.
export default defineEventHandler(async (event) => {
  await requireRequestUser(event)
  const token = await requireGithubToken(event)
  return listOwnerRepos(token)
})
