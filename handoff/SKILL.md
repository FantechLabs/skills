---
name: handoff
version: 1.0.0
description: Use when creating a compact handoff document so another agent can resume the current conversation or project work.
argument-hint: "What will the next session be used for?"
---

Write a compact handoff for the next agent.

Save it under `~/.agents/handoff/<project-name>/` as `YYYY-MM-DD-HHMM-<project>-<focus-slug>.md`. Build `<focus-slug>` from the user's requested next focus, issue/PR key, branch name, or current objective. Do not use timestamp-only or generic names.

Include only:
- current objective and status
- repo, branch, and relevant paths/URLs
- blockers, decisions, and next steps
- suggested skills

Reference existing artifacts instead of duplicating them. Redact secrets and sensitive personal data.
