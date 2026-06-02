# Multi-User Guest Mode

Orbiter's next product phase is to support non-technical family users without turning the owner workspace into a shared data pile.

## Goal

Create a mom-friendly flow:

1. User signs in.
2. Orbiter creates a temporary local user workspace.
3. User connects Gmail.
4. Orbiter imports up to 100 travel-related messages.
5. Orbiter generates a travel plan and gaps.
6. When the user logs out, Orbiter removes that user's local imported data.

## User Types

### Household Users

Household users are persistent.

Examples:

- `nitro`
- `wife`

Their notes, travel state, commands, and journals can remain on disk.

### Ephemeral Guest Users

Ephemeral users are temporary and wipe-on-logout.

Example:

```powershell
npm run access:add -- --id mom --name "Mom" --role guest --ephemeral true
```

Guest users should not be able to:

- run Codex commands,
- read owner email,
- send owner email,
- delete shared workspace files,
- see shared command history.

Guest users should be able to:

- connect their own email account,
- import a limited travel sample,
- view their generated itinerary,
- ask for travel-gap research prompts,
- log out and wipe their local data.

## Data Scope

Ephemeral data must be written under explicit user-scoped folders only.

Current purge roots:

- `.orbiter/users/<user-id>/`
- `inbox/email/user-<user-id>/`
- `inbox/attachments/email/user-<user-id>/`
- `outbox/email/drafts/user-<user-id>/`
- `journal/email-sync/user-<user-id>/`
- `journal/email-sent/user-<user-id>/`
- `knowledge/projects/travel/users/<user-id>/`

The logout endpoint purges only these scoped roots when `session.user.ephemeral === true`.

Read visibility follows the same boundary. A `guest` user only sees records under the scoped roots above. A regular `member` can use non-sensitive app surfaces but cannot read shared email records unless those records are written under that member's user-scoped roots. The `wife` role can read the shared travel mailbox, and `admin` can read the full owner workspace.

## SSO Direction

The correct SSO path for a new Gmail-owning user is [Google Identity Services for web](https://developers.google.com/identity/gsi/web/guides/overview), backed by OpenID Connect. Google documents Sign in with Google as built on OpenID Connect and OAuth 2.0.

The Gmail import path should then use Gmail API OAuth, not app passwords. Google's Gmail API exposes [`users.messages.list`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list) for listing messages, and full message details are fetched separately. Orbiter should request the smallest [Gmail API scope](https://developers.google.com/workspace/gmail/api/auth/scopes) that can support travel parsing.

Implementation and setup details live in `docs/GOOGLE_SSO_GMAIL_TRAVEL.md`.

## Gmail Import Limit

For guest mode, the import contract should be:

- hard cap: 100 messages,
- mode: travel only,
- default query: confirmation, itinerary, booking, reservation, e-ticket, hotel, flight, train, ferry,
- skip promotions before writing files,
- never mark messages read,
- never send email,
- delete OAuth refresh token on logout.

## Product UX

The mom-friendly onboarding should be a wizard:

1. `Welcome to Orbit`
2. `Sign in with Google`
3. `Connect Gmail for Travel Planning`
4. `Import up to 100 travel emails`
5. `Review Itinerary`
6. `Planning Gaps`
7. `Log out and remove my data`

## Safety Rules

- Sign out is normally just session clearing.
- For ephemeral guest users, sign out also wipes scoped local data.
- The UI must label this clearly: `Log out and wipe data`.
- Orbiter must not delete global shared folders based on ownership guesses.
- If a file is not under a scoped guest root, it should not be removed by guest logout.

## Implementation Status

Implemented:

- `guest` access role.
- `ephemeral` user metadata.
- `dataScope` user metadata.
- Access CLI flags for ephemeral users.
- Logout hook that purges scoped data for ephemeral users.
- Access UI data-mode display.
- Guest/member email read isolation.
- Google SSO.
- Gmail API OAuth.
- Guest-specific Gmail import.
- Guest-specific generated travel itinerary endpoint.

Google SSO/Gmail import is implemented as a server capability but remains unavailable in the UI until `.orbiter/google-oauth.json` or the matching environment variables are configured. See `docs/GOOGLE_SSO_GMAIL_TRAVEL.md`.

Not implemented yet:

- User creation UI.
