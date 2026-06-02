# Static Hosting Deployment Research

Status: future research/prototype. Orbiter's current production path is the local Node server behind Tailscale or Cloudflare Tunnel, not a detached static UI on a CDN.

This document stays here so future AWS/Azure work has a starting point, but do not treat it as the active runbook.

## Current Code

Orbiter has a static build helper:

```powershell
npm run build:static
```

That runs `scripts/build-static.mjs`, copies static files from `app/` into `dist/`, and writes basic routing helper files:

- `_redirects`
- `.htaccess`
- `web.config`

The build intentionally copies static assets only. The browser app still depends on `/api/*` from an Orbiter backend, so a static host alone is not a complete product deployment.

## When This Becomes Useful

Static hosting becomes relevant after Orbiter has:

- a stable remote API host,
- an auth model that works across the static origin and API origin,
- CORS/origin rules for the chosen public domains,
- a data model that is not tied to direct local filesystem reads from the UI,
- a secret-management plan outside `.orbiter/` for any cloud API.

Until then, use:

- [Local Production](LOCAL_PRODUCTION.md)
- [Cloudflare Tunnel](CLOUDFLARE_TUNNEL.md)
- [Security](SECURITY.md)

## Candidate Targets

### AWS S3 + CloudFront

Useful if the backend later moves to AWS Lambda/API Gateway.

Expected pieces:

- private S3 bucket for `dist/`,
- CloudFront Origin Access Control,
- HTTPS-only viewer policy,
- `index.html` fallback for client routes,
- `/api/*` behavior routed to the API origin,
- cache invalidation or versioned asset filenames.

### Azure Static Web Apps

Useful if Azure becomes the simpler deployment path.

Expected pieces:

- custom build that runs `npm run build:static`,
- `dist/` as the output folder,
- route fallback to `index.html`,
- API handled separately unless Orbiter is rewritten for Azure Functions.

## Guardrails

- Do not upload `.orbiter/`, imported email, journals, commands, usernotes, or generated private knowledge.
- Do not expose token-auth APIs from a static origin without reviewing CORS and cookie behavior.
- Do not assume ChatGPT subscriptions, Gmail app passwords, or local `.orbiter/` secrets work in a cloud deployment.
- Do not make CDN deployment automatic until GitHub push safety and secrets are clean.

## Verification If Revived

After a future static deployment:

```powershell
curl.exe -I https://<static-host>/
curl.exe -I https://<static-host>/login.html
curl.exe -I https://<static-host>/missing-client-route
```

Expected:

- root returns `200`,
- `login.html` returns `200`,
- client routes return the app shell,
- API calls go to the intended backend origin and enforce auth.
