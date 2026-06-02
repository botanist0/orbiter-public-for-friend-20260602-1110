# Architecture

Orbiter is a local-first life and travel operating system. It runs on the home Windows PC, keeps markdown and local runtime files as the source of truth, exposes a small browser app, and lets Codex help through explicit review queues instead of unrestricted automation.

This document is the high-level map. Detailed setup, policies, and subsystem behavior live in the linked docs under `docs/`.

## System Shape

Orbiter is intentionally not a large cloud platform yet.

```text
iPhone / browser / Google OAuth
        |
        v
Local Node backend on the home PC
        |
        +-- Browser app in app/
        +-- Markdown workspace folders
        +-- Private runtime state in .orbiter/
        +-- CLI scripts in scripts/
        +-- Codex handoff queue in commands/
```

Current runtime:

- Backend: `scripts/server.mjs`, Node, file-backed, binds to `127.0.0.1` by default.
- Frontend: static browser app under `app/`, served by the backend.
- Data: markdown notes and generated JSON, not a database.
- Private state: `.orbiter/`, ignored by Git.
- Remote access: local production mode, Tailscale, and Cloudflare Tunnel.
- Agent execution: Codex reads reviewed command records; Orbiter does not execute arbitrary remote text by itself.

## Source Of Truth

Orbiter uses folders as durable product boundaries:

- `usernotes/` - user-authored ad hoc notes.
- `inbox/` - captured notes, imported emails, and guest-scoped email imports.
- `commands/` - reviewable prompts for Codex.
- `knowledge/` - durable organized notes, decisions, projects, and generated travel artifacts.
- `journal/` - operational logs such as email sync and sent-email records.
- `issues-journal/` - engineering-style issue records.
- `.orbiter/` - private runtime state, sessions, tokens, generated JSON, OAuth tokens, and local config.

Markdown records use frontmatter:

```markdown
---
title: Example
type: note
tags: inbox, idea
created: 2026-05-30T00:00:00.000Z
---

Body text.
```

Generated JSON is a read model. If a feature writes JSON under `.orbiter/`, the owning markdown/source inputs should remain inspectable.

## Backend

The backend owns all file reads and writes for the browser app. It serves static assets and exposes `/api/*` routes documented in [API.md](API.md).

Important backend rules:

- Return workspace-relative paths in API responses.
- Keep API response shapes stable once the browser, iPhone Shortcut, or automation depends on them.
- Use short in-memory caches for markdown-derived reads, then invalidate on writes.
- Prefer explicit routes and small payloads over a generic remote shell.
- Keep destructive shared-workspace operations admin-only in production mode.

Current API areas:

- session/auth
- Google OAuth and Gmail travel import
- notes/search/graph
- commands/Codex handoff/history
- hidden dev Command Center status aggregate
- email drafts/send
- mobile capture
- travel itinerary
- health/time/environment

## Frontend

The browser app is a dense operational UI, not a marketing page.

Current main tabs:

- Capture: create notes or admin-only commands.
- Mobile: review iPhone captures.
- Email: inspect imported email and review outbound drafts.
- Travel: itinerary, stays, transportation, planning gaps, Google travel import.
- Commands: review queue, Codex handoff preview, command history.
- Command Center: hidden feature-flagged dev dashboard for queue health, travel readiness, email draft readiness, runtime status, and recommendations.
- Access: session, user, network, and data-mode status.
- Graph: interactive knowledge/domain/tag graph.
- Search: markdown search.

Frontend code lives primarily in `app/app.js`, `app/index.html`, and `app/styles.css`.

Command Center is intentionally present but hidden unless the server enables `ORBITER_FEATURE_COMMAND_CENTER=1`. The production Cloudflare profile does not enable it; the dev Cloudflare profile does. See [COMMAND_CENTER.md](COMMAND_CENTER.md).

The topbar environment widget is a small local context surface. `/api/time` drives backend-local clock display and day/night icon state. `/api/environment` optionally reads `.orbiter/environment-config.json`, fetches current Open-Meteo weather for configured coordinates, and checks curated eclipse events from `data/eclipse-events.json`. See [ENVIRONMENT_WIDGET.md](ENVIRONMENT_WIDGET.md).

## Authentication And Users

Orbiter has two user entry paths:

- Local access tokens for owner/household users.
- Google OAuth for guest-style Gmail travel users.

Roles:

