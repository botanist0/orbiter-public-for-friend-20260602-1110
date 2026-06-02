# Travel Itinerary

Orbiter can turn the dedicated travel Gmail account into a readable itinerary.

## Current MVP

1. Import travel email:

```powershell
npm run email:ingest -- --account gmail-travel
```

2. Generate itinerary artifacts:

```powershell
npm run travel:itinerary
```

Or run the full slash-command skill workflow. This uses travel-focused Gmail search so read/older Agoda and hotel confirmations are imported, not only unread mail:

```powershell
npm run itinerary
```

3. Review either:

- `knowledge/projects/travel/itinerary.md`
- Browser app `Travel` tab

## Files

- Raw travel emails: `inbox/email/gmail-travel/`
- Generated markdown: `knowledge/projects/travel/itinerary.md`
- Generated UI model: `.orbiter/travel-itinerary.json`

## Parser Behavior

The MVP parser:

- Scores travel-related email.
- Filters promotional travel-deal messages.
- Searches the travel Gmail account for read and unread confirmation-style messages.
- Recognizes Agoda/hotel/provider lodging confirmation signals.
- Classifies items as flight, transport, lodging, event, or travel.
- Shows transportation records such as train tickets, rail passes, transfers, buses, ferries, and flights in the Travel tab's Transportation panel.
- Shows a lazy-loaded Route Short panel that picks an official tourism YouTube feed from the itinerary cities and starts a muted embed when the panel enters the viewport.
- Detects planning gaps in the Travel tab:
  - missing hotel nights between confirmed stays,
  - overlapping stays in different cities,
  - city-to-city moves without an imported transportation confirmation.
- Classifies planning gaps before handoff:
  - `key-gap` for missing hotel nights and international flight moves,
  - `transport-plan` for meaningful rail/bus planning that still has local fallback options,
  - `local-transit` for routine regional moves such as Kyoto to Osaka,
  - `data-discrepancy` when an overlap might be a backup booking, duplicate, or parser location issue.
- Recognizes Shojo Shin-in as Koyasan/Wakayama lodging before Kyoto rules, so Koyasan side trips do not get mislabeled as Kyoto stays.
- Each gap can be queued into the Commands tab for review, then approved for Codex handoff for rail, bus, flight/ferry, or hotel follow-up planning.
- Each gap can also copy a ChatGPT-ready research prompt and open `https://chatgpt.com/` for manual research using the user's ChatGPT subscription account.
- Extracts likely dates with deterministic rules plus `chrono-node`.
- Preserves source email paths and useful snippets for review.

## Research Handoff

Orbiter's travel-agent workflow should prefer Codex or the user's ChatGPT web subscription for live research before adding a paid search API.

The Travel tab uses two research lanes:

- `Codex Research` creates a pending command in `commands/inbox/` with the gap, evidence, safety instructions, and itinerary context. This is admin-only in production auth mode. The admin reviews it in the Commands tab before Codex claims it.
- `ChatGPT Prompt` copies the same research prompt to the clipboard and opens ChatGPT in a new browser tab. Non-admin household users may use this lane because it does not create a Codex command or execute code.

This keeps research powerful without giving Orbiter a direct browser-scraping or purchase-execution permission. Orbiter should recommend official booking pages first, reputable backup booking pages second, and never claim a ticket or hotel is booked until a confirmation email is imported and parsed.

The current ChatGPT lane is intentionally manual. ChatGPT web subscriptions and OpenAI API billing are separate products, so Orbiter should not assume the subscription can be called programmatically through the API.

## Travel Gap Email Drip

When Codex researches a batch of travel gaps for Household Member, Orbiter can stage each email as a draft and send one per heartbeat instead of sending a burst.

Files:

- Staged email bodies: `outbox/email/bodies/travel-gap-drip/`
- Draft records: `outbox/email/drafts/gmail-primary/`
- Drip queue: `outbox/email/drip/travel-planning-gaps.json`

Commands:

```powershell
npm run email:drip:status
npm run email:drip:next
```

`email:drip:next` sends exactly one ready draft, journals the sent email, and only marks the paired Codex command done after the SMTP send succeeds.

## Next Improvements

- Add explicit provider parsers for airlines, hotels, ticket vendors, and calendar attachments.
- Add a correction file so manual edits survive regeneration.
- Add "needs review" flags for uncertain dates or locations.
- Add calendar export after the itinerary data model stabilizes.
- Store Codex/ChatGPT research results as reviewable markdown under `knowledge/projects/travel/research/`.
