# GitHub Pre-Push Security Checklist

Use this before pushing Orbiter to any remote. Treat a public repo as the default threat model: source code and generic docs can go up; live second-brain data, emails, tokens, sync state, and personal journals stay local.

## Commit Boundary

Safe to commit:

- `app/` source files, except generated `app/search-index.json`
- `scripts/` source files
- `lambda/` source files
- `templates/`
- `skills/`
- `docs/`
- `.github/workflows/`
- `package.json` and `package-lock.json`
- folder `README.md` files that preserve the workspace shape

Keep local only:

- `.orbiter/`
- `inbox/` content, especially `inbox/email/` and `inbox/attachments/email/`
- `outbox/email/` drafts and sent working files
- `journal/` content, especially `journal/email-sync/` and `journal/email-sent/`
- `commands/inbox/` command queue records
- `usernotes/`
- `knowledge/` personal decisions, resources, and project notes
- `issues-journal/` operational issue records
- `app/search-index.json`
- Cloudflare diagnostic ZIPs and logs
- `.env`, certificates, SSH keys, Terraform state, and cloud provider local credential folders

## Required Checks

Run these before staging:

```powershell
git status --short
git check-ignore -v .orbiter/email-secrets.json
git check-ignore -v inbox/email/README.md
git check-ignore -v inbox/email/gmail-travel/example.md
git check-ignore -v inbox/attachments/email/gmail-travel/example.pdf
git check-ignore -v outbox/email/drafts/example.md
git check-ignore -v journal/email-sync/example.md
git check-ignore -v commands/inbox/example.md
git check-ignore -v usernotes/example.md
git check-ignore -v knowledge/projects/travel/itinerary.md
git check-ignore -v issues-journal/example.md
git check-ignore -v app/search-index.json
```

Expected result: every `git check-ignore` command should print the matching `.gitignore` rule. If any command prints nothing, fix `.gitignore` before pushing.

After staging, run:

```powershell
git diff --cached --name-only
git diff --cached --name-only | Select-String -Pattern '^\.orbiter/|^inbox/|^outbox/email/|^journal/|^commands/inbox/|^usernotes/|^knowledge/|^issues-journal/|app/search-index\.json|cloudflared-diag|\.env|secret|token|password|credential|\.pem|\.key|\.p12|\.pfx'
```

Expected result for the second command: no output, except intentional generic `README.md` files if you decide to stage them.

Scan staged content for obvious secrets:

```powershell
git diff --cached | Select-String -Pattern 'BEGIN .*PRIVATE KEY|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]+|sk-[A-Za-z0-9]+|AIza[0-9A-Za-z_-]{35}|x-orbiter-access-token|x-orbiter-mobile-token|app password|access token:|password:|secret:'
```

Expected result: no real secrets. Documentation examples may create false positives; verify each one manually.

## If Sensitive Files Are Already Tracked

`.gitignore` only protects untracked files. If Git already knows about a sensitive path, remove it from the index without deleting your local copy:

```powershell
git rm --cached -r .orbiter inbox/email inbox/attachments/email outbox/email journal/email-sync journal/email-sent commands/inbox usernotes knowledge issues-journal app/search-index.json
git add .gitignore docs/GITHUB_PRE_PUSH_CHECKLIST.md
git status --short
```

Do not run this blindly if you have intentionally versioned a specific file under one of those folders. Re-add only generic `README.md` files after review.

## Friend Or Public Code Review

Do not push this working repo, or any branch based on its existing history, for outside review if personal data was ever committed. Build a fresh sanitized snapshot instead:

```powershell
npm run public:prepare
cd .public-share\Orbiter-public
rg -n -i "your-real-domain|your-personal-email|your-travel-email|github recovery|orb_[A-Za-z0-9_-]+|BEGIN RSA|BEGIN OPENSSH|BEGIN PRIVATE" .
git status --short
```

Expected result for the `rg` command: no private account strings or real secrets. Generic documentation warnings about rotating secrets are acceptable after manual review.

Publish only `.public-share\Orbiter-public` to a new empty repository. Do not reuse the old remote history. See [Public Sharing](PUBLIC_SHARE.md).

## Current Gaps To Review Before Public Push

- Some source and docs contain personal defaults or references, including email addresses, the `example.com` domain, and user-facing examples. These are not credential leaks, but they are personal metadata.
- Git history may already contain private files if they were committed before the new ignore rules. If so, rotate leaked credentials and clean history before pushing.
- `scripts/access-token-email.mjs` can create token-bearing drafts. The script itself is source code, but any generated draft must stay under ignored `outbox/email/`.
- `.github/workflows/deploy-aws.yml` uses GitHub Secrets correctly, but verify no real account IDs, API Gateway IDs, or bearer tokens are hardcoded before enabling CI.
- `.github/workflows/deploy-aws.yml` is currently manual-only and prototype-gated. Keep it that way until AWS deployment is a real architecture decision.
- The local app is exposed through Cloudflare Tunnel in your current setup. GitHub push safety is separate from runtime exposure; keep `.orbiter/cloudflare/` ignored.

## If A Secret Was Pushed

1. Rotate or revoke it immediately.
2. Remove it from Git history before making the repo public.
3. Enable GitHub secret scanning.
4. Assume email app passwords, access tokens, mobile tokens, and Cloudflare tunnel credentials are burned if they ever appear in a pushed commit.
