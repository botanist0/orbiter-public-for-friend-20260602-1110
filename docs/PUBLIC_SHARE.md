# Public Sharing Orbiter

Use this process when sharing Orbiter with a friend or publishing a code-only version.

## Why a Fresh Repo

This workspace previously tracked personal inbox, email, travel, command, journal, and attachment files. Removing those files in a normal commit does not remove them from Git history. Treat any credentials, booking details, tickets, email content, or private access tokens that reached GitHub as exposed.

GitHub's sensitive-data guidance recommends removing sensitive data from history only with a coordinated history rewrite, and also notes that exposed secrets should be rotated. For a friend-facing code review, a fresh repo with no old history is simpler and safer.

## Prepare a Clean Snapshot

Run:

```powershell
npm run public:prepare
```

This writes a fresh repo under:

```text
.public-share/Orbiter-public
```

The generated snapshot:

- excludes `.git`, `.orbiter`, `.codex`, `.public-share`, build output, logs, and dependency folders,
- excludes personal data folders such as `inbox/`, `usernotes/`, `journal/`, `outbox/`, `commands/inbox/`, `knowledge/`, and `issues-journal/` except placeholder `README.md` files,
- excludes generated search indexes, email files, archives, and key/certificate-looking files,
- redacts obvious personal hostnames, email addresses, and household names in copied text files,
- initializes a brand-new Git repository with files staged.

## Publish the Clean Repo

From the generated folder:

```powershell
cd .public-share\Orbiter-public
git status --short
git commit -m "Initial sanitized Orbiter share"
git remote add origin <NEW_EMPTY_REPO_URL>
git push -u origin main
```

Use a new empty repository. Do not reuse the old remote history.

If someone else will upload the repo for you, send only the sanitized snapshot or zip and the steps in [Friend Repo Handoff](FRIEND_REPO_HANDOFF.md).

## Take Down the Old Repo

The current remote is:

```text
https://github.com/example-user/Orbiter-master.git
```

Recommended order:

1. Keep the old repo private, or delete it if you no longer need that history.
2. Rotate any exposed tokens, Gmail app passwords, Google OAuth secrets, Cloudflare tunnel credentials, GitHub recovery codes, and Orbiter access/mobile tokens.
3. Publish the sanitized snapshot to a new private repository.
4. Give your friend access only to the new repository unless they need temporary access to help with cleanup.

If you need to preserve the old repo URL, use GitHub's sensitive-data removal process with `git-filter-repo`, force-push the rewritten history, and contact GitHub Support if cached views or pull-request refs still expose sensitive content.

## Pre-Share Audit

Before sending the new repo URL:

```powershell
cd .public-share\Orbiter-public
rg -n -i "your-real-domain|your-personal-email|your-travel-email|github recovery|orb_[A-Za-z0-9_-]+|BEGIN RSA|BEGIN OPENSSH|BEGIN PRIVATE" .
rg -n -i "password|secret|token|gmail|booking id|owner-name|household-member" .
```

The first command should have no private account strings or real secrets. The second command may find source-code labels, generic documentation, or placeholder examples; verify each match manually.

If Git refuses to operate in the generated folder with a safe-directory warning, either run the audit with `rg` first or explicitly trust only the generated folder:

```powershell
git config --global --add safe.directory C:/Users/Owner/Orbiter/.public-share/Orbiter-public
```
