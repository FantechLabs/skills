# Versioned Skill Update and Removal Design

## Summary

Replace the reserved `skills update` and `skills remove` commands with complete,
confirmed workflows. Skills receive independent semantic versions in `SKILL.md`,
and `update` discovers the latest versions and contents from the current npm
`latest` release of `@fantechlabs/skills`.

The commands reuse the install command's target rules for local agents, explicit
agents, global agent homes, and Ruler projects. They inventory only the resolved
targets and preserve the distinction between copied and symlinked installations.

## Skill Version Metadata

Every bundled skill must declare a strict semantic version in frontmatter:

```yaml
---
name: commit
version: 1.0.0
description: Create git commits following conventional commits.
---
```

`discoverBundledSkills` will expose the version and reject missing or invalid
versions where versioned behavior requires them. Existing installed skills with
no version are legacy installations. They remain discoverable and are considered
older than any valid published version.

All existing bundled skills start at `1.0.0`. Independent skill versions do not
need to match the npm package version.

The repository's existing `.ruler/AGENTS.md` will require:

- New skills to start with `version: 1.0.0`.
- Any modification to a skill's `SKILL.md`, scripts, references, or assets to
  include a semantic-version bump in the same change.
- Patch bumps for fixes and wording changes, minor bumps for backward-compatible
  capabilities, and major bumps for breaking behavior.
- Every regular npm release to verify that skills changed since the previous
  release have appropriate bumps. Unchanged skills retain their versions.

## Shared Target Resolution and Inventory

The target-resolution logic currently private to `install` will move into a
shared library. `install`, `update`, and `remove` will therefore interpret
`--agent`, `--global`, `--ruler`, auto-detected agent configuration, and the
default `.agents/skills` target consistently.

An installed-skill inventory will scan only those resolved roots. Each inventory
entry records the skill name, logical install path, canonical path, symlink state,
and installed version. Operations on canonical update paths are deduplicated so a
shared source is updated once even when several agent roots link to it.

Updating a symlinked entry modifies its canonical source and leaves the symlink
intact. Removing an entry removes the selected logical entry: removing a dedicated
agent symlink does not delete its shared source, while selecting the shared source
explicitly removes that source. Confirmation output identifies shared-source
effects.

## npm Latest-Skill Source

Before planning an update, the CLI requests the npm metadata for the `latest`
dist-tag of `@fantechlabs/skills`. It downloads that release's tarball into a
temporary directory, verifies the registry-provided integrity digest, and safely
extracts it. The extracted package is treated as an immutable update source.

The update planner compares each installed skill's version with the corresponding
version in the extracted package:

- Lower or legacy installed version: update available.
- Equal version: current; do not overwrite local drift implicitly.
- Higher installed version: do not downgrade.
- Installed skill absent from the latest package: not updateable; report clearly.
- Latest skill with an invalid or missing version: fail before mutation.

Skills present in the npm package but not installed in the resolved targets are
not installed by `update`.

Registry metadata, network, integrity, or extraction failures occur before the
confirmation and mutation phases. Temporary files are cleaned up on success,
failure, or cancellation.

## `skills update`

Supported options are `--agent <agent>`, `--global`, `--ruler`, `--yes`, and
`--skip-deps`.

### Interactive behavior

With no positional skill names, the command inventories installed skills, fetches
the latest npm release, and shows a multiselect containing only skills with an
available update. Labels show version transitions, for example:

```text
commit  1.2.0 -> 1.3.0
review  legacy -> 1.1.0
```

When a skill is installed at different versions in multiple resolved roots, the
picker summarizes those installed versions and the single latest version.

With explicit positional names, only those installed skills are planned. Unknown
skill names, names absent from the npm source, and names not installed in any
resolved target produce actionable errors.

After selection or explicit planning, the CLI prints every affected location and
asks for final confirmation before changing files. Cancellation exits successfully
without mutation.

### Non-interactive behavior

`--yes` bypasses the picker and final confirmation. With no positional names it
updates every outdated installed skill in the resolved targets. With names it
updates every outdated named skill.

Without `--yes`, a non-interactive process cannot satisfy the confirmation
requirement and exits with an error explaining how to use `--yes`.

### Applying updates

Only locations with an older or legacy version are replaced. Canonical paths are
deduplicated, symlinks are preserved, and current or newer locations are skipped.
For updated runnable skills, dependencies are installed using the existing package
manager behavior unless `--skip-deps` is supplied.

If no updates are available, the command reports that all selected installed
skills are current and exits successfully without prompting.

For Ruler targets, the existing post-install `ruler apply` behavior is reused after
successful changes.

## `skills remove`

Supported options are `--agent <agent>`, `--global`, `--ruler`, and `--yes`.

With no positional names in an interactive terminal, the CLI shows a multiselect
of installed skills in the resolved targets. It then prints all affected logical
locations and asks for final confirmation.

With explicit names, the CLI validates that each name is installed in at least one
resolved target, prints the removal plan, and asks for confirmation. Unknown or
uninstalled names fail without removing anything.

`--yes` bypasses confirmation only when explicit skill names are present.
`skills remove --yes` without names fails safely because removal must never infer
"all installed skills." A non-interactive remove without both explicit names and
`--yes` also fails with an actionable message.

Removal deletes the selected logical entries, including symlink entries, without
following symlinks into unrelated targets. Empty parent skill roots are left in
place. For Ruler targets, the existing post-install `ruler apply` behavior is
reused after successful changes.

## User-Facing Documentation

CLI help and README command documentation will replace all "coming soon" text,
list supported flags, explain version-backed npm updates, show interactive and
`--yes` examples, and document the safe no-name behavior of both commands.

## Verification

Focused tests will cover:

- Skill version parsing, validation, and semantic comparison.
- Legacy installed skills and no-downgrade behavior.
- npm metadata lookup, tarball integrity verification, extraction, and cleanup.
- Update planning for explicit names, all outdated skills, current skills, and
  missing skills.
- Interactive selection and confirmation cancellation through separable planner
  and prompt boundaries.
- `--yes` update-all behavior and non-interactive confirmation errors.
- Remove selection, explicit removal, `--yes` safeguards, and cancellation.
- Local, explicit-agent, global, and Ruler target parity with install.
- Copied skills, shared canonical sources, and symlink preservation/removal.
- Dependency installation and `--skip-deps` during updates.
- Help text, README text, and required version metadata on every bundled skill.

The final verification gate is the repository's full `bun run ci:test` suite.
