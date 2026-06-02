# Orbiter API

Orbiter's API is a local-first JSON API for the browser app, iPhone capture, command review, and future integrations.

## Design Goals

- Keep markdown files as the source of truth.
- Keep endpoints predictable and small.
- Preserve backward compatibility once an endpoint is used by the browser, iPhone Shortcut, or automation.
- Make invalid input fail with clear `4xx` errors.
- Keep read paths fast enough for repeated UI refreshes without adding a database too early.

## API Version

The current API version is `v1`.

Every JSON response includes:

```text
x-orbiter-api-version: v1
cache-control: no-store
x-content-type-options: nosniff
```

Do not break an existing response shape without either adding a new field first or introducing a versioned endpoint.

## Error Shape

Errors keep the simple `error` string used by the frontend and add structured fields for automation:

```json
{
  "error": "Invalid JSON request body.",
  "code": "invalid_json",
  "statusCode": 400
}
```

Rules:

- Use `400` for malformed input.
- Use `401` for failed mobile authentication.
- Use `403` for paths outside allowed workspace roots.
- Use `404` for unknown routes.
- Use `500` only for unexpected server failures.

## Read Performance

Orbiter currently uses a short in-memory cache for markdown-derived reads.

- Default TTL: `1000ms`.
- Override: `ORBITER_CACHE_TTL_MS`.
- Cache invalidates after Orbiter writes, imports, deletes, mobile captures, or command status changes.
- Manual edits outside Orbiter can be stale for up to the TTL.

This keeps repeated `/api/notes`, `/api/search`, `/api/graph`, and `/api/commands` requests fast while preserving the local file model.

## Endpoints

### `GET /api/health`

Returns backend health, API version, workspace path, and cache metadata.

When production auth is required and the request is unauthenticated, the workspace path is redacted.

### `HEAD /api/health`

Returns health-check headers without a response body. This supports `curl -I`, tunnel probes, and uptime checks.

### `GET /api/session`

Returns access policy and current browser session state.

Also returns runtime and feature-flag metadata used by the browser to hide unfinished dev surfaces:

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

### `POST /api/session/login`

Accepts:

```json
{
  "token": "orb_..."
}
```

Returns the authenticated user and sets an HttpOnly `orbiter_session` cookie.

### `GET /api/google/oauth/status`

Returns whether Google SSO/Gmail import is configured, the redirect URI Orbiter expects, requested scopes, and the import cap.

This route is public so the login page can show or disable the Google button.

### `GET /api/google/oauth/start`

Redirects the browser to Google's OAuth consent screen.

Query parameters:

- `returnTo` - same-origin path to return to after login.
- `popup` - set to `1` when called from the Google popup login flow.

### `GET /api/google/oauth/callback`

Receives Google's OAuth callback, exchanges the code for tokens, creates or updates a local Google-backed `guest` user, stores tokens under `.orbiter/users/<user-id>/`, imports up to 100 travel Gmail messages, generates a user-scoped itinerary, sets the `orbiter_session` cookie, and redirects back to Orbiter.

### `POST /api/google/travel/import`

Authenticated route that reruns Gmail travel import for the signed-in Google user.

Accepts:

```json
{
  "limit": 100
}
```

Returns import counts, skipped messages, updated notes, and the user-scoped travel itinerary.

### `POST /api/session/logout`

Clears the browser session cookie.

If the authenticated user is marked `ephemeral`, logout also removes that user's explicitly scoped local data roots and returns purge metadata:

```json
{
  "authenticated": false,
  "purge": {
    "purged": true,
    "paths": [
      "inbox/email/user-mom"
    ]
  }
}
```

Orbiter only purges user-scoped roots; it does not scan shared folders and guess ownership.

### `GET /api/time`

Returns the backend machine's local time, date, timezone, offset, epoch, and ISO timestamp.

### `GET /api/environment`

Returns topbar environment-widget data:

- configured local location,
- current weather from Open-Meteo when coordinates are available,
- active local eclipse event if the configured location matches an event path/time window.

Without location configuration, the endpoint returns a stable `not_configured` shape instead of failing. Configure either `.orbiter/environment-config.json` or environment variables:

```json
{
  "location": {
    "label": "Home",
    "latitude": 39.0,
    "longitude": -77.0,
    "timeZone": "America/New_York"
  }
}
```

### `GET /api/command-center`

Hidden dev endpoint for the Command Center dashboard.

Requirements:

- `ORBITER_FEATURE_COMMAND_CENTER=1`.
- Admin access when production auth is enabled.

When the feature flag is off, the route returns:

```json
{
  "error": "Feature not enabled.",
  "code": "feature_not_enabled",
  "statusCode": 404
}
```

When enabled, the endpoint returns a read-only aggregate with:

- runtime profile and feature flags,
- current actor summary,
- note, command, email draft, graph, and travel counts,
- command queue health,
- stale `In Codex` handoffs,
- Codex lifecycle events,
- travel review gaps,
- environment widget status,
- recommendations.

The endpoint does not execute shell commands, send email, import Gmail, or mutate command status.

### `GET /api/notes`

