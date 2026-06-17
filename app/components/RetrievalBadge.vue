<script setup lang="ts">
import type { RetrievalMode } from "#shared/utils/retrieval-mode"
import { RETRIEVAL_MODE_META } from "#shared/utils/retrieval-mode"

// Read-only display of a chat's fixed retrieval mode (GLOSSARY). The mode can't
// change mid-chat, so the chat surface shows it rather than offering a picker.
defineProps<{ mode: RetrievalMode }>()
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-elevated text-xs font-medium text-muted"
    aria-label="Retrieval mode"
  >
    <RetrievalDot :mode="mode" />
    {{ RETRIEVAL_MODE_META[mode].label }}
  </span>
</template>
