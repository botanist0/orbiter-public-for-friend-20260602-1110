# iPhone Capture MVP

This integration lets an iPhone Shortcut send quick text captures into Orbiter.

## Backend Setup

Run:

```powershell
npm run mobile:setup
npm run start:lan
```

`mobile:setup` creates `.orbiter/mobile-token` if needed and prints the local endpoint, token, and Shortcut actions. `start:lan` binds Orbiter to `0.0.0.0` so another device on the same Wi-Fi can reach it.

Use this only on a trusted local network. The mobile endpoint requires the `x-orbiter-mobile-token` header, but the backend is still a local-network service.

## 5G / Away From Home

The Wi-Fi endpoint printed by `npm run mobile:setup` will not work on cellular data because private LAN IPs are not reachable from 5G.

For remote iPhone capture, use Tailscale:

```powershell
npm run remote:setup
npm run start:remote
```

Then update the Shortcut URL to the Tailscale endpoint printed by `remote:setup`.

See `docs/REMOTE_5G_ACCESS.md`.

For protected full-app access over Tailscale, use:

```powershell
npm run prod:setup
npm run start:prod
```

See `docs/LOCAL_PRODUCTION.md`.

## Shortcut Actions

Create a Shortcut named `Orbiter Capture`.

1. Add `Ask for Input`.
   - Prompt: `Orbiter note`
   - Input Type: `Text`
2. Add `Get Contents of URL`.
   - URL: use the endpoint from `npm run mobile:setup`
   - Method: `POST`
   - Headers:
     - `x-orbiter-mobile-token`: use the token from setup
     - `Content-Type`: `application/json`
   - Request Body: `JSON`
   - JSON fields:
     - `text`: Provided Input
     - `skill`: `capture`
     - `source`: `iphone-back-tap`
3. Add `Show Notification`.
   - Text: `Sent to Orbiter`

Then assign the Shortcut to Back Tap:

1. Open iPhone Settings.
2. Go to Accessibility.
3. Go to Touch.
4. Go to Back Tap.
5. Choose Double Tap or Triple Tap.
6. Select `Orbiter Capture`.

Apple documents that Back Tap can run a Shortcut when you double-tap or triple-tap the back of the iPhone.

## Output

Normal note captures are written to:

```text
usernotes/mobile/
```

Each capture includes:

- raw text
- source
- skill trigger
- backend local timestamp
- mobile tags

Command captures are written to:

```text
commands/inbox/
```

Command captures include:

- raw command text
- status
- source
- skill trigger, when detected

In production auth mode, command captures require an admin access token. Non-admin users can still send normal notes, but cannot queue Codex work.

## Slash Commands And `COMMAND`

Text that starts with a slash or contains the word `COMMAND` is treated as a command instead of a regular mobile note.

The first supported slash command is:

```text
/itinerary
```

This creates a pending command with `skill_trigger: itinerary`. Codex can then run `npm run itinerary` to import the travel Gmail account and regenerate the Travel tab.
