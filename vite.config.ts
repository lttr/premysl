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
})
