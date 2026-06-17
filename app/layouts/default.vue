<script setup lang="ts">
import type { DropdownMenuItem } from "@nuxt/ui"
import { formatDistanceToNow } from "date-fns"
import { LazyRepoPicker } from "#components"

const { loggedIn, openInPopup } = useUserSession()
const {
  public: { requireAuth },
} = useRuntimeConfig()
const { renameChat, deleteChat } = useChatActions()

const sidebarOpen = ref(false)
const searchOpen = ref(false)

const { data: chats, refresh: refreshChats } = await useFetch("/api/chats", {
  key: "chats",
  transform: (data) =>
    data.map((chat) => ({
      id: chat.id,
      label: chat.title || "Untitled",
      to: `/chat/${chat.id}`,
      icon: "i-lucide-message-circle",
      createdAt: chat.createdAt,
      retrievalMode: chat.retrievalMode,
    })),
})

onNuxtReady(async () => {
  const first10 = (chats.value || []).slice(0, 10)
  for (const chat of first10) {
    // prefetch the chat and let the browser cache it; kept sequential on purpose
    // so prefetching does not fire ten parallel requests on app ready
    // (no-await-in-loop is disabled for this file in vite.config.ts)
    await $fetch(`/api/chats/${chat.id}`)
  }
})

watch(loggedIn, () => {
  refreshChats()

  sidebarOpen.value = false
})

const { groups } = useChats(chats)

const overlay = useOverlay()
const repoPicker = overlay.create(LazyRepoPicker)
const { repos: linkedRepos, refreshing, unlinkRepo, refreshRepo } = useLinkedRepos()

function repoFreshness(date: string): string {
  return formatDistanceToNow(new Date(date), { addSuffix: true })
}

const items = computed(() => {
  const groupsValue = groups.value
  if (!groupsValue) return undefined

  const result = []
  for (const group of groupsValue) {
    result.push({
      label: group.label,
      type: "label" as const,
    })
    for (const item of group.items) {
      result.push({
        ...item,
        slot: "chat" as const,
        icon: undefined,
        class: item.label === "Untitled" ? "text-muted" : "",
      })
    }
  }
  return result
})

function getChatActions(item: { id: string; label: string }): DropdownMenuItem[][] {
  return [
    [
      {
        label: "Rename",
        icon: "i-lucide-pencil",
        onSelect: () => renameChat(item.id, item.label === "Untitled" ? "" : item.label),
      },
    ],
    [
      {
        label: "Delete",
        icon: "i-lucide-trash",
        color: "error" as const,
        onSelect: () => deleteChat(item.id),
      },
    ],
  ]
}

defineShortcuts({
  meta_o: () => {
    navigateTo("/")
  },
})
</script>

