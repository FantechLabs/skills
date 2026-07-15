# Versioned Update and Remove Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship complete, confirmed `skills update` and `skills remove` commands backed by independently versioned skills from the latest npm release.

**Architecture:** Move install target selection into a shared resolver, add a symlink-aware installed-skill inventory, and stage the latest npm package behind an integrity-checked temporary-package boundary. Keep command orchestration thin by putting semantic-version comparison, update planning, and removal planning in testable library modules.

**Tech Stack:** TypeScript on Node.js 20.10+, Vitest, `@clack/prompts`, npm registry HTTP API, Node crypto/filesystem APIs, and `tar@^7.5.20`.

## Global Constraints

- Every bundled skill declares an independent strict stable semantic version in `SKILL.md` frontmatter using `MAJOR.MINOR.PATCH`; all existing skills start at exactly `1.0.0`.
- New skills start at `1.0.0`; modifications to a skill's instructions, scripts, references, or assets require a semantic-version bump in the same change.
- `update` obtains latest versions and contents from the npm `latest` release of `@fantechlabs/skills`, verifies registry-provided integrity before extraction, and never downgrades.
- Legacy installed skills without version metadata are older than every valid published version.
- Equal versions are current even if contents drift; `update` does not overwrite them implicitly.
- Interactive `update` without names offers only installed skills with updates, shows installed-to-latest versions, and asks for final confirmation.
- `update --yes` without names updates every outdated installed skill without prompting.
- Interactive `remove` without names offers installed skills and asks for final confirmation; `remove --yes` without names always fails safely.
- Both commands reuse install's `--agent`, `--global`, `--ruler`, auto-detection, and default `.agents/skills` targeting semantics.
- Updating a symlink changes its canonical shared source once without replacing the symlink; removing a selected symlink removes that logical link without following it.
- Remote lookup, download, integrity, and extraction failures happen before installed files are mutated, and temporary files are always cleaned up.
- The npm package version becomes `0.3.0` so merging this feature can publish the implementation consumed by npm-backed updates.

---

### Task 1: Independent Skill Version Metadata and Repository Rule

**Files:**
- Modify: `src/lib/skills.ts`
- Modify: `.ruler/AGENTS.md`
- Modify: `changeset/SKILL.md`
- Modify: `claude-workflow/SKILL.md`
- Modify: `commit/SKILL.md`
- Modify: `handoff/SKILL.md`
- Modify: `pick-up/SKILL.md`
- Modify: `pr/SKILL.md`
- Modify: `release/SKILL.md`
- Modify: `review/SKILL.md`
- Create: `tests/cli/skill-versions.test.ts`

**Interfaces:**
- Produces: `SkillInfo.version: string`.
- Produces: `readSkillMetadata(skillDir: string): SkillMetadata`, where `version` is optional for legacy installed skills.
- Produces: `parseStableVersion(version: string, context: string): StableVersion` and `compareStableVersions(left: StableVersion, right: StableVersion): number`.
- Produces: `discoverBundledSkills(packageRoot?: string): SkillInfo[]`, which requires every discovered bundled skill to have a valid version.

- [ ] **Step 1: Run the documentation RED scenario before changing `.ruler/AGENTS.md`**

Ask a fresh-context subagent to inspect the repository rules and describe every required file change for a small wording edit to `commit/SKILL.md`. Record that the current rules do not require a version bump. This is the writing-skills baseline failure; do not edit files in this step.

- [ ] **Step 2: Write failing version tests**

Create `tests/cli/skill-versions.test.ts` with real temporary package roots:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  compareStableVersions,
  discoverBundledSkills,
  parseStableVersion,
} from "../../src/lib/skills";
import { cleanupTempProject, createTempProject } from "../utils/fs";

