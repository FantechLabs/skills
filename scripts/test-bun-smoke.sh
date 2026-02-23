#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

bun ./bin/skills.mjs --help > /dev/null 2>&1
bun ./bin/skills.mjs list > /dev/null 2>&1
bun ./bin/skills.mjs run commit --help > /dev/null 2>&1
bun ./bin/skills.mjs run release --help > /dev/null 2>&1

echo "bun smoke checks passed"
