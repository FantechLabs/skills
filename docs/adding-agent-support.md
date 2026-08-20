# Adding Support for a New Agent

This guide is for both humans and coding agents.

## 1. Input Required From Human

Provide only the new agent name.

Examples:
- `GitHub Copilot`
- `Kilo Code`
- `Foo Agent`

## 2. Research Official Docs First

The coding agent should find current official documentation and confirm:
- local project config directory pattern (for auto-detection)
- local skills/rules/instructions directory
- global/home directory pattern
- whether the agent can use shared `~/.agents/skills` or needs its own directory
- whether symlink-based installs are supported/recommended

Research rules:
- prefer vendor docs and changelogs over blog posts
- capture links used for decisions in the final PR/summary

## 3. Choose Integration Model

Pick one model based on official docs:

1. Shared model
- Agent can consume `.agents/skills` locally/globally.
- Prefer this model for agents that implement the AGENTS.md skills convention.

2. Dedicated model
- Agent requires dedicated directories such as `.<agent>/skills` and `~/.<agent>/skills`.

## 4. Implement Code Changes

Update local + global path logic:
- [src/lib/agents.ts](../src/lib/agents.ts)

Update install command behavior:
- [src/commands/install.ts](../src/commands/install.ts)

Update setup script global detection:
- [setup.sh](../setup.sh)

Implementation requirements:
- local auto-detection should only rely on real config directories
- global install should only target detected global directories
- keep symlink mode behavior explicit and predictable

## 5. Add/Update Tests

Update:
- [tests/cli/install.test.ts](../tests/cli/install.test.ts)

Minimum coverage:
- explicit local `--agent` install path
- local auto-detection behavior
- global detected-only behavior
- global `--agent` filtering behavior
- global symlink behavior (if applicable)

## 6. Update README Matrix

Update the row in:
- [README.md](../README.md)

Keep entries concise and consistent with code behavior.

## 7. Validate Before Finishing

Run:

```bash
vp run ci:test
```

## 8. Report With Evidence

When done, include:
- files changed
- test results
- official documentation links used for design decisions
