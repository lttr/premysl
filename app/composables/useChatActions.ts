import { LazyModalConfirm, LazyModalRename } from "#components"

interface ChatListItem {
  id: string
  label: string
  to: string
  icon?: string
  createdAt: string | Date
}

// Modal `instance.result` resolves to an unresolved (`error`) type under the
// lint tsconfig; funnel it through `unknown` before narrowing.
async function awaitModalResult(instance: { result: unknown }): Promise<unknown> {
  return instance.result
}

async function renameChat(
  deps: { renameModal: ReturnType<ReturnType<typeof useOverlay>["create"]> },
  toast: ReturnType<typeof useToast>,
  id: string,
  currentTitle?: string | null,
): Promise<string | null> {
  const instance = deps.renameModal.open({ title: currentTitle ?? "" })
  const raw = await awaitModalResult(instance)
  // ModalRename emits `string | false` on close.
  if (typeof raw !== "string" || raw === "" || raw === currentTitle) return null
  const result = raw

  try {
    await $fetch(`/api/chats/${id}/title`, {
      method: "PATCH",
      body: { title: result },
    })

    const chatsCache = useNuxtData<ChatListItem[]>("chats")
    if (chatsCache.data.value) {
      // Copy-on-write: build new objects so the reactive cache updates; in-place
      // mutation would not trigger reactivity here.
      const updated: ChatListItem[] = []
      for (const c of chatsCache.data.value) {
        updated.push(c.id === id ? { ...c, label: result } : c)
      }
      chatsCache.data.value = updated
    }

    const chatCache = useNuxtData<{ title: string | null }>(`chat-${id}`)
    if (chatCache.data.value) {
      chatCache.data.value = { ...chatCache.data.value, title: result }
    }

    return result
  } catch {
    toast.add({
      description: "Failed to rename chat",
      icon: "i-lucide-alert-circle",
      color: "error",
    })

    return null
  }
}

async function deleteChat(
  deps: {
    deleteModal: ReturnType<ReturnType<typeof useOverlay>["create"]>
    route: ReturnType<typeof useRoute>
  },
  toast: ReturnType<typeof useToast>,
  id: string,
): Promise<boolean> {
  const instance = deps.deleteModal.open()
  // ModalConfirm emits `boolean` on close.
  const confirmed = (await awaitModalResult(instance)) === true
  if (!confirmed) return false

  try {
    await $fetch(`/api/chats/${id}`, {
      method: "DELETE",
    })

    toast.add({
      title: "Chat deleted",
      description: "Your chat has been deleted",
      icon: "i-lucide-trash",
    })

    const chatsCache = useNuxtData<ChatListItem[]>("chats")
    if (chatsCache.data.value) {
      chatsCache.data.value = chatsCache.data.value.filter((c) => c.id !== id)
    }

    if (deps.route.params.id === id) {
      await navigateTo("/")
    }

    return true
  } catch {
    toast.add({
      description: "Failed to delete chat",
      icon: "i-lucide-alert-circle",
      color: "error",
    })

    return false
  }
}

export function useChatActions(): {
  renameChat: (id: string, currentTitle?: string | null) => Promise<string | null>
  deleteChat: (id: string) => Promise<boolean>
} {
  const route = useRoute()
  const toast = useToast()
  const overlay = useOverlay()

  const renameModal = overlay.create(LazyModalRename)
  const deleteModal = overlay.create(LazyModalConfirm, {
    props: {
      title: "Delete chat",
      description: "Are you sure you want to delete this chat? This cannot be undone.",
      color: "error",
    },
  })

  return {
    renameChat: async (id, currentTitle) => renameChat({ renameModal }, toast, id, currentTitle),
    deleteChat: async (id) => deleteChat({ deleteModal, route }, toast, id),
  }
}
