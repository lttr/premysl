<script setup lang="ts">
import type { RetrievalMode } from "#shared/utils/retrieval-mode"
import { RETRIEVAL_MODE_META } from "#shared/utils/retrieval-mode"

defineProps<{ mode: RetrievalMode }>()

// Literal classes (not interpolated) so Tailwind's scanner keeps them. Blue =
// grep, violet = rag, matching the visual spec's legend.
const DOT_CLASS: Record<RetrievalMode, string> = {
  grep: "bg-blue-500",
  rag: "bg-violet-500",
}
</script>

<template>
  <span
    class="size-2 rounded-full shrink-0"
    :class="DOT_CLASS[mode]"
    :title="`${RETRIEVAL_MODE_META[mode].label} retrieval`"
  />
</template>
