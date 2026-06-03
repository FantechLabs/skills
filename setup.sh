#!/usr/bin/env bash
# setup.sh — Idempotent skill installer
#
# Links skills from this repo to global agent directories so they're
# available to all local AI agents (Claude Code, Cursor, Codex, OpenCode,
# Pi, Hermes, OpenClaw).
#
# Safe to run any number of times.
#
# Targets:
#   ~/.agents/skills/<name>/  — Codex/OpenCode/Pi/OpenClaw shared skills
#   ~/.claude/skills/<name>/  — Claude Code
#   ~/.cursor/skills/<name>/  — Cursor
#   ~/.pi/agent/skills/<name>/ — Pi
#   ~/.hermes/skills/<name>/  — Hermes
#   ~/.openclaw/skills/<name>/ — OpenClaw

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGETS=()

[[ -d "$HOME/.agents" ]] && TARGETS+=("$HOME/.agents/skills")
[[ -d "$HOME/.claude" ]] && TARGETS+=("$HOME/.claude/skills")
[[ -d "$HOME/.cursor" ]] && TARGETS+=("$HOME/.cursor/skills")
[[ -d "$HOME/.pi" ]] && TARGETS+=("$HOME/.pi/agent/skills")
[[ -d "$HOME/.hermes" ]] && TARGETS+=("$HOME/.hermes/skills")
[[ -d "$HOME/.openclaw" ]] && TARGETS+=("$HOME/.openclaw/skills")

if [[ ${#TARGETS[@]} -eq 0 ]]; then
  echo "No supported agent directories detected (expected one of ~/.agents, ~/.claude, ~/.cursor, ~/.pi, ~/.hermes, ~/.openclaw)."
  exit 0
fi

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
