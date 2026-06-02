# Orbiter Documentation

This folder is organized so the top-level docs explain the system, current subsystem docs carry runbooks for code that exists, and future/prototype docs preserve research without pretending Orbiter is already deployed that way.

## Start Here

- [Product](PRODUCT.md) - what Orbiter is trying to become.
- [Architecture](ARCHITECTURE.md) - high-level system map and subsystem boundaries.
- [API](API.md) - HTTP contract used by the browser app, mobile capture, and integrations.
- [Security](SECURITY.md) - data privacy, user roles, Git safety, and remote-access boundaries.
- [GitHub Pre-Push Checklist](GITHUB_PRE_PUSH_CHECKLIST.md) - what to check before pushing this local repo.
- [Public Sharing](PUBLIC_SHARE.md) - how to generate a clean friend-facing repo without local user data or old Git history.
- [Friend Repo Handoff](FRIEND_REPO_HANDOFF.md) - private-repo instructions when someone else uploads the sanitized snapshot.

## Current Runtime Runbooks

- [Local Production](LOCAL_PRODUCTION.md) - production auth and local server profiles.
- [Remote 5G Access](REMOTE_5G_ACCESS.md) - Tailscale path for phone access away from home.
- [Cloudflare Tunnel](CLOUDFLARE_TUNNEL.md) - public HTTPS route for `example.com`.
- [iPhone Capture](IPHONE_CAPTURE.md) - Back Tap and Shortcut capture flow.

## Users And Auth

- [Multi-User Guest Mode](MULTI_USER_GUEST_MODE.md) - household users, guests, scoped data, and wipe-on-logout behavior.
- [Google SSO Gmail Travel](GOOGLE_SSO_GMAIL_TRAVEL.md) - Google OAuth setup and guest Gmail travel import.

## Core Workflows

- [Commands](COMMANDS.md) - command lifecycle, Codex handoff, and command safety.
- [Command Center](COMMAND_CENTER.md) - hidden dev dashboard and lower-environment run profile.
- [Email Integration](EMAIL_INTEGRATION.md) - receive, draft, approve, and send architecture.
- [Gmail Setup](GMAIL_SETUP.md) - private Gmail app-password setup for configured household accounts.
- [Travel Itinerary](TRAVEL_ITINERARY.md) - travel email parsing, itinerary generation, gaps, and research handoff.
- [Environment Widget](ENVIRONMENT_WIDGET.md) - local time, weather, and eclipse-event widget.

## Future And Prototype Notes

- [CI/CD Pipeline](CI_CD_PIPELINE.md) - prototype AWS workflow notes; not the current production path.
- [Static Hosting Deployment](STATIC_HOSTING_DEPLOYMENT.md) - future static UI hosting research.
- [Lambda API Deployment](LAMBDA_API_DEPLOYMENT.md) - Lambda/API Gateway prototype notes.
- [SFTP Transport](SFTP_TRANSPORT.md) - future file-transfer intake plan.

## Workspace Folder Contracts

Each major workspace folder has its own `README.md`. These README files document folder purpose and are safe to keep in Git; the private records inside the folders are ignored unless explicitly reviewed.

- `commands/` - reviewable Codex prompts and lifecycle records.
- `inbox/` - unprocessed captures and imported email roots.
- `usernotes/` - user-written rough notes.
- `knowledge/` - durable organized notes, decisions, resources, and projects.
- `journal/` - operational logs, sync logs, and sent-email journals.
- `issues-journal/` - engineering issue records.
- `outbox/email/drafts/` - reviewable outbound email drafts.

## Rule Of Thumb

Use [Architecture](ARCHITECTURE.md) to understand how Orbiter fits together. Use the subsystem docs when you need implementation details, setup steps, or operational runbooks.

When a new subsystem becomes real, add:

1. A short architecture summary in [Architecture](ARCHITECTURE.md).
2. A dedicated subsystem doc if the details are longer than a few paragraphs.
3. A link in this index.
4. API details in [API](API.md) when browser, mobile, or automation code depends on an endpoint.
