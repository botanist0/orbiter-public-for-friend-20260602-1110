# Security And Data Boundaries

Orbiter is local-first, but it now has remote access, email import, Google OAuth, family users, and Codex handoff. Security rules must stay explicit.

## Core Principles

- Local files are private by default.
- The browser app is not a remote shell.
- Codex work must go through a reviewed command queue.
- Email and OAuth data are sensitive.
- Guest data must be scoped and removable.
- Git must never publish private runtime state or imported personal data.

## Private Paths

These paths must stay ignored by Git:

- `.orbiter/`
- `inbox/email/*`
- `inbox/attachments/email/*`
- `outbox/email/drafts/*`
- `journal/email-sync/*`
- `journal/email-sent/*`
- `commands/inbox/*`
- `usernotes/*`
- `issues-journal/*`
- private/generated project data under `knowledge/`

See [GITHUB_PRE_PUSH_CHECKLIST.md](GITHUB_PRE_PUSH_CHECKLIST.md) before pushing.

## Runtime Secrets

Private runtime secrets live under `.orbiter/`.

Examples:

- access token hashes
- browser sessions
- mobile capture token
- email app-password encrypted secrets
- Google OAuth client config
- Google OAuth refresh tokens
- generated user-scoped itinerary JSON

Do not move these into tracked source files.

## Roles

Orbiter uses explicit roles:

- `admin` - full owner/operator permissions.
- `wife` - trusted shared-family role with shared travel mailbox access.
- `member` - restricted non-admin household role.
- `guest` - scoped, usually ephemeral, designed for Google SSO travel planning.

Admin-only surfaces:

- Codex command create/approve/claim/done/reject.
- Destructive shared workspace actions.
- Outbound email draft creation, approval, and send.
- Full command history and sensitive email surfaces.

## Guest Data Scope

Guest users must only read and write explicit user-scoped roots:

- `.orbiter/users/<user-id>/`
- `inbox/email/user-<user-id>/`
- `inbox/attachments/email/user-<user-id>/`
- `outbox/email/drafts/user-<user-id>/`
- `journal/email-sync/user-<user-id>/`
- `journal/email-sent/user-<user-id>/`
- `knowledge/projects/travel/users/<user-id>/`

Ephemeral guest logout purges only those roots. Orbiter must not scan shared folders and guess ownership.

## Remote Access

Default local mode binds to `127.0.0.1`.

Remote-capable modes:

- `npm run start:remote` - Tailscale-guarded capture/app access.
- `npm run start:prod` - production auth with Tailscale network guard.
- `npm run start:cloudflare` - production auth behind Cloudflare Tunnel and public origin checks.

Remote access rules:

- Do not expose port `4173` with router port forwarding.
- Use production auth for public or phone-reachable access.
- Keep host and origin checks enabled for Cloudflare mode.
- Treat Cloudflare as a public front door even though the server stays local.

## Command Execution Boundary

Commands are markdown records, not executable requests.

Allowed path:

1. User or capture creates a command.
2. Admin reviews it.
3. Codex claims it with `npm run codex:next`.
4. Codex implements and verifies.
5. Codex marks done or rejected.

The HTTP backend must not execute arbitrary command text from browser, phone, email, or Google users.

## Email Boundary

Email receive and send are separate.

Receive:

- IMAP imports configured household Gmail accounts.
- Google OAuth imports guest travel Gmail into user-scoped folders.
- Travel marketing is filtered before writing when possible.

Send:

- Draft first.
- Explicit approval.
- Explicit send.
- Write sent journal.

Guest users must not send owner email or read owner email.

## Google OAuth Boundary

Google OAuth is for sign-in and Gmail travel import.

Rules:

- Request only `openid`, `email`, `profile`, and `gmail.readonly`.
- Store tokens under `.orbiter/users/<user-id>/`.
- Do not request Gmail modify/send scopes for guest travel.
- Do not import more than 100 messages for the MVP guest flow.
- Delete guest OAuth tokens through ephemeral logout cleanup.

## Browser And Frontend Boundary

The browser app can call local APIs, but sensitive actions remain role-guarded.

Browser preview of a Codex handoff must not mark a command `running`. Only the Codex handoff script should claim work.

## Self-Heal Boundary

Self-heal may diagnose and repair low-risk local drift.

It must not:

- send email
- install dependencies
- mutate secrets
- pull Git
- execute arbitrary prompts
- mark Codex work complete
- approve commands

Self-upgrade requests go through the command queue.
