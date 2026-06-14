# Premysl

Premysl is my personal AI assistant — a self-hosted chat app with streaming
responses, chat history, file uploads, web search and tool calling.

Built with [Nuxt](https://nuxt.com), [Nuxt UI](https://ui.nuxt.com) and the
[AI SDK](https://ai-sdk.dev). Started from the [Nuxt UI chat template](https://github.com/nuxt-ui-templates/chat).

## Features

- ⚡️ **Streaming responses** via the [AI SDK](https://ai-sdk.dev) with thinking/reasoning support
- 🤖 **Multiple models** — Claude, Gemini and GPT through [Vercel AI Gateway](https://vercel.com/docs/ai-gateway)
- 🔍 **Web search** with built-in provider tools (Anthropic, OpenAI)
- 📊 **Charts and weather** tool calling with rich UI rendering
- 🔐 **GitHub OAuth** auth via [nuxt-auth-utils](https://github.com/atinux/nuxt-auth-utils)
- 💾 **Chat history** in SQLite ([Turso](https://turso.tech) in production) via [Drizzle ORM](https://orm.drizzle.team)
- 📎 **File uploads** with drag & drop using [NuxtHub Blob](https://hub.nuxt.com/docs/blob)
- ✨ **Markdown rendering** with streaming code highlighting via [Comark](https://comark.dev)

## Setup

Install dependencies:

```bash
pnpm install
```

Run database migrations:

```bash
pnpm db:migrate
```

> [!NOTE]
> In production, configure your database connection. On Vercel, add the [Turso integration](https://vercel.com/integrations/turso) to automatically provision `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`.

### AI integration

Uses the [Vercel AI SDK](https://ai-sdk.dev/) with multiple providers through [Vercel AI Gateway](https://vercel.com/docs/ai-gateway). When deployed on Vercel, the gateway is configured automatically.

For local development, set your API key in `.env`:

```bash
AI_GATEWAY_API_KEY=<your-vercel-ai-gateway-api-key>
```

> [!TIP]
> With [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) you don't need individual provider API keys — it gives a unified endpoint with load balancing, fallbacks and spend monitoring.

### Authentication

Uses [nuxt-auth-utils](https://github.com/atinux/nuxt-auth-utils) with GitHub OAuth.

[Create a GitHub OAuth application](https://github.com/settings/applications/new) and set:

```bash
NUXT_OAUTH_GITHUB_CLIENT_ID=<your-github-oauth-app-client-id>
NUXT_OAUTH_GITHUB_CLIENT_SECRET=<your-github-oauth-app-client-secret>
NUXT_SESSION_PASSWORD=<your-password-minimum-32-characters>
```

### Blob storage (optional)

Uses [NuxtHub Blob](https://hub.nuxt.com/docs/blob) for file uploads, supporting multiple drivers:

- **Local filesystem** (default for development, stored in `.data/blob`)
- **[Vercel Blob](https://vercel.com/docs/vercel-blob)** (auto-configured on Vercel)
- **[Cloudflare R2](https://hub.nuxt.com/docs/blob#set-a-driver)** (on Cloudflare)
- **[Amazon S3](https://hub.nuxt.com/docs/blob#set-a-driver)** (manual configuration)

For **Vercel Blob**, assign a Blob Store to your project (Project → Storage), then set the token for local development:

```bash
BLOB_READ_WRITE_TOKEN=<your-vercel-blob-token>
```

> [!NOTE]
> File uploads require authentication.

## Development

Start the dev server on `http://localhost:3000`:

```bash
pnpm dev
```

## Verify

The repo uses [Vite+](https://viteplus.dev) (`vp`) as the unified
lint/format/task-runner. Run the full gate before pushing:

```bash
pnpm verify
```

It chains, each step independently: `vp check` (format + oxc lint) →
`eslint .` (Vue/Nuxt-aware rules) → `nuxt typecheck` →
`fallow dead-code` → `nuxt build`. A `vp staged` pre-commit hook
auto-formats and `--fix`es staged files.

## Production

Build, then run the Node server output:

```bash
pnpm build
pnpm start   # node .output/server/index.mjs
```

Preview the production build locally:

```bash
pnpm preview
```

### Deployment

Deploys to [Coolify](https://coolify.io) via Nixpacks (`nixpacks.toml`,
Node 24, port 3000). Pushes to `main` auto-deploy through the configured
GitHub App. The app needs runtime secrets to boot: `NUXT_SESSION_PASSWORD`,
the libsql database URL/token, GitHub OAuth credentials, and AI provider keys.

See the [Nuxt deployment docs](https://nuxt.com/docs/getting-started/deployment)
for other targets.
