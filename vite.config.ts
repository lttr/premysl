import { defineConfig } from "vite-plus"

const ignorePatterns = [
  "**/.nuxt/**",
  "**/.output/**",
  "**/.nitro/**",
  "**/.data/**",
  "**/cache/**",
  "**/dist/**",
  "**/node_modules/**",
  "**/*.min.css",
  "pnpm-lock.yaml",
]

// Generated artifacts excluded from cache-input tracking.
const srcInput = [
  { auto: true },
  "!**/.nuxt/**",
  "!**/.output/**",
  "!**/node_modules/.cache/**",
  "!**/node_modules/.vite/**",
  "!**/*.tsbuildinfo",
]

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  run: {
    cache: {
      // Disabled in CI because vite-plus script-cache tracing makes the
      // Coolify build step hang until it times out.
      scripts: process.env.CI !== "true",
    },
    tasks: {
      // Tools run directly (not via nested `vp run -r`) so the cached unit is
      // the leaf command and `srcInput` applies to it.
      "verify:check": { command: "vp check", input: srcInput },
      "verify:lint": { command: "eslint .", input: srcInput },
      "verify:typecheck": { command: "nuxt typecheck", input: srcInput },
      "verify:fallow": { command: "fallow dead-code", input: srcInput },
      // verify:smoke is intentionally omitted — booting the app needs runtime
      // secrets; nuxt build validates the production bundle instead.
      "verify:build": { command: "nuxt build", input: srcInput },
      "verify:all": {
        command: "echo verify done",
        dependsOn: [
          "verify:check",
          "verify:lint",
          "verify:typecheck",
          "verify:fallow",
          "verify:build",
        ],
      },
    },
  },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    plugins: [
      "eslint",
      "typescript",
      "unicorn",
      "oxc",
      "import",
      "node",
      "promise",
      "vitest",
      "vue",
    ],
    categories: {
      correctness: "error",
      suspicious: "error",
      perf: "error",
    },
    rules: {
      // vite-plus
      "vite-plus/prefer-vite-plus-imports": "error",
      // Pedantic
      eqeqeq: "error",
      "no-throw-literal": "error",
      "no-promise-executor-return": "error",
      "no-self-compare": "error",
      "no-useless-return": "error",
      "no-else-return": "error",
      "no-lonely-if": "error",
      "no-loop-func": "error",
      "array-callback-return": "error",
      radix: "error",
      "symbol-description": "error",
      "unicorn/explicit-length-check": "error",
      "unicorn/new-for-builtins": "error",
      "typescript/ban-ts-comment": "error",
      "typescript/only-throw-error": "error",
      "typescript/prefer-includes": "error",
      "typescript/prefer-promise-reject-errors": "error",
      "typescript/no-misused-promises": "error",
      "typescript/switch-exhaustiveness-check": "error",
      "typescript/prefer-nullish-coalescing": "error",
      "typescript/restrict-plus-operands": "error",
      "typescript/return-await": "error",
      "typescript/no-deprecated": "error",
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": [
        "error",
        { max: 80, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      "max-depth": ["error", 4],
      "max-nested-callbacks": ["error", 3],
      "max-classes-per-file": ["error", 1],
      "import/max-dependencies": ["error", { max: 20, ignoreTypeImports: true }],
      "no-fallthrough": "error",
      "typescript/no-confusing-void-expression": "error",
      "typescript/strict-boolean-expressions": "error",
      "typescript/no-unsafe-argument": "error",
      "typescript/no-unsafe-assignment": "error",
      "typescript/no-unsafe-call": "error",
      "typescript/no-unsafe-member-access": "error",
      "typescript/no-unsafe-return": "error",
      "typescript/no-mixed-enums": "error",
      "typescript/prefer-ts-expect-error": "error",
      "unicorn/consistent-empty-array-spread": "error",
      "unicorn/no-array-callback-reference": "error",
      "unicorn/escape-case": "error",
      // Restriction
      "no-var": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
      "import/no-cycle": "error",
      "unicorn/prefer-node-protocol": "error",
      "unicorn/prefer-module": "error",
      "typescript/no-explicit-any": "error",
      "typescript/no-non-null-assertion": "error",
      "typescript/no-import-type-side-effects": "error",
      "typescript/no-empty-object-type": "error",
      "vue/no-import-compiler-macros": "error",
      "vue/no-multiple-slot-args": "error",
      complexity: ["error", 15],
      "typescript/no-namespace": "error",
      "typescript/no-require-imports": "error",
      "typescript/no-var-requires": "error",
      "typescript/use-unknown-in-catch-callback-variable": "error",
      "typescript/promise-function-async": "error",
      "typescript/explicit-module-boundary-types": "error",
      "node/no-process-env": "error",
      "unicorn/no-process-exit": "error",
      "unicorn/no-array-for-each": "error",
      "unicorn/no-array-reduce": "error",
      // Style
      "prefer-const": "error",
      "object-shorthand": "error",
      "prefer-template": "error",
      "prefer-object-spread": "error",
      "no-useless-computed-key": "error",
      "no-implicit-coercion": "error",
      "import/no-duplicates": "error",
      "import/first": "error",
      "import/consistent-type-specifier-style": ["error", "prefer-top-level"],
      "max-params": ["error", 4],
      "max-statements": ["error", 25],
      // Nursery
      "typescript/no-unnecessary-condition": "error",
      "typescript/prefer-optional-chain": "error",
      "oxc/branches-sharing-code": "error",
      "promise/no-return-in-finally": "error",
    },
    env: {
      browser: true,
      node: true,
      es2024: true,
    },
    ignorePatterns,
    options: {
      typeAware: true,
      typeCheck: true,
    },
    overrides: [
      {
        // Build config files legitimately read process.env at build time.
        files: ["**/*.config.{ts,js,mjs,cjs}"],
        rules: {
          "node/no-process-env": "off",
        },
      },
      {
        // Ambient .d.ts declarations frequently use side-effect imports
        // (e.g. @total-typescript/ts-reset) and a trailing `export {}` to mark
        // the file as a module so `declare module` performs augmentation.
        files: ["**/*.d.ts"],
        rules: {
          "import/no-unassigned-import": "off",
          "unicorn/require-module-specifiers": "off",
        },
      },
      {
        // JS-only configs whose default export lands here as `any`.
        files: ["**/eslint.config.{js,mjs,cjs}"],
        rules: {
          "typescript/no-unsafe-argument": "off",
        },
      },
      {
        // Sequential prefetch on app-ready is intentional — it avoids firing ten
        // parallel requests at once.
        files: ["app/layouts/default.vue"],
        rules: {
          "no-await-in-loop": "off",
        },
      },
      {
        // Paginating the repo list and streaming tar entries are inherently
        // sequential — each iteration depends on the previous one finishing.
        files: ["server/utils/github.ts"],
        rules: {
          "no-await-in-loop": "off",
        },
      },
    ],
  },
  fmt: {
    semi: false,
    ignorePatterns,
  },
})
