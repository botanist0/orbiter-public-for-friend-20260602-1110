# Commands

Orbiter separates mobile input into notes and commands.

## Rule

If an incoming mobile capture contains the word `COMMAND`, Orbiter treats it as a command. Slash commands at the start of a capture are also commands. Otherwise, the capture is a normal mobile usernote.

Examples:

```text
Buy litter after work
```

becomes a note in `usernotes/mobile/`.

```text
COMMAND summarize my mobile captures from today
```

becomes a command in `commands/inbox/`.

```text
/itinerary
```

becomes an itinerary command in `commands/inbox/` with `skill_trigger: itinerary`.

## Current Behavior

- Commands are stored as markdown with `type: command` and `status: pending`.
- In production auth mode, Codex command surfaces are admin-only. Non-admin users can capture notes and use the Travel tab's ChatGPT prompt lane, but cannot create, view, approve, claim, complete, reject, or delete Codex command records.
- Commands appear in the app's Commands view.
- The Capture tab is the single browser creation surface for admins: choose `Type: Command` to queue a Codex prompt.
- The Commands view is the queue/review/handoff board. It no longer duplicates command composition.
- `npm run commands` prints pending commands for Codex/manual review.
- `npm run codex:next` claims the oldest `reviewed` command and prints it for this Codex thread.
- Admin users can press `Preview next handoff` in the Commands view to copy the oldest reviewed handoff without changing its status.
- The Commands view includes a live Codex activity stream from `/api/codex/history`. It polls while the tab is open and shows Orbiter-owned lifecycle events, not private Codex desktop transcript messages.
- `npm run codex:done -- --path <command-path>` marks a completed handoff command done.
- `npm run itinerary` runs the local `/itinerary` workflow directly.
- Commands are included in search and graph data, but they are not regular usernotes.

## Codex Handoff

The handoff workflow is:

1. A phone or browser creates a command.
2. The command starts as `pending`.
3. The user marks it `reviewed` in the Commands view.
4. Codex runs `npm run codex:next`.
5. The script claims the oldest `reviewed` command by changing it to `running`.
6. Codex handles the printed prompt in this thread.
7. Codex runs `npm run codex:done -- --path <command-path>` after completing it.

The browser Commands tab can preview and copy the next handoff, but it intentionally does not mark a command `running`. This prevents a browser-only click from making a command look like Codex is actively working on it when no Codex thread has actually claimed the task.

If a command is already `running` but the Codex thread did not finish it, use **Return to Ready** in the Commands tab. Do not mark it done unless Codex has completed and verified the work.

This gives Orbiter a queue-to-Codex bridge without letting the HTTP server execute arbitrary commands.

## Execution Boundary

Orbiter should not auto-run arbitrary text from a phone or remote browser without a review boundary. The current MVP creates a queue that Codex can read. The next bridge can poll this queue and ask for confirmation before running the command.
