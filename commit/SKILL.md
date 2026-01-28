---
name: commit
description: Create git commits following conventional commits. Adapts to monorepos (scoped per package) and single-package projects. Use when committing changes, creating commit messages, or asking about commit conventions.
---

# Commit

Create commits following Conventional Commits, adapting to project structure.

## Format

```
type(scope): <emoji> description

[body]

[footer]
```

- Header max 100 chars
- Present tense, imperative mood ("add" not "added")

## Types & Emoji

| Type | Emoji | Use for |
|------|-------|---------|
| `feat` | ✨ | New feature |
| `fix` | 🐛 | Bug fix |
| `refactor` | ♻️ | Code change (no behavior change) |
| `chore` | 🔧 | Maintenance, deps, tooling |
| `docs` | 📝 | Documentation |
| `test` | ✅ | Tests |
| `perf` | ⚡ | Performance |
| `ci` | 👷 | CI/CD |
| `build` | 📦 | Build system |
| `revert` | ⏪ | Revert a commit |
| `style` | 💄 | Formatting, styling |

## Detect Project Type

Check for monorepo indicators:

| File | Tool |
|------|------|
| `turbo.json` | Turborepo |
| `pnpm-workspace.yaml` | pnpm workspaces |
| `package.json` with `workspaces` | bun workspaces |

If found → **Monorepo workflow**. Otherwise → **Single-package workflow**.

---

## Monorepo Workflow

### Directory Conventions

| Directory | Purpose | Example Scope |
|-----------|---------|---------------|
| `apps/*` | Deployables | `web`, `server`, `api` |
| `packages/*` | Internal packages/libraries | `ui`, `utils`, `sdk` |
| `tooling/*` | Shared config (tsconfig, eslint) | `tsconfig`, `eslint` |

Scope = directory name of the changed package.

Root changes (turbo.json, root package.json, etc.) → scope: `repo`

### Multi-Package Changes

**Create separate commits per package:**
- Enables per-package changelogs
- Clean git bisect
- Proper changeset attribution

### Examples

```bash
git commit -m "feat(web): ✨ add dark mode toggle"
git commit -m "fix(ui): 🐛 correct button focus ring color"
git commit -m "chore(tsconfig): 🔧 enable strict null checks"
git commit -m "chore(repo): 🔧 update turbo pipeline"
```

---

## Single-Package Workflow

### Scopes

Scope is **optional**. Use to clarify affected area:

```bash
git commit -m "fix: 🐛 prevent duplicate form submission"
git commit -m "feat(auth): ✨ add password reset flow"
git commit -m "chore(deps): 🔧 bump next to 15.1"
```

---

## Atomic Commits

Each commit should be a single logical unit that:
- Groups related changes together
- Is easy to roll back independently
- Compiles/runs successfully on its own

If many files changed, break into smaller logical commits:

```bash
# Bad: one massive commit
git commit -m "feat(web): ✨ add user settings"  # 47 files

# Good: logical units
git commit -m "feat(web): ✨ add settings page layout"
git commit -m "feat(web): ✨ add profile settings form"
git commit -m "feat(web): ✨ add notification preferences"
git commit -m "test(web): ✅ add settings page tests"
```

---

## Pre-Commit Checks

### Verification

Run quick checks before committing:

```bash
# Monorepo - check affected packages
turbo check --filter=[HEAD^1]

# Or at minimum
pnpm typecheck && pnpm lint
```

### Escape Hatch

If you must commit code that fails checks (e.g., WIP for handoff, debugging):

```bash
git commit -m "feat(web): 🚧 [WIP] auth flow - fails typecheck

Known issues:
- Missing return type on handleAuth
- Unused import on line 23

Committing to hand off to @teammate"
```

Use 🚧 and `[WIP]` marker. Keep the real type (`feat`, `fix`, etc.) for accurate changelogs.

### Sensitive Data Check

**Before every commit**, scan staged changes for:
- API keys, tokens, secrets
- Passwords, credentials
- Private keys, certificates
- Connection strings
- `.env` values hardcoded

```bash
git diff --cached  # Review carefully
```

Patterns to watch for:
```
password=, secret=, api_key=, token=
-----BEGIN (RSA|OPENSSH|PGP) PRIVATE KEY-----
sk_live_, pk_live_, ghp_, AKIA
mongodb://, postgres://, mysql:// (with credentials)
```

If found: `git reset HEAD <file>` and extract to environment variables.

---

## Never Commit

- `.env` files or secrets
- `node_modules/`, `.turbo/`, build outputs
- Large binaries or media files
- IDE settings (`.idea/`, `.vscode/` unless shared)

If accidentally staged:
```bash
git reset HEAD <file>
```

---

## Partial Staging

When changes include unrelated work, stage selectively:

```bash
git add src/auth/login.ts src/auth/logout.ts  # specific files
git add -p                                      # interactive hunks
```

Never blindly `git add .` — review what's being staged.

---

## Commit Body

Skip for self-explanatory changes. Add when:
- Change isn't obvious from diff
- There's context reviewers need
- You chose between alternatives

```bash
git commit -m "$(cat <<'EOF'
feat(web): ✨ add retry logic to API client

- Exponential backoff prevents thundering herd
- Max 3 retries before surfacing error
- Chose fetch over axios for smaller bundle

PROD-123
EOF
)"
```

Explain **why**, not what (diff shows what).

---

## Amending vs New Commits

**Safe to amend**: Local commits not yet pushed
```bash
git commit --amend -m "feat(web): ✨ corrected message"
```

**Don't amend**: Already pushed commits (rewrites shared history)

**After PR feedback**: Create new commits — keeps review context. Squash on merge.

---

## Linear Issue Reference

Branch format: `username/PROJ-123-issue-title`

Extract issue key and add as footer:

```
feat(web): ✨ add OAuth login

PROD-123
```

---

## Hotfix Branches

On `hotfix/*` branches:
- Only `fix`, `chore`, `docs`, `test`
- No `feat`, no breaking changes

---

## Breaking Changes

Add `!` after scope and `BREAKING CHANGE:` in body:

```
feat(api)!: 💥 change auth response format

BREAKING CHANGE: Token now in `data.token` instead of `token`
```

---

## Agent Delegation

When the harness supports sub-agents, delegate to faster/smaller models for:

| Task | Delegate? | Rationale |
|------|-----------|-----------|
| `git status`, `git diff` | ✅ | Simple command output |
| Scanning for secrets | ✅ | Pattern matching |
| Running typecheck/lint | ✅ | Command execution |
| Analyzing change scope | ✅ | File categorization |
| Drafting commit message | ❌ | Needs full context |
| Deciding commit boundaries | ❌ | Requires judgment |

Example delegation pattern:
1. Sub-agent: Run `git diff --cached --stat`, categorize files by package
2. Sub-agent: Scan diff for secret patterns, report findings
3. Sub-agent: Run `turbo check --filter=[HEAD^1]`, report pass/fail
4. Main agent: Review results, plan commits, draft messages

---

## Process Summary

1. Detect project type (monorepo indicators)
2. **[delegate]** `git status -s` — review changes
3. **[delegate]** `git diff --cached` — analyze staged, scan for secrets
4. **[delegate]** Run pre-commit checks (typecheck, lint)
5. Plan atomic commits — group related changes logically
6. **Monorepo**: Separate commits per package
7. Determine type → emoji, scope from location
8. Write concise description
9. Add body if non-obvious, include Linear issue
10. Commit
