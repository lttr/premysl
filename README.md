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
- 💾 **Chat history** in SQLite (local file on the VPS, persisted to a volume) via [Drizzle ORM](https://orm.drizzle.team)
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
> In production the database is a local SQLite file at `.data/db/sqlite.db`
> (NuxtHub's libsql driver). Mount `.data` on a persistent volume so it survives
> redeploys; migrations are applied automatically on container start (see the
> `[start]` command in `nixpacks.toml`).

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

### Blob storage

Uses [NuxtHub Blob](https://hub.nuxt.com/docs/blob) for file uploads, backed by
the local filesystem driver (stored in `.data/blob`). Both in development and in
production on the VPS, uploads are written to disk by the Node process — no
external blob service or token is required.

> [!NOTE]
> On the VPS, mount `.data/blob` on a persistent volume so uploads survive
> redeploys. File uploads require authentication.

## Development

Start the dev server on `http://localhost:5040`:

```bash
vp dev
```

### Offline dev mode

For rapid local work and e2e / agent-browser runs, set a single flag to replace
every behind-auth external system (the LLM provider, GitHub, and Voyage) with
deterministic offline fakes — no API keys, no PAT, no network:

```bash
# in .env
NUXT_FAKE_EXTERNALS=1
```

With it on (dev only; it fails closed in a production build via `import.meta.dev`):

- **LLM** streams a canned reply, so chat works without a provider key.
- **GitHub** serves a fixture repo list and writes a fixture markdown snapshot, so
  the real link / refresh flow runs end to end offline.
- **Voyage** returns deterministic hash-based embeddings, so RAG indexing and
  retrieval are offline and stable.

It also enables `GET /auth/test-login` (mint a session without GitHub OAuth,
defaulting the handle to `tester`) and `GET /test/seed-repo` (seed the fixture
repo directly). Typical flow: open `/auth/test-login`, then link
`premysl-test/fixture-notes` from the repo picker, then chat.

> Note: `vp dev` / `nuxt dev` read these flags from `.env`. Passing `NUXT_*`
> inline on the command line does **not** reach the server — to run with flags
> without editing `.env`, use `./node_modules/.bin/nuxt dev --dotenv <file>`.

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
GitHub OAuth credentials, and AI provider keys. The database is a local SQLite
file on the mounted `.data` volume — no database URL or token required.

See the [Nuxt deployment docs](https://nuxt.com/docs/getting-started/deployment)
for other targets.
