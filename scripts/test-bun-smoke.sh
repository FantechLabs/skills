#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

help_output="$(bun ./bin/skills.mjs --help 2>&1)"
grep -Fq "update [skills...]" <<< "$help_output"
grep -Fq "remove [skills...]" <<< "$help_output"
if grep -Fq "coming soon" <<< "$help_output"; then
  echo "help still contains coming soon"
  exit 1
fi

if remove_output="$(bun ./bin/skills.mjs remove --yes 2>&1)"; then
  echo "remove --yes without names unexpectedly succeeded"
  exit 1
fi
grep -Fq "requires explicit skill names" <<< "$remove_output"

bun ./bin/skills.mjs list > /dev/null 2>&1
bun ./bin/skills.mjs run commit --help > /dev/null 2>&1
bun ./bin/skills.mjs run release --help > /dev/null 2>&1

echo "bun smoke checks passed"
