# @fantechlabs/skills

Shared agent skills and a CLI for installing and running them.

## Bundled Skills

| Skill | Type | Use it for | Common commands |
|---|---|---|---|
| `changeset` | Runnable | Generate and validate Changesets files from conventional commits. Also helps with prerelease mode. | `skills changeset`, `skills changeset validate`, `skills changeset prerelease` |
| `claude-workflow` | Runnable | Launch a Claude Code dynamic multi-agent workflow (explore/build) headlessly via `claude -p` — usable from any harness, not just Claude Code. | `skills claude-workflow start --mode explore --prompt task.md`, `skills claude-workflow status <run>`, `skills claude-workflow result <run>` |
| `commit` | Runnable | Create conventional commits with the right type, emoji, scope, body, and safety checks. | `skills commit`, `skills commit --help` |
| `handoff` | Docs only | Write compact handoff notes so another agent can resume the same work later. | Install and invoke as an agent skill. |
| `pick-up` | Docs only | Resume from a handoff document without trusting stale context. | Install and invoke as an agent skill. |
| `pr` | Runnable | Analyze a branch and create a GitHub PR or GitLab MR with title, body, changeset checks, and reviewer suggestions. | `skills pr --dry-run`, `skills pr --ci --title "..."` |
| `release` | Runnable | Consume Changesets, version packages, create tags, and create GitHub releases. | `skills release --dry-run`, `skills release --ci` |
| `review` | Docs only | Fetch, triage, and address PR/MR review feedback. | Install and invoke as an agent skill. |

Runnable skills include scripts under `skills/<skill>/scripts/` in this repository and can be executed through this package's `skills` CLI. Docs-only skills are agent instructions without a CLI script. `claude-workflow` additionally requires the Claude Code CLI (`claude`) on PATH, authenticated.

## Requirements

- Node.js `>=20.10.0`.
- `bun`, `npm`, or `pnpm` in projects where installed skill scripts need dependencies.
- `git` for commit, changeset, PR, release, and review workflows.
- `gh` for GitHub PR/release automation, or `glab` for GitLab MR automation.
- `ruler` is optional and only needed when installing through `.ruler/skills` and applying Ruler-managed agent config.

## Project CLI (`@fantechlabs/skills`)

Run directly without a global install:

```bash
npx @fantechlabs/skills --help
bunx @fantechlabs/skills --help
```

Common usage:

```bash
npx @fantechlabs/skills list
npx @fantechlabs/skills install commit --yes
npx @fantechlabs/skills install commit --yes --agent claude
npx @fantechlabs/skills install commit --yes --ruler
npx @fantechlabs/skills run changeset validate
npx @fantechlabs/skills run commit --help
```

## Installing Skills

Install one or more skills into the current project:

```bash
npx @fantechlabs/skills install commit pr --yes
npx @fantechlabs/skills install changeset --agent claude --yes
npx @fantechlabs/skills install review --ruler --yes
```

Install globally into detected agent directories:

```bash
npx @fantechlabs/skills install commit pr review --global --yes
npx @fantechlabs/skills install commit --global --agent codex --yes
npx @fantechlabs/skills install commit pr --global --symlink --yes
```

Install behavior:

- Local installs auto-detect project agent config such as `.codex`, `.claude`, `.cursor`, `.opencode`, `.pi`, `.hermes`, and `openclaw.json`.
- If no agent config is detected and `--yes` is used, skills install to `.agents/skills`.
- `--agent <agent>` installs to the target path for that agent. Repeat it to target multiple agents.
- `--global` only targets agent home directories that already exist: `~/.agents`, `~/.claude`, and `~/.cursor`.
- `--global --symlink` installs into `~/.agents/skills` as the source and symlinks into detected dedicated roots such as `~/.claude/skills` and `~/.cursor/skills`.
- Skill directories are copied without `node_modules`.
- When an installed skill contains a `scripts/package.json`, the installer runs the detected package manager in that installed script directory unless `--skip-deps` is passed.
- Rerun `skills install ...` to update copied skills. Symlinked global installs follow the source automatically.

## Supported Agents

| Agent | Local | Global | `--global --symlink` | Status |
|---|---|---|---|---|
| Ruler | `--ruler` or `.ruler/ruler.toml` -> `.ruler/skills` | — | — | 🏠 local-only |
| Codex | `.codex` -> `.agents/skills` | `~/.agents` -> `~/.agents/skills` | 🟢 source | ✅ |
| OpenCode | `.opencode` -> `.agents/skills` | `~/.agents` -> `~/.agents/skills` | 🟢 source | ✅ |
| Pi | `.pi` -> `.agents/skills` | `~/.agents` -> `~/.agents/skills` | 🟢 source | ✅ |
| Claude Code | `.claude` -> `.claude/skills` | `~/.claude` -> `~/.claude/skills` | 🔗 target | ✅ |
| Cursor | `.cursor` -> `.cursor/skills` | `~/.cursor` -> `~/.cursor/skills` | 🔗 target | ✅ |
| Hermes | `.hermes` -> `.agents/skills` | `~/.agents` -> `~/.agents/skills` | 🟢 source | ✅ |
| OpenClaw | `openclaw.json` -> `.agents/skills` | `~/.agents` -> `~/.agents/skills` | 🟢 source | ✅ |

Legend:
- `🟢 source`: symlink source directory
- `🔗 target`: symlink target directory

## Adding Support for a New Agent

Use this playbook: [docs/adding-agent-support.md](docs/adding-agent-support.md)

## Install This Repo's Skills via `skills.sh`

