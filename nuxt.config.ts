// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    "@nuxt/eslint",
    "@nuxt/ui",
    "@comark/nuxt",
    "@nuxthub/core",
    "nuxt-auth-utils",
    "nuxt-charts",
    "nuxt-csurf",
  ],

  devtools: {
    enabled: true,
  },

  css: ["~/assets/css/main.css"],

  experimental: {
    viewTransition: true,
  },

  compatibilityDate: "2024-07-11",

  typescript: {
    // Emit a `declare module "*.vue"` shim so tools that use plain tsc (e.g.
    // oxlint's type-aware tsgolint pass) can resolve .vue imports. vue-tsc still
    // resolves SFCs through its own language plugin for full template checking.
    shim: true,
  },

  nitro: {
    experimental: {
      openAPI: true,
    },
  },

  hub: {
    db: "sqlite",
    blob: true,
  },

  vite: {
    optimizeDeps: {
      include: ["striptags"],
    },
  },
})
