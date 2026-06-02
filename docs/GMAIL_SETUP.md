# Gmail Setup

Orbiter's Gmail MVP is IMAP receive plus reviewable SMTP send.

## What You Need From Google

1. A Gmail or Google Workspace email address.
2. 2-Step Verification enabled on the Google account.
3. A Gmail app password for Orbiter.

Do not paste the app password into chat or markdown.

Official Google references:

- App passwords: https://support.google.com/mail/answer/185833
- Gmail with other email clients: https://support.google.com/mail/answer/7126229
- Gmail IMAP client settings: https://support.google.com/mail/answer/78892

## Gmail Settings

Orbiter will use these defaults:

```json
{
  "imap": {
    "host": "imap.gmail.com",
    "port": 993,
    "secure": true
  },
  "smtp": {
    "host": "smtp.gmail.com",
    "port": 465,
    "secure": true
  }
}
```

SMTP is used only after a local email draft has been approved and the user confirms send. Orbiter does not send email automatically just because a draft exists.

## Local Orbiter Setup

Create the private config file:

```powershell
npm run email:setup -- --address "your.address@gmail.com"
```

Add another Gmail account, such as a travel inbox:

```powershell
npm run email:add -- --address "travel.address@gmail.com" --label "Travel Gmail" --id "gmail-travel"
```

List configured accounts:

```powershell
npm run email:list
```

Validate it:

```powershell
npm run email:validate
```

This writes `.orbiter/email-config.json`, which is ignored by git and should stay local to this machine.

Store the Gmail app password locally:

```powershell
npm run email:secret
```

This prompts for the app password and writes `.orbiter/email-secrets.json`. On Windows, the stored password is encrypted with the current Windows user profile through PowerShell secure-string encryption.

If the terminal prompt does not accept hidden input through Codex, use the GUI prompt:

```powershell
npm run email:secret:gui
```

For a second account, pass its account id:

```powershell
npm run email:secret:gui -- --account gmail-travel
```

Test the Gmail IMAP connection:

```powershell
npm run email:test
```

Test a specific account:

```powershell
npm run email:test -- --account gmail-travel
```

Test all accounts:

```powershell
npm run email:test:all
```

Import unread Gmail messages into Orbiter:

```powershell
npm run email:ingest
```

Import important-first Gmail messages into Orbiter:

```powershell
npm run email:ingest:important
```

This searches likely important Gmail messages, scores each candidate, and imports only messages above the importance threshold. Imported markdown includes `importance_score`, `importance_label`, and `importance_reasons`.

Ingest a specific account:

```powershell
npm run email:ingest -- --account gmail-travel
```

Ingest all configured accounts:

```powershell
npm run email:ingest:all
```

Import read and unread travel confirmations from the travel account:

```powershell
npm run email:ingest:travel
```

Create, approve, and send local drafts through the Email tab. For operator-only CLI sends, use:

```powershell
npm run email:draft -- --account gmail-primary --to recipient@example.com --subject "Subject" --body "Body"
npm run email:send:test -- --account gmail-primary
npm run email:send -- --path outbox/email/drafts/<account>/<draft>.md --confirm-send SEND
```

The browser/backend send path requires `status: approved`. The CLI send path always requires `--confirm-send SEND` and can also enforce a required draft status for scheduled/operator flows.

## Folder Targets

- Incoming email markdown: `inbox/email/`
- Email attachments: `inbox/attachments/email/`
- Reviewable outbound drafts: `outbox/email/drafts/`
- Sync logs: `journal/email-sync/`
- Sent-email audit journal: `journal/email-sent/`

## Current Build Step

Orbiter now has the Gmail IMAP dry-run and ingest commands:

1. `npm run email:test` connects to Gmail and reports mailbox counts.
2. `npm run email:ingest` imports recent unread messages into `inbox/email/`.
3. `npm run email:ingest:important` imports scored important-first mail.
4. `npm run email:ingest:travel` searches the travel Gmail account for confirmation-style messages, including read mail.
5. Imported message IDs are stored in `.orbiter/email-state.json` for dedupe.
6. Sync logs are written to `journal/email-sync/`.
7. Attachments under the configured limit are copied into `inbox/attachments/email/`.
8. Approved outbound drafts can be sent through SMTP and journaled in `journal/email-sent/`.
