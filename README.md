# @fantech/skills

Shared agent skills and a CLI for installing and running them.

## Project CLI (`@fantech/skills`)

Run directly without a global install:

```bash
npx @fantech/skills --help
bunx @fantech/skills --help
```

Common usage:

```bash
npx @fantech/skills list
npx @fantech/skills install commit --yes
npx @fantech/skills install commit --yes --agent claude
npx @fantech/skills install commit --yes --ruler
npx @fantech/skills run changeset validate
npx @fantech/skills run commit --help
npx @fantech/skills commit --help
```

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

- `skills list`
- `skills install [skills...]`
- `skills run <skill> [args...]`
- `skills <skill-name> [args...]` (shortcut for `skills run <skill-name> [args...]`)
- `skills remove` (reserved, coming soon)
- `skills update` (reserved, coming soon)

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

- `pre-commit`: `oxlint` + `oxfmt --check` + `tsc --noEmit`
- `commit-msg`: `commitlint` with conventional commit rules
