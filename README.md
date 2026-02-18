# @fantech/skills

Shared agent skills and a CLI for installing and running them.

## CLI

Run via npm:

```bash
npx @fantech/skills list
npx @fantech/skills install commit
npx @fantech/skills run changeset validate
```

Run via Bun:

```bash
bunx @fantech/skills list
bunx --bun @fantech/skills run release --dry-run
```

## Commands

- `skills list`
- `skills install [skills...]`
- `skills run <skill> [args...]`
- `skills remove` (reserved, coming soon)
- `skills update` (reserved, coming soon)

## Development

```bash
bun install
npm run lint
npm run format:check
npm run typecheck
```

## Hooks

- `pre-commit`: `oxlint` + `oxfmt --check` + `tsc --noEmit`
- `commit-msg`: `commitlint` with conventional commit rules
