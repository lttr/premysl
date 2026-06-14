// @ts-check
import withNuxt from "./.nuxt/eslint.config.mjs"

export default withNuxt({
  rules: {
    "vue/multi-word-component-names": "off",
    // Formatting is owned by the vp formatter; disable stylistic Vue rules that
    // conflict with it. ESLint keeps only Vue/Nuxt-aware correctness rules.
    "vue/max-attributes-per-line": "off",
    "vue/html-self-closing": "off",
    "vue/require-default-prop": "off",
  },
})
