import { isToday, isYesterday, subMonths } from "date-fns"
import type { RetrievalMode } from "#shared/utils/retrieval-mode"

export interface UIChat {
  id: string
  label: string
  icon: string
  createdAt: string
  retrievalMode: RetrievalMode
}

export interface ChatGroup {
  id: string
  label: string
  items: UIChat[]
}

interface ChatBuckets {
  today: UIChat[]
  yesterday: UIChat[]
  lastWeek: UIChat[]
  lastMonth: UIChat[]
  older: Record<string, UIChat[]>
}

// Sort chats into today/yesterday/last-week/last-month and per-month older groups.
function bucketChats(chats: UIChat[]): ChatBuckets {
  const buckets: ChatBuckets = {
    today: [],
    yesterday: [],
    lastWeek: [],
    lastMonth: [],
    older: {},
  }

  const oneWeekAgo = subMonths(new Date(), 0.25) // ~7 days ago
  const oneMonthAgo = subMonths(new Date(), 1)

  for (const chat of chats) {
    const chatDate = new Date(chat.createdAt)

    if (isToday(chatDate)) {
      buckets.today.push(chat)
    } else if (isYesterday(chatDate)) {
      buckets.yesterday.push(chat)
    } else if (chatDate >= oneWeekAgo) {
      buckets.lastWeek.push(chat)
    } else if (chatDate >= oneMonthAgo) {
      buckets.lastMonth.push(chat)
    } else {
      // Format: "January 2023", "February 2023", etc.
      const monthYear = chatDate.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      })

      buckets.older[monthYear] ??= []
      buckets.older[monthYear].push(chat)
    }
  }

  return buckets
}

function buildChatGroups(chats: UIChat[]): ChatGroup[] {
  const { today, yesterday, lastWeek, lastMonth, older } = bucketChats(chats)

  // Sort older chats by month-year in descending order (newest first)
  const sortedMonthYears = Object.keys(older).toSorted((a, b) => {
    const dateA = new Date(a)
    const dateB = new Date(b)
    return dateB.getTime() - dateA.getTime()
  })

  // Add groups that have chats
  const formattedGroups: ChatGroup[] = []

  if (today.length > 0) {
    formattedGroups.push({ id: "today", label: "Today", items: today })
  }
  if (yesterday.length > 0) {
    formattedGroups.push({ id: "yesterday", label: "Yesterday", items: yesterday })
  }
  if (lastWeek.length > 0) {
    formattedGroups.push({ id: "last-week", label: "Last week", items: lastWeek })
  }
  if (lastMonth.length > 0) {
    formattedGroups.push({ id: "last-month", label: "Last month", items: lastMonth })
  }

  // Add each month-year group
  for (const monthYear of sortedMonthYears) {
    const items = older[monthYear]
    if (items !== undefined && items.length > 0) {
      formattedGroups.push({ id: monthYear, label: monthYear, items })
    }
  }

  return formattedGroups
}

export function useChats(chats: Ref<UIChat[] | undefined>): {
  groups: ComputedRef<ChatGroup[]>
} {
  const groups = computed(() => buildChatGroups(chats.value ?? []))

  return {
    groups,
  }
}
