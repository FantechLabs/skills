# @fantechlabs/skills

Shared agent skills and a CLI for installing and running them.

## Bundled Skills

| Skill | Type | Use it for | Common commands |
|---|---|---|---|
| `changeset` | Runnable | Generate and validate Changesets files from conventional commits. Also helps with prerelease mode. | `skills changeset`, `skills changeset validate`, `skills changeset prerelease` |
| `commit` | Runnable | Create conventional commits with the right type, emoji, scope, body, and safety checks. | `skills commit`, `skills commit --help` |
| `handoff` | Docs only | Write compact handoff notes so another agent can resume the same work later. | Install and invoke as an agent skill. |
| `pick-up` | Docs only | Resume from a handoff document without trusting stale context. | Install and invoke as an agent skill. |
| `pr` | Runnable | Analyze a branch and create a GitHub PR or GitLab MR with title, body, changeset checks, and reviewer suggestions. | `skills pr --dry-run`, `skills pr --ci --title "..."` |
| `release` | Runnable | Consume Changesets, version packages, create tags, and create GitHub releases. | `skills release --dry-run`, `skills release --ci` |
| `review` | Docs only | Fetch, triage, and address PR/MR review feedback. | Install and invoke as an agent skill. |

Runnable skills include scripts under `<skill>/scripts/` and can be executed through this package's `skills` CLI. Docs-only skills are agent instructions without a CLI script.

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

- `skills list`: list bundled skills, install status, and whether each skill is runnable.
- `skills install [skills...]`: install selected skills, or all skills when none are provided in non-interactive mode.
- `skills run <skill> [subcommand] [args...]`: run a skill script.
- `skills <skill-name> [subcommand] [args...]`: shortcut for `skills run <skill-name> ...`.
- `skills remove` (reserved, coming soon)
- `skills update` (reserved, coming soon)

Common install flags:

- `--agent <agent>`: target a specific local or global agent. Supported global aliases include `agents`, `codex`, `opencode`, `claude`, `cursor`, `pi`, `hermes`, and `openclaw`.
- `--global`: install into detected home-level agent directories.
- `--symlink`: with `--global`, prefer `~/.agents/skills` as the source and symlink dedicated agent roots to it.
- `--ruler`: install into `.ruler/skills`.
- `--yes`: skip interactive prompts.
- `--skip-deps`: copy skills without installing per-skill script dependencies.

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