<template>
  <UDashboardGroup unit="rem">
    <UDashboardSidebar
      id="default"
      v-model:open="sidebarOpen"
      :min-size="12"
      collapsible
      resizable
      :menu="{ inset: true }"
      class="border-r-0 py-4 dark:[--ui-bg-elevated:var(--ui-color-neutral-900)]"
    >
      <template #header="{ collapsed }">
        <NuxtLink v-if="!collapsed" to="/" class="flex items-end gap-0.5">
          <Logo class="h-8 w-auto shrink-0" />
          <span class="text-xl font-bold text-highlighted">Premysl</span>
        </NuxtLink>

        <UDashboardSidebarCollapse class="ms-auto" />
      </template>

      <template #default="{ collapsed }">
        <UNavigationMenu
          :items="[
            {
              label: 'New chat',
              to: '/',
              kbds: ['meta', 'o'],
              icon: 'i-lucide-circle-plus',
            },
            {
              label: 'Search',
              icon: 'i-lucide-search',
              kbds: ['meta', 'k'],
              onSelect: () => {
                searchOpen = true
              },
            },
          ]"
          :collapsed="collapsed"
          orientation="vertical"
        >
          <template #item-trailing="{ item }">
            <div
              v-if="item.kbds?.length"
              class="flex items-center gap-px opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <UKbd
                v-for="kbd in item.kbds"
                :key="kbd"
                :value="kbd"
                size="sm"
                variant="soft"
                class="bg-accented/50"
              />
            </div>
          </template>
        </UNavigationMenu>

        <UNavigationMenu
          v-if="!collapsed"
          :items="items"
          :collapsed="collapsed"
          orientation="vertical"
          :ui="{
            link: 'overflow-hidden pr-7.5',
            linkTrailing:
              'translate-x-full group-hover:translate-x-0 group-has-data-[state=open]:translate-x-0 transition-transform ms-0 absolute inset-e-px',
          }"
        >
          <template #chat-leading="{ item }">
            <RetrievalDot :mode="(item as { retrievalMode: RetrievalMode }).retrievalMode" />
          </template>
          <template #chat-trailing="{ item }">
            <UDropdownMenu
              :items="getChatActions(item as { id: string; label: string })"
              :content="{ align: 'end' }"
            >
              <UButton
                as="div"
                icon="i-lucide-ellipsis"
                color="neutral"
                variant="link"
                size="sm"
                class="rounded-[5px] hover:bg-accented/50 focus-visible:bg-accented/50 data-[state=open]:bg-accented/50"
                aria-label="Chat actions"
                tabindex="-1"
                @click.stop.prevent
              />
            </UDropdownMenu>
          </template>
        </UNavigationMenu>

        <div v-if="!collapsed" class="mt-4">
          <div class="flex items-center justify-between ps-2.5 pe-1 mb-1">
            <span class="text-xs font-semibold uppercase tracking-wide text-dimmed">
              Linked repositories
            </span>
            <UButton
              icon="i-lucide-plus"
              color="neutral"
              variant="ghost"
              size="xs"
              aria-label="Link a repository"
              @click="repoPicker.open()"
            />
          </div>

          <div
            v-for="repo in linkedRepos"
            :key="repo.id"
            class="group flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-accented/50"
          >
            <UIcon name="i-simple-icons-github" class="size-4 text-dimmed shrink-0" />
            <div class="min-w-0 flex-1">
              <div class="text-sm truncate leading-tight">{{ repo.fullName }}</div>
              <div class="text-xs text-dimmed truncate">
                refreshed {{ repoFreshness(repo.lastRefreshedAt) }}
              </div>
            </div>
            <div
              class="flex items-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            >
              <UButton
                :icon="refreshing.has(repo.id) ? 'i-lucide-loader-circle' : 'i-lucide-refresh-cw'"
                :class="refreshing.has(repo.id) && 'animate-spin'"
                :disabled="refreshing.has(repo.id)"
                color="neutral"
                variant="ghost"
                size="xs"
                aria-label="Refresh snapshot"
                @click="refreshRepo(repo.id)"
              />
              <UButton
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                size="xs"
                aria-label="Unlink"
                @click="unlinkRepo(repo.id)"
              />
            </div>
          </div>
        </div>
      </template>

      <template #footer="{ collapsed }">
        <UserMenu v-if="loggedIn" :collapsed="collapsed" />
        <UButton
          v-else-if="requireAuth"
          :label="collapsed ? '' : 'Login with GitHub'"
          icon="i-simple-icons-github"
          color="neutral"
          variant="ghost"
          class="w-full"
          @click="openInPopup('/auth/github')"
        />
      </template>
    </UDashboardSidebar>

    <UDashboardSearch
      v-model:open="searchOpen"
      placeholder="Search chats..."
      :groups="[
        {
          id: 'links',
          items: [
            {
              label: 'New chat',
              to: '/',
              icon: 'i-lucide-circle-plus',
              kbds: ['meta', 'o'],
            },
          ],
        },
        ...groups,
      ]"
    />

    <div
      class="flex-1 flex m-4 lg:ml-0 rounded-lg ring ring-default bg-default/75 shadow min-w-0 overflow-hidden"
    >
      <slot />
    </div>
  </UDashboardGroup>
</template>
