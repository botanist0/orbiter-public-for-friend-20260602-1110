# Orbiter Agent Guide

This workspace is for building a simpler local-first second brain.

## Product Direction

Orbiter should feel understandable to non-technical users. Prefer plain files, visible workflows, and small concepts over hidden automation. The system should help a user capture information, decide where it belongs, connect it to existing knowledge, and review it later.

## Working Rules

- Keep durable knowledge in markdown.
- Keep skills in `skills/<skill-name>/SKILL.md`.
- Keep private user data out of source commits unless explicitly requested.
- Add dependencies only when they solve a real product need.
- Prefer small, reversible changes.

## Folder Semantics

- `inbox/` is for unprocessed captures.
- `usernotes/` is for user-written ad hoc notes that need to be processed into proper notes.
- `commands/` is for prompts and skill requests that should be reviewed before Orbiter/Codex acts.
- `commands/inbox/` is for mobile commands with `status: pending`.
- `issues-journal/` is for engineering-style issue records whenever Orbiter catches a problem.
- `knowledge/projects/` is for active outcomes with an end state.
- `knowledge/areas/` is for ongoing responsibilities.
- `knowledge/resources/` is for reference material.
- `knowledge/decisions/` is for architecture, product, and workflow decisions with tradeoffs.
- `knowledge/archive/` is for inactive material.
- `journal/` is for dated notes, reviews, and decisions.
