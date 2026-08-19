---
name: pick-up
version: 1.0.0
description: Use when resuming from a handoff document, picking up a previous agent session, or continuing work another agent handed off.
argument-hint: "Path to handoff document or what to pick up"
---

Pick up from a handoff without trusting stale context.

1. Determine the handoff file path only.
   - Use the user-provided path when present.
   - Otherwise infer the project name from the repo/workspace basename and search `~/.agents/handoff/<project-name>/`, then `~/.agents/handoff/`.
   - Match filename words against the user's request/context before using recency.
   - If multiple candidates still remain, choose the newest timestamped file or newest mtime.

2. Confirm before reading.
   - Show the selected filename/path and ask the user to confirm unless they explicitly asked to proceed without confirmation.
   - Do not read or load the file before confirmation.

3. After confirmation, read and verify.
   - Capture objective, branch/status, blockers, suggested skills, relevant paths/URLs, and next steps.
   - Check cwd, git status, latest commits, and referenced files before acting.
   - Treat the user's newest message as authoritative over the handoff.

4. Continue.
   - Start with a brief pickup summary: source document, current state, next action.
   - Invoke suggested skills when they apply.
   - Keep sensitive data redacted.
