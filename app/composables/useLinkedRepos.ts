import { LazyModalConfirm } from "#components"

interface Deps {
  data: Ref<LinkedRepo[]>
  toast: ReturnType<typeof useToast>
  linking: Ref<Set<string>>
  refreshing: Ref<Set<string>>
  linkedFullNames: ComputedRef<Set<string>>
  unlinkModal: ReturnType<ReturnType<typeof useOverlay>["create"]>
}

function csrfHeader(): Record<string, string> {
  const result: { csrf: unknown; headerName: unknown } = useCsrf()
  const name = typeof result.headerName === "string" ? result.headerName : ""
  const value = typeof result.csrf === "string" ? result.csrf : ""
  return name === "" ? {} : { [name]: value }
}

// Toggle a key in a reactive Set, copy-on-write so reactivity fires.
function setBusy(state: Ref<Set<string>>, key: string, busy: boolean): void {
  const next = new Set(state.value)
  if (busy) next.add(key)
  else next.delete(key)
  state.value = next
}

// Modal `instance.result` resolves to an unresolved (`error`) type under the
// lint tsconfig; funnel it through `unknown` before narrowing.
async function awaitModalResult(instance: { result: unknown }): Promise<unknown> {
  return instance.result
}

function notifyError(toast: Deps["toast"], description: string): void {
  toast.add({ description, icon: "i-lucide-alert-circle", color: "error" })
}

async function linkRepo(deps: Deps, fullName: string): Promise<void> {
  if (deps.linking.value.has(fullName) || deps.linkedFullNames.value.has(fullName)) return
  setBusy(deps.linking, fullName, true)
  try {
    const row = await $fetch<LinkedRepo>("/api/repos/linked", {
      method: "POST",
      headers: csrfHeader(),
      body: { fullName },
    })
    deps.data.value = [row, ...deps.data.value]
    deps.toast.add({ title: "Repository linked", icon: "i-lucide-link" })
  } catch {
    notifyError(deps.toast, "Failed to link repository")
  } finally {
    setBusy(deps.linking, fullName, false)
  }
}

async function unlinkRepo(deps: Deps, id: string): Promise<void> {
  const confirmed = (await awaitModalResult(deps.unlinkModal.open())) === true
  if (!confirmed) return
  try {
    await $fetch(`/api/repos/linked/${id}`, { method: "DELETE", headers: csrfHeader() })
    deps.data.value = deps.data.value.filter((r) => r.id !== id)
    deps.toast.add({ title: "Repository unlinked", icon: "i-lucide-unlink" })
  } catch {
    notifyError(deps.toast, "Failed to unlink repository")
  }
}

async function refreshRepo(deps: Deps, id: string): Promise<void> {
  if (deps.refreshing.value.has(id)) return
  setBusy(deps.refreshing, id, true)
  try {
    const row = await $fetch<LinkedRepo>(`/api/repos/linked/${id}/refresh`, {
      method: "POST",
      headers: csrfHeader(),
    })
    deps.data.value = deps.data.value.map((r) => (r.id === id ? row : r))
    deps.toast.add({ title: "Snapshot refreshed", icon: "i-lucide-refresh-cw" })
  } catch {
    notifyError(deps.toast, "Failed to refresh snapshot")
  } finally {
    setBusy(deps.refreshing, id, false)
  }
}

export function useLinkedRepos(): {
  repos: Ref<LinkedRepo[]>
  refresh: () => Promise<void>
  linkedFullNames: ComputedRef<Set<string>>
  linking: Ref<Set<string>>
  refreshing: Ref<Set<string>>
  linkRepo: (fullName: string) => Promise<void>
  unlinkRepo: (id: string) => Promise<void>
  refreshRepo: (id: string) => Promise<void>
} {
  const toast = useToast()
  const overlay = useOverlay()
  const unlinkModal = overlay.create(LazyModalConfirm, {
    props: {
      title: "Unlink repository",
      description:
        "Unlink this repository? Its snapshot is deleted and the assistant can no longer search it.",
      color: "error",
    },
  })

  const { data, refresh } = useFetch<LinkedRepo[]>("/api/repos/linked", {
    key: "linked-repos",
    default: () => [],
  })

  const linkedFullNames = computed(() => new Set(data.value.map((r) => r.fullName)))
  const linking = useState<Set<string>>("linked-repos-linking", () => new Set())
  const refreshing = useState<Set<string>>("linked-repos-refreshing", () => new Set())

  const deps: Deps = { data, toast, linking, refreshing, linkedFullNames, unlinkModal }

  return {
    repos: data,
    refresh,
    linkedFullNames,
    linking,
    refreshing,
    linkRepo: async (fullName) => linkRepo(deps, fullName),
    unlinkRepo: async (id) => unlinkRepo(deps, id),
    refreshRepo: async (id) => refreshRepo(deps, id),
  }
}
