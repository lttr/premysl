import { createRequire } from "node:module"

// @vscode/ripgrep ships its `rg` binary in a platform-specific optional
// dependency (`@vscode/ripgrep-<platform>-<arch>`) resolved at runtime via a
// computed `require.resolve`. Nitro's static dependency tracer cannot see that
// dynamic resolve, so the binary is omitted from `.output/server/node_modules`
// and the server crash-loops on boot ("Could not find @vscode/ripgrep-linux-x64").
// Resolve the binary for the build platform and force it into the trace. Null on
// platforms whose optional dep isn't installed (e.g. a macOS dev build), which
// just leaves the trace untouched there.
const ripgrepBinary = (() => {
  const require = createRequire(import.meta.url)
  try {
    return require.resolve(`@vscode/ripgrep-${process.platform}-${process.arch}/bin/rg`)
  } catch {
    return null
  }
})()

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    "@nuxt/eslint",
    "@nuxt/ui",
    "@comark/nuxt",
    "@nuxthub/core",
    "nuxt-auth-utils",
    "nuxt-charts",
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
    // Voyage API key for RAG embeddings (ADR 0003). Server-only, never sent to
    // the client. Bound to the unprefixed VOYAGE_API_KEY (as in .env.example),
    // matching the ANTHROPIC_API_KEY convention; NUXT_VOYAGE_API_KEY also wins.
    voyageApiKey: process.env.VOYAGE_API_KEY ?? "",
    // Test-only seams (dev only — paired with import.meta.dev, so they fail
    // closed in a production build). Server-only; never sent to the client.
    // NUXT_ALLOW_TEST_LOGIN — enable GET /auth/test-login.
    allowTestLogin: "",
    // NUXT_TEST_GITHUB_TOKEN — optional PAT put on the test-login session.
    testGithubToken: "",
    // NUXT_FAKE_EXTERNALS — replace external systems with offline fakes and
    // enable GET /test/seed-repo.
    fakeExternals: "",
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
    // Force the ripgrep binary into the server trace (see `ripgrepBinary` above).
    ...(ripgrepBinary !== null ? { externals: { traceInclude: [ripgrepBinary] } } : {}),
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
