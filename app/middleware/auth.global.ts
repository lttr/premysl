export default defineNuxtRouteMiddleware(async (to) => {
  const {
    public: { requireAuth },
  } = useRuntimeConfig()

  // Open mode: no gating.
  if (!requireAuth) return
  // Avoid redirecting the login page to itself.
  if (to.path === "/login") return

  // In locked mode the server only ever issues a session to the owner, so
  // loggedIn implies owner — no extra owner check is needed client-side.
  const { loggedIn } = useUserSession()
  if (!loggedIn.value) {
    return navigateTo("/login")
  }
})
