// Retrieval mode (GLOSSARY): the per-chat choice of retrieval method, fixed for
// the chat's life and orthogonal to the model key. Single source of truth for
// the two modes, their UI presentation, and the API-boundary validator.

export const RETRIEVAL_MODES = ["grep", "rag"] as const

export type RetrievalMode = (typeof RETRIEVAL_MODES)[number]

// New chats default to the established grep method; rag is opt-in (PRD).
export const DEFAULT_RETRIEVAL_MODE: RetrievalMode = "grep"

export function isRetrievalMode(value: string): value is RetrievalMode {
  return (RETRIEVAL_MODES as readonly string[]).includes(value)
}

// Presentation for the mode picker / badges. `color` is a Tailwind color token
// (blue = grep, violet = rag) matching the visual spec's legend.
export const RETRIEVAL_MODE_META: Record<
  RetrievalMode,
  { label: string; icon: string; color: string }
> = {
  grep: { label: "grep", icon: "i-lucide-regex", color: "blue" },
  rag: { label: "rag", icon: "i-lucide-sparkles", color: "violet" },
}

export const RETRIEVAL_MODE_OPTIONS = RETRIEVAL_MODES.map((value) => {
  const meta = RETRIEVAL_MODE_META[value]
  return { value, label: meta.label, icon: meta.icon, color: meta.color }
})
