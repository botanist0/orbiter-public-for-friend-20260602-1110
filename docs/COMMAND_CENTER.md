# Command Center

Command Center is a hidden, feature-flagged dev dashboard for Orbiter mission readiness. It aggregates existing read models into one operating view without executing commands or mutating workspace state.

## Status

Implemented behind `ORBITER_FEATURE_COMMAND_CENTER=1`.

Production `npm run start:cloudflare` does not set this flag, so:

- the Command Center tab stays hidden,
- `/api/command-center` returns `404 feature_not_enabled`,
- `https://example.com/` does not roll out the feature.

The dev Cloudflare profile enables it:

```powershell
npm run start:cloudflare:dev
```

This runs Orbiter on:

```text
http://127.0.0.1:4174
```

with public origin:

```text
https://dev.example.com
```

## What It Shows

The dashboard currently summarizes:

- runtime profile, public origin, port, uptime, auth mode, and feature flags,
- active operator identity and role,
- note, email draft, command, graph, and travel counts,
- pending, reviewed, running, done, and rejected command counts,
- oldest command ready for Codex,
- stale `In Codex` commands claimed for more than six hours,
- approved outbound email drafts waiting to send,
- travel itinerary item counts and review gaps,
- local weather/eclipse status from the environment widget,
- recent Codex lifecycle events inferred from command files,
- recommendations derived from the current read models.

## Security Boundary

Command Center is admin-only in production auth mode.

The endpoint is intentionally read-only. It does not:

- run `npm run codex:next`,
- mark commands done,
- send email,
- import Gmail,
- delete files,
- execute shell commands.

This keeps the surface useful for status checks while avoiding a new remote-control path.

## Dev Host Setup

Use the existing Cloudflare Tunnel and add a second published application route:

```text
Hostname: dev.example.com
Service type: HTTP
Service URL: http://127.0.0.1:4174
Tunnel: Orbiter
```

If the Cloudflare UI splits hostname fields:

```text
Subdomain: dev
Domain: example.com
Path: leave blank
Service URL: http://127.0.0.1:4174
```

Then run the dev server:

```powershell
npm run start:cloudflare:dev
```

The existing production server can continue on port `4173` with:

```powershell
npm run start:cloudflare
```

Cloudflare can route both public hostnames through the same tunnel because each hostname points to a different local service URL.

## API

`GET /api/session` includes:

```json
{
  "environment": "dev",
  "runtime": {
    "environment": "dev",
    "publicOrigin": "https://dev.example.com",
    "host": "127.0.0.1",
    "port": 4174
  },
  "features": {
    "commandCenter": true
  }
}
```

`GET /api/command-center` returns the aggregate dashboard model only when the feature is enabled and the actor is an admin.

## Rollout Rule

Do not add `ORBITER_FEATURE_COMMAND_CENTER=1` to `start:cloudflare` until the feature is ready for production.
