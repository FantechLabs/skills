# AGENTS.md

This is a shared skills repository. Skills here follow the [Agent Skills](https://agentskills.io/specification) open standard and are installed system-wide via symlinks.

## Project structure

```
<skill-name>/
  SKILL.md           # Required — frontmatter (name, description) + instructions
  scripts/           # Optional — executable code (bun/tsx)
  references/        # Optional — additional documentation
  assets/            # Optional — templates, resources
```

Each `SKILL.md` must have YAML frontmatter with `name` (matching directory name, lowercase + hyphens) and `description` (what it does and when to use it).

## After modifying skills

Run `./setup.sh` after adding, renaming, or removing a skill. This creates symlinks in `~/.claude/skills/` and `~/.agents/skills/` so all local agents pick up changes immediately.

Run it manually whenever you modify skill directories:

```bash
./setup.sh
```

The script is idempotent. It skips non-symlink entries in the target directories (manual overrides), and cleans up stale links when a skill is removed from this repo.
