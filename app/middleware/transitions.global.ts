export default defineNuxtRouteMiddleware((to, from) => {
  if (import.meta.server) return

  const toId = to.params.id
  const fromId = from.params.id
  if (toId !== undefined && toId.length > 0 && fromId !== undefined && fromId.length > 0) {
    to.meta.viewTransition = false
  }
})
