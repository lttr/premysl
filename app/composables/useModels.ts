import { DEFAULT_MODEL, MODEL_OPTIONS } from "#shared/utils/models"

export function useModels() {
  const model = useCookie<string>("model", { default: () => DEFAULT_MODEL })

  return {
    models: MODEL_OPTIONS,
    model,
  }
}
