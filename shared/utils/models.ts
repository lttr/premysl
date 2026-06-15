// Single source of truth for models.
//
// Models are keyed by a short name ("haiku", "sonnet"). That key is the
// identifier used in the chat UI, the API request, and the config constants
// below. server/utils/ai-models.ts maps `provider` to a direct AI SDK provider.

export const MODELS = {
  haiku: {
    label: "Claude Haiku 4.5",
    provider: "anthropic",
    modelId: "claude-haiku-4-5",
    icon: "i-simple-icons-anthropic",
  },
  sonnet: {
    label: "Claude Sonnet 4.6",
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",
    icon: "i-simple-icons-anthropic",
  },
  // Re-enable once the corresponding provider API key is configured:
  //   google -> GOOGLE_GENERATIVE_AI_API_KEY, openai -> OPENAI_API_KEY
  // gemini: { label: "Gemini 3 Flash", provider: "google", modelId: "gemini-3-flash", icon: "i-simple-icons-google" },
  // gpt: { label: "GPT-5 Nano", provider: "openai", modelId: "gpt-5-nano", icon: "i-simple-icons-openai" },
} as const

export type ModelKey = keyof typeof MODELS

export function isModelKey(key: string): key is ModelKey {
  return key in MODELS
}

// Which model the chat UI selects by default.
export const DEFAULT_MODEL: ModelKey = "haiku"

// Which model generates chat titles (cheap and fast).
export const TITLE_MODEL: ModelKey = "haiku"

// Options for the model <select> in the UI (value is the model key).
export const MODEL_OPTIONS = Object.entries(MODELS).map(([key, model]) => ({
  value: key,
  label: key,
  icon: model.icon,
}))