[`skills.sh`](https://www.skills.sh/) is a separate external CLI from Vercel Labs.
Use it to install individual skills from this repository by URL:

```bash
npx skills add https://github.com/FantechLabs/skills --skill commit
npx skills add https://github.com/FantechLabs/skills --skill changeset
npx skills add https://github.com/FantechLabs/skills --skill pr
```

Use the same pattern for any other skill folder in this repo:
`npx skills add https://github.com/FantechLabs/skills --skill <skill-name>`.

## CLI Commands

- `skills list`: report each bundled skill's local/global scope, harness, location, and runnable status.
- `skills install [skills...]`: install selected skills, or all skills when none are provided in non-interactive mode.
- `skills run <skill> [subcommand] [args...]`: run a skill script.
- `skills <skill-name> [subcommand] [args...]`: shortcut for `skills run <skill-name> ...`.
- `skills update [skills...]`: update installed skills from the latest npm package by skill version.
- `skills remove [skills...]`: remove installed skills from the selected targets.

Common install flags:

- `--agent <agent>`: target a specific local or global agent. Supported global aliases include `agents`, `codex`, `opencode`, `claude`, `cursor`, `pi`, `hermes`, and `openclaw`.
- `--global`: install into detected home-level agent directories.
- `--symlink`: with `--global`, prefer `~/.agents/skills` as the source and symlink dedicated agent roots to it.
- `--ruler`: install into `.ruler/skills`.
- `--yes`: skip interactive prompts.
- `--skip-deps`: copy skills without installing per-skill script dependencies.

### Updating Skills

`skills update` downloads the package selected by the npm `latest` dist-tag and compares each
installed skill's `version` in `SKILL.md` with that skill's version in the downloaded package.
Skill versions are independent of the root npm package version, so only skills with a lower
version are updated. An installed skill without version metadata is reported as `legacy` and is
eligible for update. The command does not downgrade an installed skill whose version is newer.

In an interactive terminal, `update` without names opens a picker for outdated skills and then
asks for confirmation. Supplying names limits the update to those skills. With `--yes`, prompts
are skipped; omitting names updates every outdated installed skill in the selected targets.
Non-interactive updates require `--yes`.

```bash
# Interactively pick from outdated local skills
npx @fantechlabs/skills update

# Interactively confirm an update of one named skill
npx @fantechlabs/skills update commit

# Update every outdated skill in detected global targets without prompts
npx @fantechlabs/skills update --global --yes

# Update named Ruler skills and skip dependency installation
npx @fantechlabs/skills update commit review --ruler --yes --skip-deps
```

Update flags:

- `--agent <agent>`: restrict discovery and updates to a target agent; repeat for multiple agents.
- `--global`: use detected global agent skill directories.
- `--ruler`: use the current project's `.ruler/skills` directory.
- `--yes`: skip selection and confirmation; without names, update all outdated skills.
- `--skip-deps`: do not install dependencies for updated skill script packages.

Copied installs are updated in place. For symlinked installs, the command preserves each logical
symlink and updates its canonical shared source only once, even when multiple agent directories
link to it. A global update plan also lists detected agent links affected by a selected shared
source, including links outside a narrowly selected `--agent agents` target.

### Removing Skills

In an interactive terminal, `remove` without names opens a picker and then asks for confirmation.
Supplying names removes only those skills after confirmation. `remove --yes` is intentionally not
a remove-all operation: automation must provide one or more explicit skill names. Non-interactive
removals require both explicit names and `--yes`.

```bash
# Remove one local skill after confirmation
npx @fantechlabs/skills remove commit

# Interactively pick skills from detected global targets
npx @fantechlabs/skills remove --global

# Remove explicit global skills without prompts
npx @fantechlabs/skills remove commit review --global --yes

# Remove an explicit Ruler skill without prompts
npx @fantechlabs/skills remove review --ruler --yes
```

Remove flags:

- `--agent <agent>`: restrict discovery and removal to a target agent; repeat for multiple agents.
- `--global`: use detected global agent skill directories.
- `--ruler`: use the current project's `.ruler/skills` directory.
- `--yes`: skip confirmation, but only when explicit skill names are present.

The removal plan shows every matching logical install location. Removing a symlink location removes
the link itself rather than following it and deleting the shared canonical source. When the shared
source itself is selected, the plan identifies it and also removes detected links backed by that
source so the global agent roots are not left with dangling skill links.

## Skill Script Routing

Runnable skills are auto-discovered from each skill's `scripts/` directory.

For multi-script skills, you can define an explicit default in `SKILL.md` frontmatter:

```yaml
---
name: my-skill
description: My skill
default_script: create
---
```

- `default_script` can be a subcommand name (`create`) or script file (`create.ts`).
- If omitted, the CLI falls back to: `<skill-name>`, then `create`, then single-script fallback.

## Development

```bash
bun install
bun run lint
bun run format:check
bun run typecheck
```

## Testing

```bash
bun run test
bun run test:watch
bun run test:coverage
bun run test:bun-smoke
bun run ci:test
```

- `bun run test`: full Vitest suite.
- `bun run test:watch`: watch mode during development.
- `bun run test:coverage`: generate coverage report.
- `bun run test:bun-smoke`: verify Bun can execute core CLI entrypoints.
- `bun run ci:test`: lint + typecheck + tests + Bun smoke checks.
- CI runs this suite on Node `20`, `22`, and `24`, plus a dedicated Bun job.

## Hooks

- `pre-commit`: `oxlint` + `oxfmt --check` on staged snapshot
- `commit-msg`: `commitlint` + `tsc --noEmit` (skipped when commit message is explicitly marked as WIP)
