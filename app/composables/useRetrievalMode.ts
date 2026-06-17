import {
  DEFAULT_RETRIEVAL_MODE,
  RETRIEVAL_MODE_OPTIONS,
  isRetrievalMode,
} from "#shared/utils/retrieval-mode"

// The retrieval mode selected for the NEXT new chat, persisted in a cookie so it
// sticks across reloads (mirrors useModels). A chat's own mode is fixed at
// creation and read from the chat record, not from this cookie.
export function useRetrievalMode(): {
  retrievalMode: Ref<string>
  retrievalModes: typeof RETRIEVAL_MODE_OPTIONS
} {
  const retrievalMode = useCookie<string>("retrievalMode", {
    default: () => DEFAULT_RETRIEVAL_MODE,
  })

  if (!isRetrievalMode(retrievalMode.value)) {
    retrievalMode.value = DEFAULT_RETRIEVAL_MODE
  }

  return {
    retrievalModes: RETRIEVAL_MODE_OPTIONS,
    retrievalMode,
  }
}
