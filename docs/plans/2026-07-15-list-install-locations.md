# Harness-Aware Skill List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `skills list` discover local and global skill installations and report each installation's scope, compatible harnesses, and path with a single-line description.

**Architecture:** Replace the current map of skill names to bare directories with structured installation locations produced by `src/lib/skills.ts`. Keep discovery separate from presentation; `src/commands/list.ts` formats the structured results into compact terminal output.

**Tech Stack:** TypeScript, Node.js filesystem/path APIs, Bun, Vitest

## Global Constraints

- Search both the current project and the user's home-level agent directories by default.
- Report `not installed` only when neither scope contains the skill.
- Every discovered location identifies `Local` or `Global`, compatible harness names, and the skill path.
- Local locations appear before global locations in stable root order.
- `.agents/skills` represents Codex, OpenCode, Pi, Hermes, and OpenClaw; narrow local shared-root labels to detected compatible harnesses when possible.
- Report configured roots separately even when one is a symlink to another root.
- Normalize description whitespace and truncate descriptions to at most 60 characters, including a trailing `…` when shortened.
- Do not change install behavior or bundled skill contents.

---

### Task 1: Structured Local and Global Discovery

**Files:**
- Modify: `src/lib/agents.ts`
- Modify: `src/lib/skills.ts`
- Create: `tests/cli/skill-discovery.test.ts`

**Interfaces:**
- Consumes: `detectAgents(cwd: string): AgentInfo[]` and the existing supported-agent registry.
- Produces: `getSharedAgentNames(cwd?: string): string[]`.
- Produces: `SkillInstallScope`, `SkillInstallLocation`, and `findInstalledSkills(cwd: string, homeDir?: string): Map<string, SkillInstallLocation[]>`.

- [ ] **Step 1: Write failing discovery tests**

Create `tests/cli/skill-discovery.test.ts` using the existing temporary-project helpers. Write real filesystem fixtures and assert:

```ts
const installed = findInstalledSkills(project, home);

expect(installed.get("commit")).toEqual([
  {
    scope: "local",
    harnesses: ["Claude Code"],
    baseDir: join(project, ".claude", "skills"),
    skillPath: join(project, ".claude", "skills", "commit"),
  },
  {
    scope: "global",
    harnesses: ["Codex", "OpenCode", "Pi", "Hermes", "OpenClaw"],
    baseDir: join(home, ".agents", "skills"),
    skillPath: join(home, ".agents", "skills", "commit"),
  },
]);
```

Add separate cases proving that:

```ts
// A local .agents root narrows to the detected compatible harness.
expect(installed.get("review")?.[0].harnesses).toEqual(["Codex"]);

// Without a detected local harness, .agents reports the full compatibility list.
expect(installed.get("handoff")?.[0].harnesses).toEqual([
  "Codex",
  "OpenCode",
  "Pi",
  "Hermes",
  "OpenClaw",
]);

// A generic ~/skills directory is not treated as a global agent install.
expect(installed.has("release")).toBe(false);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
bun test tests/cli/skill-discovery.test.ts
```

Expected: FAIL because the structured location fields and optional home directory do not exist yet.

- [ ] **Step 3: Export shared harness names from the agent registry**

In `src/lib/agents.ts`, add this public helper so the compatibility list remains derived from `KNOWN_AGENTS`:

```ts
export function getSharedAgentNames(cwd?: string): string[] {
  const compatibleAgents = KNOWN_AGENTS.filter((agent) => agent.supportsAgentsDir);
  if (!cwd) {
    return compatibleAgents.map((agent) => agent.name);
  }

  const detected = detectAgents(cwd).filter((agent) => agent.supportsAgentsDir);
  return (detected.length > 0 ? detected : compatibleAgents).map((agent) => agent.name);
}
```

- [ ] **Step 4: Implement structured discovery**

In `src/lib/skills.ts`, import `homedir` and `getSharedAgentNames`, then replace the bare-string result with:

```ts
export type SkillInstallScope = "local" | "global";

export interface SkillInstallLocation {
  scope: SkillInstallScope;
  harnesses: string[];
  baseDir: string;
  skillPath: string;
}
```

Build stable local search roots for `skills`, `.ruler/skills`, `.agents/skills`, `.claude/skills`, `.cursor/skills`, `.codex/skills`, and `.opencode/skills`. Build global roots beneath `homeDir` for `.agents/skills`, `.claude/skills`, `.cursor/skills`, `.codex/skills`, `.opencode/skills`, and `.ruler/skills`. Use these labels:

