# Email Integration Design

Email is a current integration layer after mobile capture. The first provider is Gmail, with IMAP receive plus reviewable SMTP send. The design should stay provider-neutral enough to add other SMTP/IMAP accounts later.

## Goals

- Receive email into Orbiter notes.
- Create outbound email drafts without sending automatically.
- Send only approved drafts with explicit confirmation.
- Preserve local markdown as the source of truth.
- Keep credentials outside markdown.
- Avoid accidental sending.

## Current Capability

- Provider: Gmail.
- Receive: enabled through IMAP.
- Send: draft -> approve -> explicit send through SMTP.
- Audit: successful sends are journaled under `journal/email-sent/`.
- Setup details: `docs/GMAIL_SETUP.md`.

## Subsystems

### 1. Email Account Configuration

Store account settings in `.orbiter/email-config.json`:

- provider label
- IMAP host, port, TLS setting
- SMTP host, port, TLS setting
- username
- credential reference, not raw password in notes
- polling interval
- target folders or labels

Credentials should be stored through Windows Credential Manager or an encrypted local file, not committed markdown.

Run `npm run email:setup -- --address "your.address@gmail.com"` to create the private config file.
Run `npm run email:add -- --address "travel.address@gmail.com" --label "Travel Gmail" --id "gmail-travel"` to add another Gmail account.
Run `npm run email:list` to list configured account ids.
Run `npm run email:validate` to validate it.
Run `npm run email:draft -- --account gmail-primary --to recipient@example.com --subject "Subject" --body "Body"` to create a local draft from the configured primary sender.
Run `npm run email:send:test -- --account gmail-primary` to verify SMTP auth without sending.

### 2. IMAP Ingest Worker

A local ingest command now exists as `npm run email:ingest`. It should evolve into a worker later.

- connect to IMAP
- fetch unread or labeled messages
- deduplicate by message ID
- write messages into `inbox/email/`
- preserve sender, recipients, subject, date, message ID, and attachments
- create attachment folders under `inbox/attachments/email/`
- score message importance with deterministic reasons before heavier ML exists

Connection test: `npm run email:test`, or `npm run email:test:all`.
Credential setup: `npm run email:secret:gui -- --account <account-id>`.
Important-first ingest: `npm run email:ingest:important`.

### 3. Email Note Format

Each imported email should become markdown:

```markdown
---
title: Email subject
type: email
from:
to:
message_id:
received:
source: imap
status: unread
importance_score:
importance_label:
importance_reasons:
---

## Body

...

## Attachments

- ...
```

### 4. SMTP Send Pipeline

Orbiter supports draft creation through the Email tab and CLI. Draft creation writes markdown under `outbox/email/drafts/<account>/` and does not connect to SMTP.

Browser send flow:

1. Create a draft in the Email tab.
2. Review the draft card in the Email tab.
3. Click **Approve Draft**. Orbiter changes frontmatter from `status: draft` to `status: approved`.
4. Click **Send Approved** and confirm the browser warning.
5. The backend refuses to send unless the markdown is `type: email-draft`, lives under `outbox/email/drafts/`, and has `status: approved`.
6. On success, the send pipeline marks the draft `status: sent` and writes an audit note to `journal/email-sent/`.

An operator-only send command exists for explicitly approved one-time sends:

```powershell
npm run email:send -- --path outbox/email/drafts/<account>/<draft>.md --confirm-send SEND --require-local-hour 6
```

Do not schedule or run this for token-bearing emails until the user has explicitly approved transmitting the token by email after the risk is stated.

Sending must always remain explicit. Orbiter should not send a draft only because it exists or because it was imported from a command.

### 5. UI Views

Build:

- Email Inbox view
- Email Drafts view, including the current compose form for `gmail-primary`
- Importance filters based on `importance_score`, `importance_label`, and `importance_reasons`
- Approved-draft send controls with browser confirmation
- Sync status and error display
- Attachment list

### 6. Safety And Logging

Current and required safety controls:

- `issues-journal/` entries for failed sync/send
- `journal/email-sync/` logs
- duplicate detection
- outbound send confirmation
- SMTP test mode before real sends
- sent-email journal records

Future controls:

- rate limits
- broader dry-run modes

## Open Decisions

- Whether to keep PowerShell/Windows secure-string local storage or move to Windows Credential Manager.
- Whether polling is enough or a persistent worker is needed.
- Whether attachments should continue to be copied into Orbiter or linked externally.

## Travel Email Consumer

The `gmail-travel` account is now a domain-specific source for itinerary generation.

Flow:

1. `npm run email:ingest:travel`
2. `npm run travel:itinerary`
3. Review `knowledge/projects/travel/itinerary.md` or the browser Travel tab.

The generator writes the UI model to `.orbiter/travel-itinerary.json` and keeps raw imported emails in `inbox/email/gmail-travel/`. The travel ingest mode searches read and unread mail for confirmation-style messages from Agoda, hotels, airlines, and ticket vendors. During ingest, Orbiter ignores travel marketing such as price-drop newsletters, welcome gifts, birthday-sale promos, personalized-deal campaigns, and survey nudges unless the message also has a strong transactional signal such as a booking ID, confirmation, voucher, receipt, e-ticket, or reservation purchase.

## Travel Gap Email Drip

Travel research summaries can be staged as approved drafts and sent one at a time through:

```powershell
npm run email:drip:status
npm run email:drip:next
```

The drip script sends exactly one ready draft per run and only marks the paired Codex command done after SMTP succeeds.
