// auth.d.ts
declare module "#auth-utils" {
  interface User {
    id: string
    name: string
    email: string
    avatar: string
    username: string
    provider: "github"
    providerId: string
  }

  // Server-only session data — never sent to the client. Holds the GitHub
  // connection (OAuth access token) used to list and snapshot linked repos.
  interface SecureSessionData {
    githubToken: string
  }
}

export {}
