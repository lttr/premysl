import { anthropic } from "@ai-sdk/anthropic"
import { google } from "@ai-sdk/google"
import { openai } from "@ai-sdk/openai"
import type { LanguageModel } from "ai"

// Direct AI SDK providers, keyed to MODELS[*].provider.
//
// Replaces Vercel AI Gateway routing: passing a bare "provider/model" string to
// streamText/generateText sends the request through the gateway (needs
// AI_GATEWAY_API_KEY). Calling the provider directly talks to each provider
// using its own API key (ANTHROPIC_API_KEY / OPENAI_API_KEY /
// GOOGLE_GENERATIVE_AI_API_KEY).
const PROVIDERS = { anthropic, openai, google }

// Resolve a model key (e.g. "haiku") to a direct AI SDK provider model. When
// NUXT_FAKE_EXTERNALS is on (dev/test only), every model resolves to an offline
// fake instead, so the chat path runs without hitting any provider.
export function resolveModel(key: string): LanguageModel {
  if (!isModelKey(key)) {
    throw createError({ statusCode: 400, statusMessage: `Unknown model: ${key}` })
  }
  const { provider, modelId } = MODELS[key]
  if (fakeExternalsEnabled()) return fakeLanguageModel(modelId)
  return PROVIDERS[provider](modelId)
}
