import { defineConfig } from "vite-plus"

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    semi: false,
    ignorePatterns: [
      ".nuxt",
      ".output",
      ".nitro",
      ".data",
      "dist",
      "cache",
      "node_modules",
      "pnpm-lock.yaml",
    ],
  },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    // Type-aware lint + Vue SFC resolution are owned by nuxi typecheck (vue-tsc)
    // and @nuxt/eslint; oxlint's tsgolint false-fails on .vue imports here.
    options: { typeAware: false, typeCheck: false },
  },
  run: {
    // Script-input caching can stall the Nuxt build under CI; disable there.
    cache: { scripts: process.env.CI !== "true" },
    tasks: {
      // Each verify step runs uncached for deterministic gate results.
      // (verify:smoke is intentionally omitted — booting the app needs runtime
      // secrets; nuxi build validates the production bundle instead.)
      "verify:check": { command: "vp check", cache: false },
      "verify:lint": { command: "eslint .", cache: false },
      "verify:typecheck": { command: "nuxt typecheck", cache: false },
      "verify:fallow": { command: "fallow dead-code", cache: false },
      "verify:build": { command: "nuxt build", cache: false },
      "verify:all": {
        command: 'node -e ""',
        dependsOn: [
          "verify:check",
          "verify:lint",
          "verify:typecheck",
          "verify:fallow",
          "verify:build",
        ],
        cache: false,
      },
    },
  },
})