```ts
Generic
Ruler
Claude Code
Cursor
Codex
OpenCode
```

Use `getSharedAgentNames(cwd)` for local `.agents/skills` and `getSharedAgentNames()` for global `.agents/skills`. For every child directory or symlink containing `SKILL.md`, append a complete `SkillInstallLocation` to that skill name's array. Keep local roots before global roots and preserve the declared root order.

If `cwd` and `homeDir` resolve to the same directory, omit the local home-level agent roots that are also global roots so a physical root is reported once as `Global`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
bun test tests/cli/skill-discovery.test.ts tests/cli/install.test.ts
```

Expected: PASS, including existing install behavior coverage.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/lib/agents.ts src/lib/skills.ts tests/cli/skill-discovery.test.ts
git commit -m "feat(list): ✨ discover local and global skill installs"
```

---

### Task 2: Compact Harness-Aware List Rendering

**Files:**
- Modify: `src/commands/list.ts`
- Modify: `tests/cli/list.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `findInstalledSkills(cwd, homeDir)` and `SkillInstallLocation` from Task 1.
- Produces: `formatSkillDescription(description: string, maxLength?: number): string`.
- Produces: CLI output containing a compact summary, a one-line description, and one scope/harness/path block per location.

- [ ] **Step 1: Write failing CLI rendering tests**

Extend `tests/cli/list.test.ts` with temporary project and home fixtures. Install a fake `commit/SKILL.md` under local `.claude/skills` and global `.agents/skills`, then run the real CLI with the fixture directory as `cwd` and its home as `HOME`.

Assert the output includes:

```ts
expect(result.stdout).toContain("installed (2 locations)");
expect(result.stdout).toContain("Local · Claude Code");
expect(result.stdout).toContain(".claude/skills/commit");
expect(result.stdout).toContain("Global · Codex, OpenCode, Pi, Hermes, OpenClaw");
expect(result.stdout).toContain("~/.agents/skills/commit");
```

Add a test for a missing bundled skill that extracts its summary line and confirms it contains `not installed`. Add direct formatter coverage:

```ts
expect(formatSkillDescription("  short   description  ")).toBe("short description");
expect(formatSkillDescription("x".repeat(61))).toBe(`${"x".repeat(59)}…`);
expect(formatSkillDescription("x".repeat(60))).toBe("x".repeat(60));
```

Finally, locate each printed description line and assert it contains no embedded newline and its description payload is at most 60 characters.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
bun test tests/cli/list.test.ts
```

Expected: FAIL because global locations, harness labels, paths, and description truncation are not rendered yet.

- [ ] **Step 3: Implement compact rendering**

In `src/commands/list.ts`, import `homedir`, `relative`, and the structured location type. Add:

```ts
const DESCRIPTION_MAX_LENGTH = 60;

export function formatSkillDescription(
  description: string,
  maxLength: number = DESCRIPTION_MAX_LENGTH,
): string {
  const normalized = description.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}
```

Call `findInstalledSkills(process.cwd(), homedir())`. Preserve the existing `installed (N locations)` status and runnable/docs-only label. Print the normalized, truncated description once. For every location, print its capitalized scope and comma-separated harnesses on one line, followed by its display path on the next line.

Format local paths relative to `cwd`, without adding `./`. Format global paths relative to `homeDir` and prefix them with `~/`. Normalize path separators to `/` for stable output.

- [ ] **Step 4: Update the README command description**

Change the `skills list` command summary in `README.md` to state that it reports local/global scope, harness, location, and runnable status. Keep the README entry to one line.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
bun test tests/cli/list.test.ts tests/cli/skill-discovery.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run task-wide checks**

Run:

```bash
bun run typecheck
bun run lint
bun run format:check
```

Expected: all commands exit 0. If formatting fails, run `bun run format` only on the changed source/test files, then repeat the checks.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/commands/list.ts tests/cli/list.test.ts README.md
git commit -m "feat(list): ✨ show install scope and harness locations"
```

---

## Final Verification

After both reviewed tasks are complete, run:

```bash
bun run ci:test
bun run skills list
```

Confirm that all checks pass and that the real CLI reports the existing global installs with one-line descriptions and explicit global harness/path details.
