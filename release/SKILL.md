---
name: release
description: Release packages by running changeset version, creating git tags, and GitHub releases. Use after merging PRs with changesets, when ready to release, or when asked about versioning/publishing.
---

# Release

Consume changesets, bump versions, create tags, and publish GitHub releases.

## Quick Start

```bash
# Interactive (human)
pnpm release

# Non-interactive (agent)
pnpm release --ci

# Analyze only
pnpm release --dry-run
```

## When to Use

After merging PRs that contain changesets:

1. PRs merged to main (with `.changeset/*.md` files)
2. Run release skill
3. Packages versioned, tagged, and released

## Commands

```bash
# Interactive - prompts for confirmation
pnpm release

# Non-interactive - uses defaults
pnpm release --ci

# Analyze only (what would be released)
pnpm release --dry-run

# Skip GitHub release creation
pnpm release --ci --skip-github

# Skip pushing (local only)
pnpm release --ci --no-push
```

## Dry Run Output

```json
{
  "prereleaseMode": null,
  "pendingChangesets": ["PROD-123.md", "PROD-456.md"],
  "packagesToRelease": [
    {
      "name": "@scope/ui",
      "currentVersion": "1.2.3",
      "newVersion": "1.3.0",
      "bump": "minor",
      "changelogEntry": "Added button loading state...",
      "tag": "@scope/ui@1.3.0",
      "githubRelease": {
        "tag": "@scope/ui@1.3.0",
        "title": "@scope/ui v1.3.0",
        "prerelease": false
      }
    }
  ],
  "commitMessage": "chore(release): version packages"
}
```

Key fields for agent:
- `prereleaseMode`: Current mode (null, "alpha", "beta", "rc")
- `packagesToRelease`: Packages with pending changes
- `changelogEntry`: Content for GitHub release body

## Prerelease Mode

Prerelease mode is managed by the changeset skill:

```bash
pnpm changeset:pre enter alpha   # Enter prerelease
pnpm changeset:pre exit          # Exit prerelease
pnpm changeset:pre status        # Check current mode
```

The release skill detects and respects current prerelease mode. Versions will be `X.Y.Z-alpha.N` format when in prerelease.

## GitHub Releases

Each package gets its own release:

- **Tag**: `@scope/ui@1.3.0`
- **Title**: `@scope/ui v1.3.0`
- **Body**: Package's CHANGELOG entry + Linear links
- **Prerelease flag**: Set if version contains alpha/beta/rc

## Agent Delegation

| Task | Delegate? | Rationale |
|------|-----------|-----------|
| Run `--dry-run` analysis | ✅ | Script execution |
| Parse JSON output | ✅ | Data extraction |
| Confirm release proceed | ❌ | User decision |
| Run release | ✅ | Script execution |
| Craft release description | ❌ | May need enhancement |
| Create GitHub releases | ✅ | gh CLI execution |
| Report results | ✅ | Simple output |

## Process (Agent)

1. **[delegate]** Run `pnpm release --dry-run` → get JSON
2. Review packages to release and versions
3. Confirm with user if significant changes
4. **[delegate]** Run `pnpm release --ci`
5. Script creates: versions → commit → tags → push → GitHub releases
6. Report success with release links
7. Suggest Slack posting if needed

## Process (Human)

1. Run `pnpm release`
2. See pending changesets and proposed versions
3. Confirm or abort
4. Script executes full workflow
5. GitHub releases created
6. Done

## Workflow Steps

The release script executes:

1. **Version**: `pnpm changeset version`
   - Consumes `.changeset/*.md` files
   - Bumps package.json versions
   - Updates CHANGELOG.md per package

2. **Install**: `pnpm install`
   - Updates lockfile for new versions

3. **Commit**: `git commit`
   - Message: `chore(release): version packages`

4. **Tag**: Create git tags
   - Format: `@scope/package@version`

5. **Push**: `git push --follow-tags`

6. **GitHub Release**: `gh release create`
   - Per-package releases
   - Body from CHANGELOG entry

## Post-Release

After successful release:

```
✅ Release complete!

Released packages:
  • @scope/ui@1.3.0
  • @scope/utils@2.0.1

GitHub releases created:
  • https://github.com/org/repo/releases/tag/@scope/ui@1.3.0
  • https://github.com/org/repo/releases/tag/@scope/utils@2.0.1

💡 To post release notes to Slack, run: /slack-release
```

## Setup

### Package.json Scripts

```json
{
  "scripts": {
    "release": "bun scripts/release/release.ts",
    "release:dry": "bun scripts/release/release.ts --dry-run"
  }
}
```

### Dependencies

Requires `gh` CLI authenticated:

```bash
gh auth status
```

### CI Usage

```yaml
# .github/workflows/release.yml
name: Release
on:
  workflow_dispatch:

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun release --ci
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```
