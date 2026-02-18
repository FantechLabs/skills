#!/usr/bin/env bash
# setup.sh — Idempotent skill installer
#
# Links skills from this repo to global agent directories so they're
# available to all local AI agents (Claude Code, Cursor, Codex, OpenCode).
#
# Safe to run any number of times.
#
# Targets:
#   ~/.claude/skills/<name>/  — Claude Code, Cursor, OpenCode
#   ~/.agents/skills/<name>/  — Codex, OpenCode

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGETS=("$HOME/.claude/skills" "$HOME/.agents/skills")
changed=0

# --- Link skills ---
for target_base in "${TARGETS[@]}"; do
  mkdir -p "$target_base"

  # Create/update symlinks for each skill
  for skill_dir in "$REPO_DIR"/*/; do
    [[ -f "${skill_dir}SKILL.md" ]] || continue
    skill_name="$(basename "$skill_dir")"
    target="$target_base/$skill_name"
    source="${skill_dir%/}"

    # Already correctly linked — nothing to do
    if [[ -L "$target" && "$(readlink "$target")" == "$source" ]]; then
      continue
    fi

    # Exists but is NOT a symlink — respect as a manual override
    if [[ -e "$target" && ! -L "$target" ]]; then
      echo "skip: $target (not a symlink — manual override)"
      continue
    fi

    # Stale symlink pointing elsewhere — replace it
    [[ -L "$target" ]] && rm "$target"

    ln -s "$source" "$target"
    echo "link: $skill_name → $target_base/"
    changed=1
  done

  # Clean stale symlinks that point into THIS repo but whose skill was removed
  for link in "$target_base"/*; do
    [[ -L "$link" ]] || continue
    resolved="$(readlink "$link")"
    # Only touch links that point into this repo
    [[ "$resolved" == "$REPO_DIR"/* ]] || continue
    # If the target still exists, leave it alone
    [[ -d "$resolved" ]] && continue
    rm "$link"
    echo "clean: $(basename "$link") (removed from $target_base/)"
    changed=1
  done
done

[[ $changed -eq 0 ]] && echo "up to date" || echo "done"
