# Commands

Commands are mobile or local prompts intended for Orbiter/Codex review rather than normal note processing.

Any mobile capture that includes the word `COMMAND` is classified as a command and written under `commands/inbox/`. Captures that start with a slash command, such as `/itinerary`, are also commands.

Use:

```powershell
npm run commands
```

to print pending commands for review. Use:

```powershell
npm run commands -- all
```

to print every command regardless of status.

Command records should not auto-run from the HTTP server. Treat this folder as a review queue. Codex claims reviewed work with `npm run codex:next`, then marks it done or rejected with the matching `codex:*` script.

Command records may contain private prompts and should remain ignored by Git except for README files.
