<script setup lang="ts">
// Retrieval-mode picker for a NEW chat (index page). Sits next to the model
// picker but is a separate choice, so retrieval method and model vary
// independently. Defaults to grep; the choice is fixed once the chat starts.
const { retrievalMode, retrievalModes } = useRetrievalMode()
</script>

<template>
  <UButtonGroup size="sm">
    <UButton
      v-for="opt in retrievalModes"
      :key="opt.value"
      :variant="retrievalMode === opt.value ? 'subtle' : 'ghost'"
      :color="retrievalMode === opt.value ? 'primary' : 'neutral'"
      :aria-pressed="retrievalMode === opt.value"
      @click="retrievalMode = opt.value"
    >
      <RetrievalDot :mode="opt.value" />
      {{ opt.label }}
    </UButton>
  </UButtonGroup>
</template>
