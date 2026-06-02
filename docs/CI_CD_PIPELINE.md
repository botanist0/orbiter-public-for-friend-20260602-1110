# CI/CD Pipeline Notes

Status: prototype/manual only. Orbiter's current operational model is local-first. The GitHub Actions workflow in `.github/workflows/deploy-aws.yml` is preserved as an AWS deployment prototype, but it no longer runs automatically on every push.

## Current Workflow Config

Workflow:

```text
.github/workflows/deploy-aws.yml
```

Trigger:

```text
workflow_dispatch only
```

Default behavior:

- build static assets with `npm run build:static`,
- package `lambda/api-notes.mjs`,
- do not deploy unless the manual `deploy` input is set to `true`.

The infrastructure job is separately gated by `deploy_infrastructure=true` and expects an `infrastructure/` folder. That folder does not currently exist in this repo, so infrastructure deployment should stay off until the Terraform project is created.

## Why It Is Manual

Automatic AWS deployment conflicts with the current architecture:

- Orbiter's real backend is local filesystem based.
- `.orbiter/` secrets are local-only.
- Imported email, commands, journals, usernotes, and knowledge data must not be uploaded.
- The current live path is Cloudflare Tunnel to the home PC, not Lambda/API Gateway.

Manual-only keeps the prototype from failing or leaking assumptions during ordinary pushes.

## Required Secrets If Revived

The deploy jobs expect GitHub Actions secrets:

- `AWS_ACCOUNT_ID`
- `API_TOKEN`
- `API_GATEWAY_ID`
- `TF_STATE_BUCKET` if Terraform is enabled

The workflow also has placeholder env values that must be replaced before real deployment:

- `S3_BUCKET`
- `CLOUDFRONT_DISTRIBUTION_ID`
- `CLOUDFRONT_DOMAIN`
- `LAMBDA_FUNCTION`

## Safe Push Checks

Before pushing to GitHub, use:

- [GitHub Pre-Push Checklist](GITHUB_PRE_PUSH_CHECKLIST.md)
- [Security](SECURITY.md)

Minimum local checks:

```powershell
npm run smoke
npm run test:backend
npm run test:access-scope
npm run self:check
```

Minimum Git safety checks are documented in [GITHUB_PRE_PUSH_CHECKLIST.md](GITHUB_PRE_PUSH_CHECKLIST.md).

## Future Promotion Criteria

Only turn this into an automatic CI/CD pipeline after:

1. Git ignore safety is verified.
2. Secrets are managed by GitHub/AWS and not local files.
3. The real API architecture is cloud-compatible.
4. The deployment target is no longer a mock Lambda.
5. A rollback plan exists.
6. The workflow uses non-placeholder resource IDs.
7. GitHub branch protection requires tests before merge.

Until then, use the workflow as a packaging and deployment experiment, not as Orbiter production.
