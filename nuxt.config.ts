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

  devServer: {
    port: 5040,
  },

  css: ["~/assets/css/main.css"],

  experimental: {
    viewTransition: true,
  },

  runtimeConfig: {
    // NUXT_OWNER_GITHUB_HANDLE — e.g. "lttr". Private, server-only; never
    // serialized to the client. Required when requireAuth is on (fail closed).
    ownerGithubHandle: "",
    public: {
      // NUXT_PUBLIC_REQUIRE_AUTH — on in prod, off in dev by default. Only this
      // boolean reaches the client (so middleware knows whether to redirect).
      requireAuth: process.env.NODE_ENV === "production",
    },
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
