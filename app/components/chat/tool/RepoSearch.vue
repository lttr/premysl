<script setup lang="ts">
import { isToolStreaming } from "@nuxt/ui/utils/ai"

const props = defineProps<{
  invocation: RepoSearchUIToolInvocation
}>()

const matches = computed(() =>
  props.invocation.state === "output-available" ? props.invocation.output.matches : [],
)
</script>

<template>
  <div class="my-4">
    <div
      v-if="invocation.state === 'output-available'"
      class="border border-default rounded-xl overflow-hidden max-w-xl"
    >
      <div class="flex items-center gap-2 px-3.5 py-2.5 bg-elevated/50 border-b border-default">
        <span class="size-6 rounded-lg bg-primary text-inverted grid place-items-center shrink-0">
          <UIcon name="i-lucide-search" class="size-3.5" />
        </span>
        <div class="min-w-0">
          <div class="text-sm font-medium leading-tight">Searched linked repositories</div>
          <div class="text-xs text-muted truncate">"{{ invocation.output.query }}"</div>
        </div>
        <UBadge
          class="ms-auto shrink-0"
          color="primary"
          variant="subtle"
          size="sm"
          :label="`${matches.length} ${matches.length === 1 ? 'match' : 'matches'}`"
        />
      </div>

      <template v-if="matches.length">
        <div
          v-for="(match, index) in matches"
          :key="index"
          class="px-3.5 py-3 border-b border-default last:border-b-0"
        >
          <div class="flex items-center gap-1.5 text-xs mb-2 flex-wrap">
            <span class="font-mono px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
              {{ match.repo }}
            </span>
            <span class="font-mono text-toned">{{ match.path }}</span>
            <span class="font-mono text-dimmed">L{{ match.startLine }}–{{ match.endLine }}</span>
            <a
              :href="match.url"
              target="_blank"
              rel="noopener noreferrer"
              class="ms-auto flex items-center gap-0.5 text-primary font-medium"
            >
              open
              <UIcon name="i-lucide-arrow-up-right" class="size-3" />
            </a>
          </div>
          <pre
            class="text-xs font-mono leading-relaxed bg-inverted/90 text-inverted rounded-lg p-3 overflow-auto max-h-64 whitespace-pre-wrap"
            >{{ match.content }}</pre
          >
        </div>
      </template>

      <div v-else class="flex items-center gap-2.5 px-3.5 py-4 text-sm text-muted">
        <UIcon name="i-lucide-search" class="size-4 shrink-0" />
        <span>
          No matches in your linked repositories for
          <b class="text-default">"{{ invocation.output.query }}"</b>. Try rephrasing, or link
          another repository.
        </span>
      </div>
    </div>

    <div
      v-else-if="invocation.state === 'output-error'"
      class="flex items-center gap-2 text-sm text-error"
    >
      <UIcon name="i-lucide-triangle-alert" class="size-4" />
      Couldn't search your linked repositories.
    </div>

    <div v-else class="flex items-center gap-2 text-sm text-muted">
      <UIcon
        name="i-lucide-loader-circle"
        class="size-4 animate-spin"
        :class="!isToolStreaming(invocation) && 'opacity-70'"
      />
      Searching your linked repositories…
    </div>
  </div>
</template>
