# CLAUDE.md

Premysl: Lukas's single-tenant, self-hosted AI chat assistant. Nuxt 4, Nitro, Drizzle/SQLite (Turso in prod), NuxtHub (DB + Blob), Vercel AI SDK.

## Commands

Use `vp` (Vite+), not pnpm/npm.

- `vp dev` — dev server on :3000
- `vp run verify` — pre-push gate: `vp check` → `eslint .` → `nuxt typecheck` → `fallow dead-code` → `nuxt build`. Run before pushing. No unit tests.
- `vp run db:generate` / `vp run db:migrate` — Drizzle migrations. Never hand-edit applied migrations.

Formatting is owned by the vp formatter, not ESLint. oxc lint (in `vite.config.ts`) is strict and type-aware.

## Access model (terms defined in GLOSSARY.md — use them exactly)

- **Open mode** (`NUXT_PUBLIC_REQUIRE_AUTH` off, dev default): ungated; every request resolves to the fixed anonymous **local user** (`id: "local"`).
- **Locked mode** (on, prod default): only the **owner** (`NUXT_OWNER_GITHUB_HANDLE`, case-insensitive) gets a session. Fails closed.
- **Adoption**: first owner login reassigns all local-user chats to the account.

Server gate: `requireRequestUser(event)` (`server/utils/auth.ts`) — call it in every handler touching user data. OAuth + adoption in `server/routes/auth/github.get.ts`. `ownerGithubHandle` is server-only, never sent to the client.

## AI layer (direct providers, not the Gateway)

- `shared/utils/models.ts` — single source of truth for models, keyed by short name (`haiku`, `sonnet`). `isModelKey()` validates at the API boundary.
- `server/utils/ai-models.ts` — `resolveModel(key)` → direct AI SDK provider instance; each uses its own key (e.g. `ANTHROPIC_API_KEY`).
- `server/api/chats/[id].post.ts` — core chat endpoint (streaming, per-provider tools in `buildTools()`, reasoning in `PROVIDER_OPTIONS`, lazy titles). To add a model: extend `MODELS`, then `buildTools`/`PROVIDER_OPTIONS` if needed.

Custom tools in `shared/utils/tools/`, rendered by `app/components/chat/tool/`.

## Notes

- Server imports NuxtHub virtual modules (`hub:db`); fallow/tsc can't resolve them — `nuxt build`/`typecheck` are the real check.
- Deploys to Coolify via Nixpacks; push to `main` auto-deploys. See `coolify-deploy` memory.
