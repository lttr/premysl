# Premysl Glossary

The canonical terms for Premysl's access model. Premysl is a single-tenant,
self-hosted assistant: in normal use exactly one person — the **owner** — uses it.

## Access modes

**Open mode**:
The access mode where the app is ungated: anyone reaching it is served, no login
required. Selected when `NUXT_PUBLIC_REQUIRE_AUTH` is off. Typically how the app
runs locally during development.
_Avoid_: local mode, anonymous mode, dev mode

**Locked mode**:
The access mode where only the **owner** may obtain a session or access any data.
Selected when `NUXT_PUBLIC_REQUIRE_AUTH` is on. Typically how the app runs in
production. Fails closed: with no owner handle configured, no one is authorized.
_Avoid_: auth mode, production mode, private mode

## Identity

**Owner**:
The single GitHub account permitted to use the app in **locked mode**, identified
by the `NUXT_OWNER_GITHUB_HANDLE` configuration. The match is case-insensitive.
In locked mode, having a session implies being the owner — no other account is
ever issued one.
_Avoid_: admin, user, account

**Local user**:
The fixed anonymous identity (`id: "local"`) that owns every chat created in
**open mode**. Constant by design — not per-session — so locally-created chats
all belong to one identity and survive cookie or browser changes.
_Avoid_: guest, anonymous user, default user

## Transitions

**Adoption**:
The one-time reassignment of every **local user** chat to a real account on first
GitHub login, so work done in **open mode** is not orphaned when the app is later
opened by a logged-in **owner**.
_Avoid_: migration, claiming, import

## Example dialogue

> **Dev:** I ran it locally and never logged in, but my chats still saved. Whose
> are they?
>
> **Maintainer:** You were in open mode, so every request resolved to the local
> user — one fixed anonymous identity. That's why they persisted across restarts.
>
> **Dev:** Then I deployed and turned on locked mode. Now the login screen rejects
> my colleague.
>
> **Maintainer:** Right — in locked mode only the owner gets a session. Your
> colleague's GitHub handle isn't the configured owner handle, so it fails closed.
>
> **Dev:** And the chats I made locally?
>
> **Maintainer:** The first time you log in as the owner, adoption reassigns all
> local-user chats to your account. Nothing gets orphaned.
