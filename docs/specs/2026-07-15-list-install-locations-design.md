# Harness-Aware Skill List Design

## Goal

Make `skills list` report skill installations from both the current project and
the user's home-level agent directories. Each reported installation identifies
its scope, compatible harness, and path without making the inventory difficult
to scan in a normal terminal.

## Output Contract

Each bundled skill keeps one compact summary row containing its name, install
status, and whether it is runnable. Its description appears on the following
line after whitespace normalization and is truncated to at most 60 characters,
including a trailing `…` when truncation is required.

Installed skills then show one entry per discovered location. Each entry contains:

- `Local` or `Global` scope.
- The harness associated with the installation root.
- The skill directory, displayed relative to the current project for local
  installations and with `~` for home-level installations.

For example:

```text
commit         installed · runnable
               Create conventional commits with repository-aware scopes…
               Global · Codex, OpenCode, Pi, Hermes, OpenClaw
                        ~/.agents/skills/commit
               Local  · Claude Code
                        .claude/skills/commit
```

`not installed` is shown only when no local or global location contains that
skill. Local locations are listed before global locations; locations within a
scope use a stable root order.

## Installation Discovery

Discovery returns structured locations instead of bare directory strings. A
location contains its scope, harness label, installation root, and complete
skill path.

Local discovery checks supported roots beneath the current working directory:

| Root | Harness label |
| --- | --- |
| `skills` | Generic |
| `.ruler/skills` | Ruler |
| `.agents/skills` | Detected shared harnesses, or all compatible shared harnesses |
| `.claude/skills` | Claude Code |
| `.cursor/skills` | Cursor |
| `.codex/skills` | Codex |
| `.opencode/skills` | OpenCode |

The shared `.agents/skills` root is compatible with Codex, OpenCode, Pi,
Hermes, and OpenClaw. Local discovery narrows that list to compatible harnesses
detected in the project when possible. If no harness configuration is present,
it reports the complete compatibility list because non-interactive installs use
`.agents/skills` as their default.

Global discovery checks the corresponding home-level agent roots, excluding a
generic `~/skills` directory because that name is too broad to treat as an agent
installation. The supported global roots are `.agents/skills`, `.claude/skills`,
`.cursor/skills`, `.codex/skills`, `.opencode/skills`, and `.ruler/skills`.

Each configured root is reported separately even when it is a symlink to another
root. This preserves the useful fact that the skill is exposed to that harness.

## Code Boundaries

- `src/lib/skills.ts` owns installation-location types and local/global
  filesystem discovery.
- `src/commands/list.ts` owns compact description formatting, path formatting,
  and rendering the structured locations.
- `src/lib/agents.ts` remains the source of known harness names and local agent
  detection. Any small export needed to label shared roots belongs there rather
  than duplicating the known-agent registry.

No install behavior or bundled skill contents change.

## Testing

Focused tests cover:

- A skill installed only in a local dedicated harness root.
- A skill installed only in a global root.
- A skill installed in both scopes.
- Shared `.agents/skills` harness labeling.
- A skill absent from every supported root.
- Description normalization, 60-character truncation, and the absence of
  multi-line descriptions.
- Stable, readable location paths in CLI output.

The full test, typecheck, lint, and formatting checks run after the focused list
tests pass.