describe("skill versions", () => {
  it("requires a stable semantic version on every bundled skill", () => {
    const skills = discoverBundledSkills();
    expect(skills.map((skill) => skill.version)).toEqual(skills.map(() => "1.0.0"));
    for (const skill of skills) {
      expect(skill.version).toMatch(/^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$/);
    }
  });

  it("rejects a bundled skill with missing version metadata", () => {
    const root = createTempProject();
    mkdirSync(join(root, "example"));
    writeFileSync(join(root, "example", "SKILL.md"), "---\\nname: example\\ndescription: Example\\n---\\n");
    expect(() => discoverBundledSkills(root)).toThrow(/missing version/i);
    cleanupTempProject(root);
  });

  it("orders stable semantic versions numerically", () => {
    expect(compareStableVersions(parseStableVersion("1.9.0", "left"), parseStableVersion("1.10.0", "right"))).toBeLessThan(0);
    expect(compareStableVersions(parseStableVersion("2.0.0", "left"), parseStableVersion("1.99.99", "right"))).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run the focused test and verify RED**

Run: `bun run test tests/cli/skill-versions.test.ts`

Expected: FAIL because `SkillInfo.version`, `parseStableVersion`, and `compareStableVersions` do not exist and bundled skills lack `version`.

- [ ] **Step 4: Implement stable version parsing and metadata discovery**

In `src/lib/skills.ts`, add these public shapes and behavior:

```ts
export interface StableVersion {
  major: number;
  minor: number;
  patch: number;
  raw: string;
}

export interface SkillMetadata {
  defaultScript?: string;
  description: string;
  name: string;
  version?: string;
}

export interface SkillInfo {
  name: string;
  version: string;
  description: string;
  defaultScript?: string;
  hasScripts: boolean;
  path: string;
}

const STABLE_VERSION_PATTERN = /^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$/;

export function parseStableVersion(version: string, context: string): StableVersion {
  const match = STABLE_VERSION_PATTERN.exec(version);
  if (!match) throw new Error(`Invalid skill version for ${context}: ${version}`);
  return { raw: version, major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function compareStableVersions(left: StableVersion, right: StableVersion): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}
```

Export `readSkillMetadata(skillDir)` by reusing the existing frontmatter parser. Change `discoverBundledSkills(packageRoot = PACKAGE_ROOT)` to read metadata, throw `Missing skill version for <name>` when absent, validate it with `parseStableVersion`, and include the raw version in `SkillInfo`.

- [ ] **Step 5: Add versions and the local repository rule**

Add `version: 1.0.0` immediately after `name` in every bundled `SKILL.md`. Update `.ruler/AGENTS.md` so the frontmatter requirement and modification rules state:

```markdown
Each `SKILL.md` must have YAML frontmatter with `name`, `version`, and `description`. New skills start at `version: 1.0.0`.

Whenever a skill's instructions, scripts, references, or assets change, bump its version in the same change: patch for fixes or wording, minor for backward-compatible capabilities, and major for breaking behavior. Before a regular npm release, verify every changed skill has an appropriate bump; unchanged skills keep their existing versions.
```

- [ ] **Step 6: Verify GREEN and run the documentation GREEN scenario**

Run: `bun run test tests/cli/skill-versions.test.ts`

Expected: PASS with all bundled versions exactly `1.0.0`.

Then ask a new fresh-context subagent the same repository-rule scenario from Step 1. Expected: it explicitly includes the appropriate skill version bump in the proposed change.

- [ ] **Step 7: Commit**

```bash
git add .ruler/AGENTS.md src/lib/skills.ts tests/cli/skill-versions.test.ts */SKILL.md
git commit -m "feat(skills): ✨ add independent skill versions"
```

### Task 2: Shared Target Resolution and Symlink-Aware Inventory

**Files:**
- Create: `src/lib/install-targets.ts`
- Create: `src/lib/installed-skills.ts`
- Modify: `src/lib/ruler.ts`
- Modify: `src/commands/install.ts`
- Create: `tests/cli/installed-skills.test.ts`
- Modify: `tests/cli/install.test.ts`

**Interfaces:**
- Consumes: `readSkillMetadata(skillDir)` from Task 1.
- Produces: `TargetFlags`, `InstallTargetResolution`, and `resolveInstallTargets({ cwd, flags, interactive })` in `src/lib/install-targets.ts`.
- Produces: `InstalledSkill` and `findInstalledSkills(installRoots: string[]): InstalledSkill[]` in `src/lib/installed-skills.ts`.
- Produces: `applyRulerAfterChanges({ installPaths, interactive, yes }): Promise<void>` in `src/lib/ruler.ts`.
- `InstalledSkill` fields are `name`, `installRoot`, `path`, `canonicalPath`, `isSymlink`, and optional `version`.

- [ ] **Step 1: Write failing inventory tests**

Create `tests/cli/installed-skills.test.ts` covering a copied versioned skill, a legacy skill, and two symlinks to one canonical source:

```ts
it("records logical and canonical paths without collapsing symlinks", () => {
  const installed = findInstalledSkills([agentsRoot, claudeRoot, cursorRoot]);
  expect(installed.filter((entry) => entry.name === "commit")).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ installRoot: agentsRoot, isSymlink: false, version: "1.0.0" }),
      expect.objectContaining({ installRoot: claudeRoot, isSymlink: true, canonicalPath: sourceDir }),
      expect.objectContaining({ installRoot: cursorRoot, isSymlink: true, canonicalPath: sourceDir }),
    ]),
  );
});

it("keeps legacy skills with an undefined version", () => {
  expect(findInstalledSkills([agentsRoot])).toContainEqual(
    expect.objectContaining({ name: "legacy", version: undefined }),
  );
});
```

Add an install regression test confirming the default, explicit-agent, global, Ruler, and global-symlink cases still resolve to their existing locations after extraction.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `bun run test tests/cli/installed-skills.test.ts tests/cli/install.test.ts`

Expected: the new inventory test fails because both modules are missing; existing install tests remain green.

- [ ] **Step 3: Extract target resolution without behavior changes**

Move `InstallFlags`, `InstallTargetResolution`, `resolveInstallTargets`, and `resolveGlobalInstallTargets` from `src/commands/install.ts` into `src/lib/install-targets.ts`. Export this command-neutral flag shape:

```ts
export interface TargetFlags {
  agent?: string[];
  global: boolean;
  ruler: boolean;
  symlink?: boolean;
  yes: boolean;
}

export interface InstallTargetResolution {
  installPaths: string[];
  useSymlinkMode: boolean;
}

export async function resolveInstallTargets(options: {
  cwd: string;
  flags: TargetFlags;
  interactive: boolean;
}): Promise<InstallTargetResolution>;
```

Keep every current validation, interactive prompt, auto-detection branch, global-target warning, and symlink-source requirement byte-for-byte equivalent. Import and call the shared resolver from `install.ts`.

- [ ] **Step 4: Implement installed-skill inventory**

In `src/lib/installed-skills.ts`, enumerate directory and symlink entries beneath each unique install root. Include only entries whose resolved directory has `SKILL.md`. Use `lstatSync` on the logical entry and `realpathSync` for canonical paths. Read version metadata through `readSkillMetadata`; do not require version for installed entries. Sort by skill name and then logical path for deterministic prompts and tests.

```ts
export interface InstalledSkill {
  canonicalPath: string;
  installRoot: string;
  isSymlink: boolean;
  name: string;
  path: string;
  version?: string;
}

export function findInstalledSkills(installRoots: string[]): InstalledSkill[];
```

Skip dangling links and malformed entries that do not resolve to a readable `SKILL.md`; do not follow or delete anything during inventory.

Move the existing post-install Ruler prompt, `ruler apply` execution, missing-command warning, non-zero warning, and non-interactive instruction into `applyRulerAfterChanges`. Call it from `install.ts` with the existing inputs so behavior does not change, and make it available to update/remove without duplication.

- [ ] **Step 5: Verify GREEN**

Run: `bun run test tests/cli/installed-skills.test.ts tests/cli/install.test.ts`

Expected: PASS with current install behavior unchanged and canonical/link inventory proven.

- [ ] **Step 6: Commit**

```bash
git add src/lib/install-targets.ts src/lib/installed-skills.ts src/lib/ruler.ts src/commands/install.ts tests/cli/installed-skills.test.ts tests/cli/install.test.ts
git commit -m "refactor(cli): ♻️ share skill target resolution"
```

### Task 3: Integrity-Checked Latest npm Skill Package

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Create: `src/lib/npm-skills.ts`
- Create: `tests/cli/npm-skills.test.ts`

**Interfaces:**
- Consumes: `discoverBundledSkills(extractedPackageRoot)` from Task 1.
- Produces: `loadLatestSkillPackage(options?): Promise<LatestSkillPackage>`.
- `LatestSkillPackage` has `packageVersion`, `skills`, and an idempotent `cleanup()`.

- [ ] **Step 1: Add the extraction dependency**

Run: `bun add tar@^7.5.20`

Expected: `package.json` and `bun.lock` add `tar`; do not add the deprecated `@types/tar` stub because `tar` ships its own types.

- [ ] **Step 2: Write failing registry, integrity, and cleanup tests**

Create `tests/cli/npm-skills.test.ts`. Build a real npm-style `package/` tarball in a temporary directory with `tar.create`, calculate `sha512-<base64>` from its bytes, and inject a two-response `fetchImpl` into the loader.

```ts
const loaded = await loadLatestSkillPackage({
  fetchImpl: vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({
      name: "@fantechlabs/skills",
      version: "9.9.9",
      dist: { tarball: "https://registry.test/skills.tgz", integrity },
    }), { status: 200 }))
    .mockResolvedValueOnce(new Response(tarballBytes, { status: 200 })),
  registryUrl: "https://registry.test",
});

expect(loaded.packageVersion).toBe("9.9.9");
expect(loaded.skills.map((skill) => [skill.name, skill.version])).toEqual([["commit", "2.0.0"]]);
expect(existsSync(loaded.packageRoot)).toBe(true);
loaded.cleanup();
expect(existsSync(loaded.packageRoot)).toBe(false);
```

Add separate tests for metadata HTTP failure, tarball HTTP failure, wrong integrity, missing integrity, invalid latest skill version, and idempotent cleanup.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `bun run test tests/cli/npm-skills.test.ts`

Expected: FAIL because `src/lib/npm-skills.ts` does not exist.

- [ ] **Step 4: Implement npm staging**

Create `src/lib/npm-skills.ts` with this public contract:

```ts
export interface LatestSkillPackage {
  cleanup(): void;
  packageRoot: string;
  packageVersion: string;
  skills: SkillInfo[];
}

export interface LoadLatestSkillPackageOptions {
  fetchImpl?: typeof fetch;
  registryUrl?: string;
}

export async function loadLatestSkillPackage(
  options: LoadLatestSkillPackageOptions = {},
): Promise<LatestSkillPackage>;
```

Use `options.registryUrl`, then `process.env.npm_config_registry`, then `https://registry.npmjs.org`. Request `/<encoded package>/latest`, validate `name`, `version`, `dist.tarball`, and `dist.integrity`, download the tarball, and verify a supported `sha512`, `sha384`, or `sha256` digest with `createHash` plus `timingSafeEqual`. Write the verified bytes to a unique `mkdtempSync(join(tmpdir(), "fantech-skills-"))` directory and extract with:

```ts
await extractTar({
  cwd: packageRoot,
  file: tarballPath,
  preservePaths: false,
  strip: 1,
});
```

Discover skills from the extracted root, return an idempotent cleanup closure, and wrap the entire staging flow in `try/catch` so any pre-return failure recursively removes the temporary directory before rethrowing a concise contextual error.

- [ ] **Step 5: Verify GREEN**

Run: `bun run test tests/cli/npm-skills.test.ts`

Expected: PASS for success, integrity rejection, malformed metadata, invalid version, and cleanup cases.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock src/lib/npm-skills.ts tests/cli/npm-skills.test.ts
git commit -m "feat(cli): ✨ load latest skills securely from npm"
```

### Task 4: Confirmed Version-Aware Update Command

**Files:**
- Create: `src/lib/skill-updates.ts`
- Modify: `src/commands/update.ts`
- Create: `tests/cli/update.test.ts`
- Delete: `tests/cli/reserved-commands.test.ts`

**Interfaces:**
- Consumes: shared targets and installed inventory from Task 2.
- Consumes: `loadLatestSkillPackage()` from Task 3.
- Produces: `SkillUpdatePlan`, `planSkillUpdates(installed, latest, requestedNames)`, and `formatVersionTransition(plan)`.
- Produces: the final `updateCommand(args)` implementation.

- [ ] **Step 1: Write failing pure planner tests**

In `tests/cli/update.test.ts`, cover legacy-to-latest, lower-to-latest, equal/current, higher/no-downgrade, mixed locations, requested uninstalled names, latest-missing names, and canonical-path deduplication.

```ts
it("plans only older locations and deduplicates a shared canonical source", () => {
  const plans = planSkillUpdates(
    [
      installed("commit", undefined, "/shared/commit", "/agents/commit"),
      installed("commit", "1.0.0", "/shared/commit", "/claude/commit", true),
      installed("commit", "2.0.0", "/current/commit", "/cursor/commit"),
    ],
    [latest("commit", "2.0.0")],
    [],
  );

  expect(plans).toHaveLength(1);
  expect(plans[0].updatePaths).toEqual(["/shared/commit"]);
  expect(formatVersionTransition(plans[0])).toContain("legacy, 1.0.0 -> 2.0.0");
});
```

- [ ] **Step 2: Write failing command tests**

Add CLI-level tests using temporary install roots and a fixture latest-package loader boundary. Cover:

- `update --yes` without names updates every outdated installed skill.
- Explicit names update only requested skills.
- Non-interactive invocation without `--yes` fails before mutation.
- No available updates exits successfully without prompting.
- `--skip-deps` avoids installed script dependency commands.
- Updating a symlink keeps the symlink and changes the canonical source once.
- The latest package cleanup runs on success, cancellation, and apply failure.
- Interactive selection receives only outdated skill options and final confirmation includes version transitions and locations.

Expose a narrow dependency-injected `runUpdateCommand(args, dependencies)` for tests; the default export supplies real prompts, TTY detection, target resolution, and npm loading.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `bun run test tests/cli/update.test.ts`

Expected: FAIL because the planner and real update command do not exist and the old command still prints `coming soon`.

- [ ] **Step 4: Implement the pure update planner**

Create `src/lib/skill-updates.ts` with:

```ts
export interface SkillUpdatePlan {
  installedVersions: string[];
  latest: SkillInfo;
  locations: InstalledSkill[];
  name: string;
  updatePaths: string[];
}

export function planSkillUpdates(
  installed: InstalledSkill[],
  latest: SkillInfo[],
  requestedNames: string[],
): SkillUpdatePlan[];

export function formatVersionTransition(plan: SkillUpdatePlan): string;
```

Group installed entries by name, validate every explicit name, compare each location through Task 1's stable-version helpers, retain only legacy/lower locations, deduplicate and sort canonical update paths, and sort plans by name. Throw actionable errors for explicitly requested unknown, uninstalled, or latest-missing skills. Treat current/higher-only explicit requests as successful no-update results, not errors.

- [ ] **Step 5: Implement command orchestration and confirmation**

Replace `src/commands/update.ts` with parsed flags for `agent`, `global`, `ruler`, `yes`, and `skip-deps`. The command sequence is:

1. Resolve target roots and inventory installed skills.
2. Stage the latest npm package.
3. Plan updates for explicit names or all installed names.
4. If no update is available, report current status and exit successfully without requiring confirmation.
5. For a non-empty plan, reject non-interactive use without `--yes`.
6. If interactive with no names, multiselect only the update plans with `formatVersionTransition` labels.
7. Print a deterministic plan containing every logical location and canonical shared source effect.
8. Ask `Update <count> skill(s)?` unless `--yes`.
9. Copy each latest skill to every unique canonical update path, preserving logical symlinks.
10. Install dependencies in updated runnable skill package directories unless `--skip-deps`.
11. Reuse `applyRulerAfterChanges` after successful Ruler changes.
12. Always call `latestPackage.cleanup()` in `finally`.

Cancellation via either prompt prints `Cancelled`, makes no mutation, and returns successfully. Print `All selected installed skills are current.` when nothing is outdated.

- [ ] **Step 6: Verify GREEN**

Run: `bun run test tests/cli/update.test.ts tests/cli/install.test.ts tests/cli/npm-skills.test.ts`

Expected: PASS with real version planning, confirmation behavior, symlink preservation, cleanup, and no install regression.

- [ ] **Step 7: Commit**

```bash
git add src/lib/skill-updates.ts src/commands/update.ts tests/cli/update.test.ts tests/cli/reserved-commands.test.ts
git commit -m "feat(cli): ✨ add confirmed npm-backed skill updates"
```

### Task 5: Confirmed Safe Remove Command

**Files:**
- Create: `src/lib/skill-removals.ts`
- Modify: `src/commands/remove.ts`
- Create: `tests/cli/remove.test.ts`

**Interfaces:**
- Consumes: shared targets and installed inventory from Task 2.
- Produces: `SkillRemovalPlan`, `planSkillRemovals(installed, requestedNames)`, and the final `removeCommand(args)`.

- [ ] **Step 1: Write failing planner and command tests**

Create `tests/cli/remove.test.ts` covering grouping by skill name, deterministic logical locations, explicit uninstalled errors, picker options, confirmation cancellation, non-interactive confirmation enforcement, `--yes` with names, and `--yes` without names.

```ts
it("removes a selected symlink without following its canonical source", async () => {
  const result = await runRemoveCommand(["commit", "--yes", "--global", "--agent", "claude"], deps);
  expect(result).toBe(0);
  expect(lstatExists(claudeLink)).toBe(false);
  expect(existsSync(join(sharedSource, "SKILL.md"))).toBe(true);
});

it("refuses remove --yes without explicit names", async () => {
  await expect(runRemoveCommand(["--yes"], deps)).rejects.toThrow(/requires explicit skill names/i);
  expect(existsSync(installedSkill)).toBe(true);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `bun run test tests/cli/remove.test.ts`

Expected: FAIL because the planner and real removal command do not exist and the old command still prints `coming soon`.

- [ ] **Step 3: Implement removal planning**

Create `src/lib/skill-removals.ts`:

```ts
export interface SkillRemovalPlan {
  locations: InstalledSkill[];
  name: string;
}

export function planSkillRemovals(
  installed: InstalledSkill[],
  requestedNames: string[],
): SkillRemovalPlan[];
```

Group installed entries by skill name and sort names and logical locations. With explicit names, require every requested name to be installed in at least one resolved target. With no names, return all groups for the interactive picker; never interpret that result as authorization to remove all.

- [ ] **Step 4: Implement removal orchestration and confirmation**

Replace `src/commands/remove.ts` with parsed flags for `agent`, `global`, `ruler`, and `yes`. Expose a dependency-injected `runRemoveCommand` for tests and keep the default export wired to real prompts and target resolution.

The command must:

1. Reject `--yes` without positional names.
2. Reject non-interactive use unless both names and `--yes` are present.
3. Resolve roots and inventory installed skills.
4. With no names, multiselect installed skill groups.
5. Print every selected logical location, marking symlinks without following them.
6. Ask `Remove <count> skill(s)?` unless `--yes`.
7. Call `rmSync(location.path, { recursive: true, force: true })` on logical paths only.
8. Leave parent install roots and unrelated canonical sources intact.
9. Reuse `applyRulerAfterChanges` after successful Ruler changes.

Cancellation exits successfully with no deletion.

- [ ] **Step 5: Verify GREEN**

Run: `bun run test tests/cli/remove.test.ts tests/cli/install.test.ts tests/cli/installed-skills.test.ts`

Expected: PASS with explicit confirmation, picker behavior, `--yes` safety, symlink-safe deletion, and target parity.

- [ ] **Step 6: Commit**

```bash
git add src/lib/skill-removals.ts src/commands/remove.ts tests/cli/remove.test.ts
git commit -m "feat(cli): ✨ add confirmed skill removal"
```

### Task 6: Help, Documentation, Release Version, and End-to-End Gate

**Files:**
- Modify: `src/cli.ts`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `tests/cli/help-version.test.ts`
- Modify: `scripts/test-bun-smoke.sh`

**Interfaces:**
- Consumes: completed update and remove commands.
- Produces: discoverable user-facing command syntax and npm package version `0.3.0`.

- [ ] **Step 1: Write failing help and smoke assertions**

Extend `tests/cli/help-version.test.ts` to assert help contains real update/remove descriptions and no `coming soon` text:

```ts
expect(result.stdout).toContain("update [skills...]");
expect(result.stdout).toContain("remove [skills...]");
expect(result.stdout).not.toContain("coming soon");
```

Extend `scripts/test-bun-smoke.sh` with non-mutating safety checks for `remove --yes` without names and help discovery. The remove invocation must exit non-zero and contain `requires explicit skill names`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `bun run test tests/cli/help-version.test.ts && bun run test:bun-smoke`

Expected: FAIL because help still labels update/remove as reserved.

- [ ] **Step 3: Update help, README, and package version**

Change `src/cli.ts` help descriptions to:

```text
remove [skills...]    Remove installed skills with confirmation
update [skills...]    Update installed skills from npm by version
```

Replace README's reserved command bullets with command syntax, supported flags, version source, confirmation rules, interactive examples, `--yes` automation examples, legacy behavior, symlink behavior, and the safety distinction:

```bash
npx @fantechlabs/skills update
npx @fantechlabs/skills update --global --yes
npx @fantechlabs/skills remove commit
npx @fantechlabs/skills remove --global
```

Set the root `package.json` version from `0.2.0` to `0.3.0`; no lockfile version change is expected for the root package.

- [ ] **Step 4: Verify focused GREEN**

Run: `bun run test tests/cli/help-version.test.ts && bun run test:bun-smoke`

Expected: PASS with Node and Bun help/safety behavior.

- [ ] **Step 5: Run complete verification**

Run: `bun run ci:test`

Expected: lint, formatting, typecheck, all Vitest tests, and Bun smoke checks pass with pristine output.

Run: `git diff --check origin/main...HEAD`

Expected: no whitespace errors.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts README.md package.json tests/cli/help-version.test.ts scripts/test-bun-smoke.sh
git commit -m "docs(cli): 📝 document update and remove workflows"
```

### Task 7: Whole-Branch Review, CodeRabbit, and PR Delivery

**Files:**
- Review only unless findings require focused fixes.

**Interfaces:**
- Consumes: Tasks 1-6 and the approved design spec.
- Produces: reviewed branch, pushed remote branch, GitHub PR, GitHub CodeRabbit review, and addressed feedback.

- [ ] **Step 1: Run a whole-branch subagent review**

Create a review package from `origin/main` to `HEAD` and dispatch the final reviewer using `superpowers:requesting-code-review`. Fix every Critical and Important issue with focused regression tests, then re-review until ready.

- [ ] **Step 2: Run local CodeRabbit review**

Run:

```bash
coderabbit review --agent --base main -c .ruler/AGENTS.md
```

Allow the full review window. Parse NDJSON findings, fix all actionable issues with focused tests, commit fixes, and rerun local CodeRabbit until it raises zero unresolved actionable issues.

- [ ] **Step 3: Run final verification after review fixes**

Run: `bun run ci:test`

Expected: complete suite passes after all review-driven changes.

- [ ] **Step 4: Create and push the PR branch**

Follow the repository PR skill exactly:

```bash
bun pr/scripts/create.ts --dry-run
git push -u origin uzee/versioned-update-remove
bun pr/scripts/create.ts --ci --target main --title "Add versioned skill update and remove commands"
```

Use a concise body summarizing npm-backed independent versions, confirmed update/remove behavior, safety guarantees, and `bun run ci:test` evidence. Create the PR ready for review, not draft.

- [ ] **Step 5: Obtain and address GitHub CodeRabbit review**

Wait for the CodeRabbit GitHub check/review to complete. Read all review comments and checks, adjudicate each against current code, fix actionable feedback with failing regression tests first, commit and push, and reply or resolve false positives with concrete evidence. Repeat until CodeRabbit's latest GitHub review has no unresolved actionable feedback and required checks are green.

- [ ] **Step 6: Completion audit**

Verify current evidence for every design requirement: skill metadata, repository rule, npm latest/integrity behavior, target parity, interactive and `--yes` behavior, symlink semantics, dependency handling, cleanup, help/docs, package `0.3.0`, full tests, local CodeRabbit, PR URL, GitHub CodeRabbit, and checks. Only then report completion.