- `admin` - owner/operator. Can run command workflows, manage drafts, and access full workspace surfaces.
- `wife` - trusted family role. Can read the shared travel mailbox, but not Nitro's primary email or Codex command surfaces.
- `member` - non-admin household role with restricted sensitive surfaces.
- `guest` - scoped and usually ephemeral. Intended for cousin/mom-style Google SSO travel planning.

Ephemeral users are wipe-on-logout. Their data must be written only under explicit user-scoped roots such as `inbox/email/user-<id>/` and `.orbiter/users/<id>/`.

Details:

- [MULTI_USER_GUEST_MODE.md](MULTI_USER_GUEST_MODE.md)
- [GOOGLE_SSO_GMAIL_TRAVEL.md](GOOGLE_SSO_GMAIL_TRAVEL.md)
- [LOCAL_PRODUCTION.md](LOCAL_PRODUCTION.md)
- [SECURITY.md](SECURITY.md)

## Mobile Capture

The iPhone Shortcut path is the fastest capture lane.

Flow:

1. iPhone Back Tap runs a Shortcut.
2. Shortcut asks for text.
3. Shortcut sends JSON to `/api/mobile/capture`.
4. Orbiter writes a note under `usernotes/mobile/` or a command under `commands/inbox/`.

Captures containing `COMMAND` or slash-command input become command records. Ordinary text becomes mobile usernotes.

Details:

- [IPHONE_CAPTURE.md](IPHONE_CAPTURE.md)
- [REMOTE_5G_ACCESS.md](REMOTE_5G_ACCESS.md)
- [COMMANDS.md](COMMANDS.md)

## Command And Codex Handoff

Orbiter separates request intake from execution.

Command lifecycle:

```text
pending -> reviewed -> running -> done
                         |
                         +-> rejected
```

The browser can preview a handoff without claiming it. The actual Codex bridge is the CLI:

```powershell
npm run codex:next
npm run codex:done -- --path <command-path>
npm run codex:reject -- --path <command-path>
```

This gives Orbiter remote command capability without letting the HTTP server execute arbitrary user text.

Details:

- [COMMANDS.md](COMMANDS.md)
- [API.md](API.md)

## Email

Orbiter supports email as an integration layer, with separate receive and send boundaries.

Receive paths:

- IMAP/app-password Gmail import for configured household accounts.
- Gmail API OAuth import for Google guest travel planning.

Send path:

- Browser or script creates reviewable outbound draft markdown.
- Draft must be approved.
- Approved draft can be sent through the configured SMTP account.
- Sent records are journaled under `journal/email-sent/`.

Email content is sensitive. Shared email visibility is role-filtered, and guest imports are user-scoped.

Details:

- [EMAIL_INTEGRATION.md](EMAIL_INTEGRATION.md)
- [GMAIL_SETUP.md](GMAIL_SETUP.md)
- [GOOGLE_SSO_GMAIL_TRAVEL.md](GOOGLE_SSO_GMAIL_TRAVEL.md)
- [SECURITY.md](SECURITY.md)

## Travel

Travel is the first premium domain workflow.

Data flow:

```text
Gmail messages -> markdown email notes -> itinerary generator -> JSON read model -> Travel tab
```

Current travel capabilities:

- import travel emails
- filter obvious marketing
- parse lodging, flights, tickets, rail, events, and confirmations
- generate a timeline
- show stays and transportation
- detect hotel/transport planning gaps
- queue Codex research or copy a ChatGPT prompt
- drip researched summary emails to Household Member
- support guest-scoped Google Gmail travel imports

Travel research is advisory. Orbiter must not mark a booking as real until a confirmation email, ticket, or explicit user correction exists.

Details:

- [TRAVEL_ITINERARY.md](TRAVEL_ITINERARY.md)
- [GOOGLE_SSO_GMAIL_TRAVEL.md](GOOGLE_SSO_GMAIL_TRAVEL.md)
- [EMAIL_INTEGRATION.md](EMAIL_INTEGRATION.md)

## Knowledge Graph

Orbiter builds a graph from the markdown workspace.

Nodes:

- notes
- folder domains
- tags

Edges:

- folder membership
- tags
- wiki links
- markdown links

The Graph tab renders the model client-side and supports browser-local pinned node positions through `localStorage`. The server remains the owner of graph data; the browser owns only manual layout preferences.

## Remote Access

Orbiter has three remote-access modes:

