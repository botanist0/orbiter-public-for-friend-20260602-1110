# Google SSO Gmail Travel

Orbiter can let a family guest sign in with Google, connect Gmail, import up to 100 travel-relevant messages, generate a scoped itinerary, and remove that guest's local data on logout.

## What This Enables

- A new user clicks `Sign in with Google`.
- Google handles Gmail account authentication and consent.
- Orbiter creates or updates a local `guest` user.
- Orbiter stores OAuth tokens under `.orbiter/users/<user-id>/`.
- Orbiter imports Gmail travel messages under `inbox/email/user-<user-id>/`.
- Orbiter generates that user's itinerary under:
  - `.orbiter/users/<user-id>/travel-itinerary.json`
  - `knowledge/projects/travel/users/<user-id>/itinerary.md`
- Logout wipes the guest's scoped local data if the user is ephemeral.

## Google Cloud Setup

Create a Google Cloud OAuth client:

1. Open Google Cloud Console.
2. Create or choose a project.
3. Enable the Gmail API.
4. Configure the OAuth consent screen.
5. Create OAuth credentials with application type `Web application`.
6. Add an authorized redirect URI:

```text
https://example.com/api/google/oauth/callback
```

For local-only testing, also add:

```text
http://localhost:4173/api/google/oauth/callback
```

## Orbiter Config

Create this private file:

```powershell
notepad .orbiter\google-oauth.json
```

Use this shape:

```json
{
  "clientId": "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com",
  "clientSecret": "YOUR_GOOGLE_CLIENT_SECRET",
  "importLimit": 100
}
```

This file is intentionally under `.orbiter/`, which is ignored by Git.

When running behind Cloudflare, keep using the Cloudflare start mode so Orbiter knows its public origin:

```powershell
npm run start:cloudflare
```

## Runtime Flow

1. Open Orbiter.
2. Click `Sign in with Google` on the login page.
3. Choose the Gmail account.
4. Approve Gmail read-only access.
5. Orbiter imports up to 100 matching travel messages.
6. Orbiter opens the Travel tab with that user's scoped itinerary.

The Travel tab also has:

- `Connect Google` to reconnect/refresh consent.
- `Import 100 travel emails` to rerun the import for the signed-in Google user.

## Scopes

Orbiter requests:

- `openid`
- `email`
- `profile`
- `https://www.googleapis.com/auth/gmail.readonly`

`gmail.readonly` is enough for travel parsing and does not allow Orbiter to modify, delete, or send mail.

## Data Safety

Google guest imports do not write into Nitro or Household Member's shared travel account folders.

Guest data goes under user-scoped roots:

- `.orbiter/users/<user-id>/`
- `inbox/email/user-<user-id>/`
- `knowledge/projects/travel/users/<user-id>/`

For ephemeral Google guests, logout removes those scoped roots.
