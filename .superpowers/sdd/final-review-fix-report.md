# Final Whole-Branch Review Fix Report

## Status

All five final whole-branch review findings were addressed in commit `514fbf5`.

## Fixes

1. Unnamed updates now report installed skills absent from npm `latest` as
   `not updateable` and do not describe them as current. Explicit requests retain
   the actionable `Skill is missing from the latest package` error.
2. `update` and `remove` now use a management-specific target resolver. Global
   management inventories detected logical roots without showing the install-only
   copy-versus-symlink prompt. Shared-source plans list detected affected links,
   including links outside a narrow `--agent agents` selection. Removing a selected
   shared source also removes those detected links, while removing a dedicated link
   still preserves its source.
3. `skills update --help` and `skills remove --help` now list every supported flag
   and the relevant confirmation, version, dependency, and symlink safety rules.
   Help returns before target resolution, npm lookup, or filesystem mutation.
4. Update transition labels summarize legacy, outdated, current, and ahead versions
   across all resolved locations. Only legacy/outdated canonical paths remain in
   `updatePaths`.
5. A command-level regression proves default dependency installation for an updated
   runnable skill. The existing `--skip-deps` regression remains in place.

README update/remove safety documentation was aligned with the command behavior.

## TDD Evidence

Tests were added before implementation.

### RED

- `bun run test tests/cli/update.test.ts`: 5 expected failures, 18 passing. Failures
  covered incomplete version summaries, the false-current npm-missing message,
  omitted external symlink impact, and missing update help.
- `bun run test tests/cli/remove.test.ts`: 2 expected failures, 15 passing. Failures
  covered omitted shared-source backlinks and missing remove help.
- `bun run test tests/cli/install.test.ts`: 1 expected failure, 19 passing. The new
  management resolver did not exist; all existing install regressions stayed green.
- `bun run test tests/cli/help-version.test.ts`: 2 expected failures, 3 passing.
  Both subcommand help invocations exited non-zero.
- The new default dependency-install test passed on its first test-only run. This was
  a missing command-level proof for behavior already present, so it is recorded as a
  characterization GREEN rather than an invented production-code RED.

### GREEN

- Focused command and support suites:
  `bun run test tests/cli/update.test.ts tests/cli/remove.test.ts tests/cli/install.test.ts tests/cli/installed-skills.test.ts tests/cli/help-version.test.ts tests/cli/npm-skills.test.ts`
  - Result: 6 files passed, 86 tests passed.
- `bun run lint`
  - Result: 0 warnings, 0 errors.
- `bun run typecheck`
  - Result: exit 0.
- `bun run format:check`
  - Result: all 75 matched files correctly formatted.
- `bun run ci:test`
  - Result: exit 0; lint and typecheck passed, 19 Vitest files / 180 tests passed,
    and Bun smoke checks passed.
- `git diff --check`
  - Result: exit 0.

The commit hook reran lint and format checking successfully while creating
`514fbf5`.

## Install Compatibility

Install continues to call the original install resolver and retains its global
copy/symlink selection behavior. The new management resolver is additive and is
used only by update/remove. The focused install suite passed all 20 tests, including
default, explicit-agent, global-copy, global-symlink, Ruler, and dependency cases.

## Concerns

No unresolved functional concerns. Shared-source impact discovery is intentionally
bounded to detected global agent roots, matching the target-resolution contract; an
arbitrary symlink outside those roots cannot be discovered or cleaned automatically.