- Local-only: default `npm start`, loopback only.
- Tailnet: Tailscale for iPhone/remote private access.
- Public hostname: Cloudflare Tunnel to `https://example.com/`.

Cloudflare Tunnel publishes Orbiter without opening a router port, but it makes Orbiter reachable through a public hostname. Production auth and origin/host checks are therefore required.

Details:

- [LOCAL_PRODUCTION.md](LOCAL_PRODUCTION.md)
- [REMOTE_5G_ACCESS.md](REMOTE_5G_ACCESS.md)
- [CLOUDFLARE_TUNNEL.md](CLOUDFLARE_TUNNEL.md)
- [SECURITY.md](SECURITY.md)

## Self-Healing And Self-Upgrading

Orbiter should become easier to maintain as a one-person system, but self-upgrade must remain review-gated.

Self-heal may:

- check required folders
- check Git ignore safety
- check backend health
- run smoke checks
- detect stale running commands
- write issue records

Self-heal must not:

- pull from Git
- install dependencies
- send email
- mutate secrets
- auto-approve commands
- execute arbitrary prompts

Self-upgrade work enters the same command queue as any other Codex task.

Commands:

```powershell
npm run self:check
npm run self:heal
npm run self:upgrade -- --title "Title" --prompt "Prompt"
```

## Security Boundaries

The core security stance:

- Local files are private by default.
- `.orbiter/`, email imports, journals, commands, and generated private artifacts must stay ignored by Git.
- Admin-only routes protect command execution, destructive workspace actions, and outbound email.
- Guest users only read/write explicit scoped roots.
- OAuth credentials and refresh tokens stay under `.orbiter/`.
- Browser command preview must not claim work as running.
- Remote access requires production auth.

Details:

- [SECURITY.md](SECURITY.md)
- [GITHUB_PRE_PUSH_CHECKLIST.md](GITHUB_PRE_PUSH_CHECKLIST.md)

## Scaling Path

Orbiter should scale in stages:

1. File-backed markdown plus short in-memory cache.
2. Pagination and response projection for large `/api/notes` payloads.
3. Persistent `.orbiter/` index for faster search/graph/travel reads.
4. SQLite only if measured size or query complexity justifies it.
5. Cloud deployment only after local production is stable and data boundaries are mature.

Avoid premature platform work. The current priority is reliability for one owner, family users, travel, email, and remote access from a phone.

## Documentation Map

Start here:

- [README.md](../README.md) - quick start and operator commands.
- [PRODUCT.md](PRODUCT.md) - product direction.
- [ARCHITECTURE.md](ARCHITECTURE.md) - system map.
- [API.md](API.md) - API contract.
- [SECURITY.md](SECURITY.md) - security and data boundaries.

Subsystem docs:

- [COMMANDS.md](COMMANDS.md)
- [IPHONE_CAPTURE.md](IPHONE_CAPTURE.md)
- [REMOTE_5G_ACCESS.md](REMOTE_5G_ACCESS.md)
- [LOCAL_PRODUCTION.md](LOCAL_PRODUCTION.md)
- [CLOUDFLARE_TUNNEL.md](CLOUDFLARE_TUNNEL.md)
- [EMAIL_INTEGRATION.md](EMAIL_INTEGRATION.md)
- [GMAIL_SETUP.md](GMAIL_SETUP.md)
- [GOOGLE_SSO_GMAIL_TRAVEL.md](GOOGLE_SSO_GMAIL_TRAVEL.md)
- [MULTI_USER_GUEST_MODE.md](MULTI_USER_GUEST_MODE.md)
- [TRAVEL_ITINERARY.md](TRAVEL_ITINERARY.md)
- [SFTP_TRANSPORT.md](SFTP_TRANSPORT.md)

Future/cloud research:

- [STATIC_HOSTING_DEPLOYMENT.md](STATIC_HOSTING_DEPLOYMENT.md)
- [LAMBDA_API_DEPLOYMENT.md](LAMBDA_API_DEPLOYMENT.md)
- [CI_CD_PIPELINE.md](CI_CD_PIPELINE.md)

## Verification

Use these checks after implementation work:

```powershell
npm run smoke
npm run test:backend
npm run test:access-scope
npm run self:check
```

The in-app browser bridge is not a required verification gate while it is unreliable on this Windows setup. HTTP/API checks and manual browser inspection remain acceptable until that bridge is repaired.
