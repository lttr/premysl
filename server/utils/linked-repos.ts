import type { linkedRepositories } from "hub:db:schema"

// Shape a linked-repository row for the client, dropping the server-only
// snapshot path and userId.
export function toLinkedRepo(row: typeof linkedRepositories.$inferSelect): LinkedRepo {
  return {
    id: row.id,
    fullName: row.fullName,
    defaultBranch: row.defaultBranch,
    commitSha: row.commitSha,
    lastRefreshedAt: row.lastRefreshedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }
}
