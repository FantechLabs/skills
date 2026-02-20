---
name: pr
description: Create pull requests with practical preflight checks, branch-scoped changeset validation, issue linking, and reviewer suggestions for GitHub/GitLab.
---

# PR

Create pull requests or merge requests using deterministic analysis and platform-specific creation commands.

## Quick Start

```bash
# Interactive
bun pr/scripts/create.ts

# CI or agent mode
bun pr/scripts/create.ts --ci --title "PROD-123 | Add feature" --target main

# Analyze only
bun pr/scripts/create.ts --dry-run
```

## Title Format

| Branch Type | Title Format | Example |
|---|---|---|
| Feature (`username/PROJ-123-*`) | `PROJ-123 | Inferred title` | `PROD-4132 | Add email notifications` |
| Release (`release/v*`) | `Release vX.Y.Z | Summary` | `Release v3.1.4 | Email notifications and data improvements` |
| Hotfix (`hotfix/v*`) | `Hotfix vX.Y.Z | Summary` | `Hotfix v3.1.5 | Fix auth token expiry` |
| Generic | `Inferred title` | `Update CI pipeline configuration` |

## Description Strategy

- With CodeRabbit: minimal summary placeholder.
- Without CodeRabbit: Summary, Changes, Test Plan, Checklist.

## Changeset Validation

In monorepos with changesets configured, validation checks branch-local `.changeset/*.md` changes (diff against target branch):
- changeset found -> ready PR allowed
- no changeset -> prompt to run changeset skill or continue as draft

## Reviewer Suggestions

- CODEOWNERS suggestions are selectable for direct assignment.
- Git-history suggestions are advisory only (manual check), because git author names are not guaranteed GitHub or GitLab usernames.

## Preflight Behavior

Before creation, the script validates:
- inside a git repo,
- supported platform (GitHub or GitLab),
- required CLI authenticated (`gh` or `glab`),
- non-empty commit range versus target.

## Agent Process

1. Run `bun pr/scripts/create.ts --dry-run`
2. Review analysis and warnings
3. Resolve missing changeset if required
4. Craft final title and body with project context
5. Confirm reviewers and draft status
6. Run create command in `--ci` mode with explicit flags
7. Return created PR or MR URL
