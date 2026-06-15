import { DEFAULT_MODEL, MODEL_OPTIONS, isModelKey } from "#shared/utils/models"

export function useModels() {
  const model = useCookie<string>("model", { default: () => DEFAULT_MODEL })

  // Reset stale cookie values (e.g. old gateway-format keys) to a valid model
  // so the chat endpoint doesn't reject the request with "Invalid model".
  if (!isModelKey(model.value)) {
    model.value = DEFAULT_MODEL
  }

  return {
    models: MODEL_OPTIONS,
    model,
  }
}
