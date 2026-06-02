# Orbiter

Orbiter is a local-first second brain starter. It is inspired by agent workspaces such as OpenClaw, but the first version is deliberately smaller: capture notes, keep simple markdown knowledge, and give an assistant a few clear skills instead of a large tool platform.

## What Is Here

- `app/` - a browser app for quick capture, review, search, markdown import, and markdown export.
- `skills/` - reusable assistant workflows. Each skill lives in its own folder with a `SKILL.md`.
- `knowledge/` - durable notes organized in a simple PARA-style structure.
- `inbox/` - quick captures that still need sorting.
- `usernotes/` - ad hoc notes written by the user that need to be processed into notes.
- `commands/` - mobile or local prompts intended for Orbiter/Codex review.
- `issues-journal/` - engineering-style issue records for problems Orbiter catches.
- `journal/` - daily notes and review logs.
- `templates/` - markdown templates for consistent notes.
- `scripts/` - the local backend plus no-dependency Node helpers for creating/searching notes.
- `docs/` - architecture, API, security, subsystem runbooks, and deployment research.

## Documentation

Start with:

- [docs/README.md](docs/README.md) - documentation map.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - high-level system architecture.
- [docs/API.md](docs/API.md) - API contract, error shape, performance model, and scaling path.
- [docs/SECURITY.md](docs/SECURITY.md) - roles, data boundaries, Git safety, and remote-access rules.

## Quick Start

```powershell
npm start
```

Then open the printed local URL.

By default, the backend binds to `127.0.0.1` for local-machine access only. Set `HOST=0.0.0.0` only after the local network and firewall decision is explicit.

For iPhone capture over your local Wi-Fi:

```powershell
npm run mobile:setup
npm run start:lan
```

Use the setup output to build an iOS Shortcut, then assign that Shortcut to Back Tap on the iPhone.

For iPhone capture over 5G after Tailscale is installed on Windows and iPhone:

```powershell
npm run remote:setup
npm run start:remote
```

Use the Tailscale endpoint from `remote:setup` in the same iOS Shortcut.

Create a markdown note from the terminal:

```powershell
npm run note -- "Meeting with Sam" --tags people,work --body "Follow up next Tuesday."
```

Search local markdown notes:

```powershell
npm run search -- "follow up"
```

Run local smoke checks:

```powershell
npm run smoke
```

Test the mobile capture endpoint after `mobile:setup`:

```powershell
npm run mobile:test
```

Create and validate the private Gmail email config:

```powershell
npm run email:setup -- --address "your.address@gmail.com"
npm run email:secret
npm run email:validate
npm run email:test
npm run email:ingest
```

If your Google account uses 2FA, generate an app password in Google Account Security and store it with the `email:secret` helper. For the travel account, use the GUI variant to choose the right account:

```powershell
npm run email:add -- --address "travel.address@gmail.com" --label "Travel Gmail" --id "gmail-travel"
npm run email:secret:gui -- --account gmail-travel
npm run email:test -- --account gmail-travel
npm run email:ingest -- --account gmail-travel
```

## Remote Access and Users

Orbiter can run in production mode with authenticated users and external access.

Create the first owner user and enable auth:

```powershell
npm run prod:setup
npm run start:prod
```

List configured access users:

```powershell
npm run access:list
```

Add another person:

```powershell
npm run access:add -- --id alice --name "Alice" --role member
```

Rotate or revoke a token:

```powershell
npm run access:rotate -- --id alice
npm run access:remove -- --id alice
```

Do not commit the admin-only access token file under `.orbiter/` or `access-admin-only.json`. These tokens are secrets used for login and should remain private.

For public HTTPS access through Cloudflare Tunnel, Orbiter can be exposed at:

```text
https://example.com/
```

Start the Cloudflare tunnel mode:

```powershell
npm run start:cloudflare
npm run cloudflare:run
```

Then open `https://example.com/` and log in with a valid access token.

Review pending mobile commands:

```powershell
npm run commands
```

Generate a static JSON search snapshot from local markdown, if needed for export/debugging:

```powershell
npm run index
```

List installed skills:

```powershell
npm run skills
```

## Design Principles

1. Local files are the source of truth.
2. Notes should be readable without Orbiter.
3. Skills should be short, specific, and safe to run.
4. Default workflows should fit normal people: capture, organize, review, and find.
5. Automation should be added only after the manual flow is clear.
6. Mobile commands should enter a review queue before execution.

## Current Roadmap

- Make Google SSO and guest travel import usable for non-technical family users.
- Improve the Travel tab into a richer home-based travel agent dashboard.
- Add a System tab for self-heal status, server profile, tunnel status, and stale command visibility.
- Keep Codex handoff review-gated while making command status clearer.
- Add pagination/projection before note payloads become large.
