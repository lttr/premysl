<script setup lang="ts">
import type { CommandPaletteItem } from "@nuxt/ui"

defineEmits<{ close: [boolean] }>()

const { linkedFullNames, linking, linkRepo } = useLinkedRepos()

const { data: available, status } = useFetch<AvailableRepo[]>("/api/repos/available", {
  key: "available-repos",
  lazy: true,
  default: () => [],
})

interface PickerItem extends CommandPaletteItem {
  fullName: string
  private: boolean
}

const groups = computed(() => [
  {
    id: "repos",
    items: (available.value ?? []).map(
      (repo): PickerItem => ({
        label: repo.fullName,
        description: repo.description ?? "",
        icon: "i-simple-icons-github",
        fullName: repo.fullName,
        private: repo.private,
        // Keep the palette open on select; linking is idempotent and guarded.
        onSelect: (event: Event) => {
          event.preventDefault()
          void linkRepo(repo.fullName)
        },
      }),
    ),
  },
])

function pickerOf(item: unknown): PickerItem {
  return item as PickerItem
}
</script>

<template>
  <UModal
    title="Link a repository"
    description="Your repositories — public and private"
    :ui="{ content: 'max-w-lg' }"
  >
    <template #body>
      <UCommandPalette
        :groups="groups"
        :loading="status === 'pending'"
        :close="false"
        placeholder="Search your repositories..."
        class="h-[28rem]"
      >
        <template #item-trailing="{ item }">
          <div class="flex items-center gap-2">
            <UBadge
              :color="pickerOf(item).private ? 'neutral' : 'info'"
              variant="subtle"
              size="sm"
              :label="pickerOf(item).private ? 'Private' : 'Public'"
            />
            <UBadge
              v-if="linkedFullNames.has(pickerOf(item).fullName)"
              color="success"
              variant="subtle"
              size="sm"
              icon="i-lucide-check"
              label="Linked"
            />
            <UButton
              v-else-if="linking.has(pickerOf(item).fullName)"
              size="xs"
              color="neutral"
              variant="subtle"
              loading
              label="Linking…"
            />
            <UButton
              v-else
              size="xs"
              color="neutral"
              label="Link"
              @click.stop="linkRepo(pickerOf(item).fullName)"
            />
          </div>
        </template>
      </UCommandPalette>
    </template>
  </UModal>
</template>
