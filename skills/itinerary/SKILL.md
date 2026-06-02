---
name: itinerary
description: Import travel Gmail and generate Orbiter's travel itinerary.
slash: /itinerary
---

# Itinerary Skill

Use this when the user asks Orbiter to refresh travel plans from the travel Gmail account, especially through `/itinerary`.

## Trigger

- `/itinerary`
- `COMMAND /itinerary`
- "refresh my travel itinerary"
- "import travel email"

## Workflow

1. Import new travel Gmail messages from the `gmail-travel` account.
2. Generate the itinerary artifacts from imported travel email.
3. Confirm how many itinerary items were generated.
4. Point the user to the Travel tab and `knowledge/projects/travel/itinerary.md`.

## Command

Run:

```powershell
npm run itinerary
```

## Output

Update:

- `inbox/email/gmail-travel/`
- `knowledge/projects/travel/itinerary.md`
- `.orbiter/travel-itinerary.json`

## Rules

- Keep raw imported emails unchanged.
- Do not send email.
- Treat uncertain event dates as needing review instead of guessing.
