# Local Production Access

Orbiter's production stage is a local service on the home Windows PC with authenticated access. It can be reached privately through Tailscale or publicly through Cloudflare Tunnel.

## Model

- Windows PC runs Orbiter.
- Tailscale provides the private network path from phones and trusted devices.
- Cloudflare Tunnel provides the public HTTPS path for `https://example.com/` without router port forwarding.
- Tailscale production mode rejects non-loopback and non-Tailscale clients.
- Cloudflare mode binds Orbiter to loopback and relies on host/origin checks plus production auth.
- Browser access uses per-user access tokens exchanged for an HttpOnly session cookie.
- iPhone Shortcuts can use either the legacy mobile token or a per-user access token.
- Codex work is queued in `commands/inbox/`; Orbiter does not execute arbitrary remote commands by itself.

## Setup

Run:

```powershell
npm run prod:setup
```

This writes private access config under `.orbiter/`, enables auth, enables the Tailscale network guard, and creates the first owner user if no access users exist.

Start production mode:

```powershell
npm run start:prod
```

Then open the Tailscale URL printed by setup:

```text
http://<windows-tailscale-ip>:4173/
```

For Cloudflare Tunnel browser access at `https://example.com/`, use:

```powershell
npm run start:cloudflare
```

Then run the tunnel with:

```powershell
npm run cloudflare:run
```

Full setup is in `docs/CLOUDFLARE_TUNNEL.md`.

## Users

List configured access users:

```powershell
npm run access:list
```

Add another person:

```powershell
npm run access:add -- --id wife --name "Wife" --role member
```

Supported roles:

- `admin` - can create Codex commands, operate Codex handoff, manage command lifecycle, and use outbound email drafts.
- `wife` - trusted household access. Can use the app and copy ChatGPT travel prompts, but cannot create, view, or operate Codex commands and only sees the shared travel Gmail account in email/search/graph surfaces.
- `member` - basic user role for future narrower access rules.

Update a user's non-secret metadata:

```powershell
node scripts/access.mjs update --id partner --name "Partner" --role wife
node scripts/access.mjs update --id owner --phone +15555550123
```

Rotate a token:

```powershell
npm run access:rotate -- --id wife
```

Remove a user and revoke their browser sessions:

```powershell
npm run access:remove -- --id wife
```

Plaintext access tokens are printed only when created or rotated. Orbiter stores only token hashes in `.orbiter/access-users.json`.

## iPhone Shortcut

For user-owned captures, use the production endpoint:

```text
http://<windows-tailscale-ip>:4173/api/mobile/capture
```

Headers:

```text
x-orbiter-access-token: <that user's access token>
Content-Type: application/json
```

JSON body:

```json
{
  "text": "Provided Input",
  "skill": "capture",
  "source": "iphone"
}
```

If the text starts with a slash command or contains `COMMAND`, Orbiter writes it to `commands/inbox/` only for admin access users. Non-admin access users and the legacy shared mobile token can still send normal notes, but cannot queue Codex commands when production auth is enabled.

## Remote Codex Work

Use the Commands tab while signed into Orbiter to queue work for Codex. The command becomes a markdown file with `status: pending`.

This is intentional. Orbiter should not expose a remote endpoint that directly runs shell commands or edits code. Codex remains the execution layer, and the command queue is the auditable handoff.

## Network Guard

`npm run start:prod` sets:

```text
HOST=0.0.0.0
ORBITER_AUTH=1
ORBITER_NETWORK_GUARD=tailscale
```

With `ORBITER_NETWORK_GUARD=tailscale`, Orbiter accepts:

- `127.0.0.1`
- `::1`
- Tailscale IPv4 clients in `100.64.0.0/10`

It rejects ordinary LAN clients even though the server is bound to `0.0.0.0`.

## What This Is Not

- Not a public SaaS deployment.
- Not AWS/ECS.
- Not router port forwarding.
- Not automatic remote shell execution.
- Not a replacement for backing up `.orbiter/` secrets and markdown data.