Returns searchable markdown-backed records from:

- `usernotes/`
- `commands/`
- `inbox/`
- `outbox/`
- `knowledge/`
- `journal/`
- `issues-journal/`

### `POST /api/notes`

Creates a new markdown note in `inbox/`.

Required:

- `title`

Optional:

- `body`
- `type`
- `tags`

### `DELETE /api/notes`

Deletes a markdown record by workspace-relative path. The path must be under an allowed mutable root.

Admin-only in production auth mode because this mutates shared workspace state.

### `POST /api/import`

Imports markdown files into `inbox/`.

Admin-only in production auth mode because this writes shared workspace records.

### `GET /api/search?q=...`

Searches the cached note read model.

### `GET /api/skills`

Returns installed skill metadata for admin/command-capable views. In production auth mode, non-admin users receive an empty skills list because skills are treated as part of the command/Codex surface.

### `GET /api/graph`

Returns a graph model of notes, domains, tags, wiki links, and markdown links.

### `GET /api/commands`

Returns command records from `commands/`.

Admin-only in production auth mode. Non-admin users receive an empty command list so command prompts and Codex lifecycle metadata do not leak through the API.

### `POST /api/email/drafts`

Creates a local outbound email draft markdown record. In production mode, admin access is required.

Accepts:

```json
{
  "account": "gmail-primary",
  "to": "recipient@example.com",
  "subject": "Subject",
  "body": "Draft body"
}
```

Returns draft metadata and refreshed notes. This endpoint does not send SMTP mail.

### `PATCH /api/email/drafts`

Admin-only in production auth mode.

Updates a local outbound email draft status. The draft path must stay under `outbox/email/drafts/`.

Accepts:

```json
{
  "path": "outbox/email/drafts/gmail-primary/example.md",
  "status": "approved"
}
```

Allowed statuses:

- `draft`
- `approved`
- `rejected`

Sent drafts cannot be changed back to another status.

### `POST /api/email/drafts/send`

Admin-only in production auth mode.

Sends an approved local outbound email draft through the configured SMTP account. The backend refuses to send unless the draft is `type: email-draft`, lives under `outbox/email/drafts/`, has `status: approved`, and the request includes the explicit confirmation string.

Accepts:

```json
{
  "path": "outbox/email/drafts/gmail-primary/example.md",
  "confirmSend": "SEND"
}
```

Returns sent metadata and refreshed notes. On success, Orbiter marks the draft `status: sent` and writes an audit note under `journal/email-sent/`.

### `POST /api/commands`

Admin-only in production auth mode.

Creates a pending command record from the browser app.

Required:

- `command`

Optional:

- `skill`
- `source`
- `tags`
- `title`

### `GET /api/travel/itinerary`

Returns the generated travel itinerary model from `.orbiter/travel-itinerary.json`.

The generator is run separately with `npm run travel:itinerary` so email parsing stays explicit and auditable. The response contains `generatedAt`, `sourceFolder`, `itemCount`, and `items`.

### `PATCH /api/commands`

Admin-only in production auth mode.

Updates command status.

Allowed statuses:

- `pending`
- `reviewed`
- `running`
- `done`
- `rejected`

### `POST /api/codex/next`

Admin-only in production auth mode.

Claims the oldest `reviewed` command, marks it `running`, and returns the handoff text that should be pasted into the Codex thread. This endpoint does not run arbitrary shell commands.

Optional:

- `path` - claim a specific reviewed command file under `commands/`.

### `GET /api/codex/history`

Returns a live Codex activity timeline derived from Orbiter-owned command metadata. This does not read private Codex desktop transcripts. It reports command lifecycle events such as queued, approved, claimed, requeued, completed, and rejected.

Admin-only in production auth mode. Non-admin users receive an empty restricted history model with `accessRestricted: true`.

Returns:

- `generatedAt`
- `runningCount`
- `reviewedCount`
- `accessRestricted`
- `events`

### `POST /api/mobile/capture`

Receives token-authenticated iPhone Shortcut captures.

Authentication options:

- `x-orbiter-mobile-token` for legacy shared mobile capture.
- `x-orbiter-access-token` for user-attributed production capture.

Normal text lands in `usernotes/mobile/`.

Text containing `COMMAND` lands in `commands/inbox/` only for admin access users when production auth is enabled. Non-admin access users and the legacy shared mobile token receive `403 admin_required` for command captures in production auth mode.

## Scaling Path

Do not add a database until the file-backed model becomes a measured bottleneck.

Preferred sequence:

1. Keep the short-lived cache and invalidate it on writes.
2. Add pagination and summary/body projection when note count grows.
3. Add a persistent generated index under `.orbiter/` for startup speed.
4. Add background workers for email, SFTP, file ingest, and embeddings.
5. Add SQLite only when query complexity or workspace size justifies it.

## API Change Rules

- Add fields rather than renaming fields.
- Add endpoints rather than changing endpoint meaning.
- Keep mutation endpoints explicit and auditable.
- Keep mobile and future remote endpoints authenticated.
- Keep filesystem paths workspace-relative in public API responses.
