# Lambda API Deployment Research

Status: future research/prototype. Orbiter's real backend is currently `scripts/server.mjs` running on the home Windows PC. The Lambda code in this repo is a mock/prototype for learning the shape of an AWS API, not a production replacement for the local backend.

## Current Code

Prototype file:

```text
lambda/api-notes.mjs
```

It demonstrates:

- Lambda handler shape,
- bearer-token validation,
- basic CORS headers,
- mock `GET /api/notes`,
- mock `POST /api/notes`,
- mock `DELETE /api/notes`.

It does not read the real Orbiter workspace, enforce the full role model, serve Google OAuth, send email, ingest Gmail, build travel itineraries, or operate Codex handoff.

## Current Production Path

Use these docs for the system that actually runs today:

- [Architecture](ARCHITECTURE.md)
- [API](API.md)
- [Local Production](LOCAL_PRODUCTION.md)
- [Cloudflare Tunnel](CLOUDFLARE_TUNNEL.md)
- [Security](SECURITY.md)

## What Would Need To Change

Moving Orbiter API work to Lambda would require a real architecture decision:

1. Replace direct local filesystem reads with a durable backend data store or sync layer.
2. Move secrets out of `.orbiter/` and into a managed secret store.
3. Replace local access-token sessions with a cloud-compatible auth provider or signed session model.
4. Rebuild email receive/send so credentials and SMTP access are safe in cloud runtime.
5. Decide whether Codex handoff remains local or becomes a cloud queue.
6. Rebuild guest data purge rules against the chosen storage system.
7. Reimplement or proxy every route documented in [API](API.md), not only `/api/notes`.

## Candidate AWS Shape

If this path is revived, the likely shape is:

```text
Static UI on CloudFront
        |
        +-- /api/* -> API Gateway
                       |
                       +-- Lambda functions
                       +-- Secrets Manager
                       +-- DynamoDB or S3-backed records
                       +-- CloudWatch logs
```

This is materially more complex than the current local system. Use it only when the local Cloudflare/Tailscale path is no longer enough.

## Prototype Packaging

The current prototype can be packaged manually:

```powershell
cd lambda
Compress-Archive -Path api-notes.mjs -DestinationPath ..\api-notes.zip -Force
```

On Linux/macOS CI:

```bash
cd lambda
zip -r ../api-notes.zip api-notes.mjs
```

## Auth Warning

The prototype uses `VALID_TOKEN` as a bearer token. That is acceptable for a mock but not enough for a family-facing production app.

Future production should prefer one of:

- Google/OpenID Connect backed sessions,
- AWS Cognito,
- a narrow custom auth service with token rotation and audit logs.

## Verification If Revived

Minimum checks for any future Lambda prototype:

- authenticated `GET /api/notes` returns `200`,
- missing token returns `401`,
- wrong token returns `403`,
- malformed JSON returns a controlled `400`,
- CORS allows only the intended UI origin,
- CloudWatch logs do not print secrets or full private note bodies.
