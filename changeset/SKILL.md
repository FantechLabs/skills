---
name: changeset
description: Generate changesets from commits for monorepo versioning. Use after committing changes, when preparing a PR, or when asked about changesets/versioning. Analyzes commits, confirms bump types, and generates .changeset/*.md files.
---

# Changeset

Generate changeset files from conventional commits for independent package versioning.

## Quick Start

```bash
# Interactive (human)
pnpm changeset:create

# Non-interactive (agent)
pnpm changeset:create --ci
```

## When to Use

After committing changes, before push/PR:

1. Commit changes (commit skill)
2. Run changeset script
3. Push (includes changeset file)
4. CI validates changeset exists

## Commands

### Create Changeset

```bash
# Interactive - prompts for confirmation
pnpm changeset:create

# Non-interactive - uses code-transformed summaries
pnpm changeset:create --ci

# Override specific bumps
pnpm changeset:create --ci --bump ui:minor,utils:patch

# Override summaries (agent passes polished text here)
pnpm changeset:create --ci --summary "ui:Added button loading with focus improvements"

# Force bullet format
pnpm changeset:create --ci --bullets

# Force collapsed format
pnpm changeset:create --ci --collapsed

# Analyze only (returns JSON, no file created)
pnpm changeset:create --dry-run
```

### Validate (CI)

```bash
# Exits non-zero if no changeset found
pnpm changeset:validate
```

### Empty Changeset

For PRs with no user-facing changes:

```bash
pnpm changeset --empty
```

### Prerelease Mode

Manage prerelease versions (alpha, beta, rc):

```bash
# Enter prerelease mode
pnpm changeset:pre enter alpha

# Check current status
pnpm changeset:pre status

# Exit prerelease mode
pnpm changeset:pre exit
```

When in prerelease mode:
- All versions become `X.Y.Z-alpha.N` format
- Changesets are tracked in `.changeset/pre.json`
- Exit prerelease mode before releasing stable versions

Valid prerelease tags: `alpha`, `beta`, `rc`, `next`, `canary`

## Dry Run Output

The `--dry-run` flag outputs JSON for agent analysis:

```json
{
  "branch": "uzee/PROD-123-add-button-loading",
  "issueKey": "PROD-123",
  "packages": [
    {
      "name": "@scope/ui",
      "path": "packages/ui",
      "currentVersion": "1.2.3",
      "suggestedBump": "minor",
      "reason": "feat commit detected",
      "commits": [
        "feat(ui): ✨ add button loading state",
        "fix(ui): 🐛 correct focus ring color"
      ],
      "codeTransform": "Added button loading state; Fixed focus ring color",
      "suggestedFormat": "collapsed"
    }
  ],
  "changesetFile": "PROD-123.md",
  "noChangesetNeeded": false
}
```

Key fields for agent:
- `codeTransform`: Base summary to polish
- `suggestedBump`: Recommended version bump
- `suggestedFormat`: `collapsed` or `bullets` based on commit relatedness

## Bump Type Rules

Derived from commit types:

| Commit Type | Bump |
|-------------|------|
| `feat` | minor |
| `fix`, `perf`, `refactor` | patch |
| `feat!`, `fix!` (breaking) | major |
| `chore`, `docs`, `test`, `ci`, `build`, `style` | none (skip) |

Multiple commits → highest bump wins: `major > minor > patch`

## Summary Transformation

The script performs **pure code transformation** (zero LLM tokens):

```
"feat(ui): ✨ add button loading state" → "Added button loading state"
"fix(ui): 🐛 correct focus ring color"  → "Fixed focus ring color"
```

Multiple commits joined: `"Added button loading state; Fixed focus ring color"`

### Human Mode (Interactive)

Script shows code-transformed summary, human edits if needed:

```
Suggested summary: Added button loading state; Fixed focus ring color

? Edit summary (or press enter to accept):
```

### Agent Mode

The **agent itself** polishes the summary (not the script):

1. **[delegate]** Run `--dry-run` → get `codeTransform` from JSON
2. **[main agent]** Polish the summary (~50-100 tokens):
   ```
   Input:  "Added button loading state; Fixed focus ring color; Updated disabled styles"
   Output: "Added button loading state with improved focus ring and disabled styles"
   ```
3. **[delegate]** Run `--ci --summary "ui:Added button loading state with improved focus ring and disabled styles"`

This approach:
- Keeps scripts fast and deterministic (zero LLM tokens)
- Leverages the agent's existing capabilities for polishing
- Allows full control over the final summary

## Summary Format

### Collapsed (Default)

For related commits (single feature/fix):

```markdown
Added button loading state with corrected focus ring and disabled state handling
```

### Bullets

For unrelated commits in same branch:

```markdown
- Added button loading state
- Fixed tooltip z-index issue
- Fixed expired token handling
```

### Format Selection

| Mode | Selection |
|------|-----------|
| Human | Collapsed default, edit if needed |
| Agent | Analyzes commit relatedness, chooses format |
| `--bullets` | Forces bullet format |
| `--collapsed` | Forces collapsed format |

### Agent Format Analysis

Before running script, agent examines commits:

- Related commits (same feature area) → `--collapsed`
- Unrelated commits (multiple distinct fixes) → `--bullets`
- Mixed → `--bullets` with grouping

## Changeset File Structure

One file per branch, named after issue key (uppercase):

`.changeset/PROD-123.md`:

```markdown
---
'@scope/ui': minor
'@scope/utils': patch
---

**@scope/ui**
Added button loading state with corrected focus ring and disabled state handling

**@scope/utils**
Fixed debounce race condition

PROD-123
```

Each package gets its own summary filtered by commit scope.

At release, `changeset version` distributes entries to per-package CHANGELOGs.

## Changelog Distribution

Each package maintains its own CHANGELOG.md:

```
packages/ui/CHANGELOG.md
packages/utils/CHANGELOG.md
apps/web/CHANGELOG.md
```

At release time:
- `changeset version` updates each package's CHANGELOG.md
- GitHub Release combines all changes with Linear links

## No User-Facing Changes

When all commits are internal (`chore`, `docs`, `test`, `ci`, `build`, `style`):

| Mode | Behavior |
|------|----------|
| Interactive | Prompts: "Create empty changeset?" |
| `--ci` | Creates empty changeset |
| `--ci --skip-empty` | Skips, exits 0 |

## Agent Delegation

| Task | Delegate? | Rationale |
|------|-----------|-----------|
| Run `--dry-run` analysis | ✅ | Script execution |
| Parse JSON output | ✅ | Data extraction |
| Analyze commit relatedness | ✅ | Pattern matching |
| Decide bump overrides | ❌ | Requires judgment |
| Polish summaries | ❌ | Main agent (~50-100 tokens) |
| Run final creation | ✅ | Script execution |
| Verify file created | ✅ | Simple file check |

## Process (Agent)

1. **[delegate]** Run `pnpm changeset:create --dry-run` → get JSON analysis
2. Parse JSON output:
   - Extract `codeTransform` for each package
   - Note `suggestedBump` and `suggestedFormat`
3. **[delegate]** Analyze commits for relatedness → decide `--collapsed` or `--bullets`
4. Review suggested bumps — override if needed
5. **[main agent]** Polish each package's `codeTransform` summary:
   - Combine related items naturally
   - Remove redundancy
   - Keep concise (1-2 sentences max)
   - Preserve technical accuracy
6. **[delegate]** Run script with polished summaries:
   ```bash
   pnpm changeset:create --ci \
     --bump ui:minor,utils:patch \
     --summary "ui:Added button loading with improved focus handling" \
     --bullets
   ```
7. **[delegate]** Verify `.changeset/*.md` created

## Process (Human)

1. Run `pnpm changeset:create`
2. For each affected package:
   - Review suggested bump → confirm or change
   - Review summary → edit if needed
3. Changeset file created
4. Commit and push

## Runtime Detection

Scripts detect package manager and runtime:

```bash
# If bun.lockb exists
bun scripts/changeset/create.ts

# Otherwise
pnpm tsx scripts/changeset/create.ts
```

## Setup

### Package.json Scripts

```json
{
  "scripts": {
    "changeset:create": "bun scripts/changeset/create.ts",
    "changeset:validate": "bun scripts/changeset/validate.ts",
    "changeset:pre": "bun scripts/changeset/prerelease.ts"
  }
}
```

### CI Validation

```yaml
# .github/workflows/changeset-check.yml
name: Changeset Check
on: [pull_request]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun changeset:validate
```

### Dependencies

```json
{
  "devDependencies": {
    "@changesets/cli": "^2.27.0",
    "@clack/prompts": "^0.7.0"
  }
}
```

### Changeset Config

`.changeset/config.json`:

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.1.2/schema.json",
  "changelog": ["@changesets/changelog-github", { "repo": "org/repo" }],
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "restricted",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "privatePackages": {
    "version": true,
    "tag": true
  }
}
```

### Custom Changelog with Linear Links

For Linear issue linking in changelogs, create `.changeset/changelog-config.js`:

```javascript
const getLinearLink = (issueKey) =>
  `https://linear.app/YOUR_WORKSPACE/issue/${issueKey}`;

module.exports = {
  getReleaseLine: async (changeset) => {
    const issueMatch = changeset.summary.match(/([A-Z]+-\d+)/);
    const issueLink = issueMatch
      ? ` ([${issueMatch[1]}](${getLinearLink(issueMatch[1])}))`
      : '';
    return `- ${changeset.summary}${issueLink}`;
  },
  getDependencyReleaseLine: async () => '',
};
```

Then update config.json:

```json
{
  "changelog": "./.changeset/changelog-config.js"
}
```
