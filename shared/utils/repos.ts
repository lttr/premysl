// The linked-repository shape returned to the client (no server-only snapshot
// path). Timestamps arrive as ISO strings over the wire.
export interface LinkedRepo {
  id: string
  fullName: string
  defaultBranch: string
  commitSha: string
  lastRefreshedAt: string
  createdAt: string
}
