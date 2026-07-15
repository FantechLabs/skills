import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { formatSkillDescription } from "../../src/commands/list";
import { discoverBundledSkills } from "../../src/lib/skills";
import { runNodeCli } from "../utils/exec";
import { cleanupTempProject, createTempProject } from "../utils/fs";

const tempProjects: string[] = [];

afterEach(() => {
  while (tempProjects.length > 0) {
    cleanupTempProject(tempProjects.pop()!);
  }
});

function makeTempProject(): string {
  const temp = createTempProject();
  tempProjects.push(temp);
  return temp;
}

function createInstalledSkill(baseDir: string, skillName: string): void {
  const skillDir = join(baseDir, skillName);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), `---\nname: ${skillName}\n---\n`, "utf-8");
}

describe("list command", () => {
  it("prints bundled skills", () => {
    const result = runNodeCli(["list"]);
    const bundled = discoverBundledSkills();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Available skills:");

    for (const skill of bundled) {
      expect(result.stdout).toContain(skill.name);
    }
  });

  it("prints scope, harnesses, and paths for every installed location", () => {
    const project = makeTempProject();
    const home = makeTempProject();
    createInstalledSkill(join(project, ".claude", "skills"), "commit");
    createInstalledSkill(join(home, ".agents", "skills"), "commit");

    const result = runNodeCli(["list"], { cwd: project, env: { HOME: home } });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("installed (2 locations)");
    expect(result.stdout).toContain("Local · Claude Code");
    expect(result.stdout).toContain(".claude/skills/commit");
    expect(result.stdout).toContain("Global · Codex, OpenCode, Pi, Hermes, OpenClaw");
    expect(result.stdout).toContain("~/.agents/skills/commit");
  });

  it("reports a missing bundled skill as not installed", () => {
    const project = makeTempProject();
    const home = makeTempProject();
    const [bundledSkill] = discoverBundledSkills();

    const result = runNodeCli(["list"], { cwd: project, env: { HOME: home } });
    const summaryLine = result.stdout
      .split("\n")
      .find((line) => line.trimStart().startsWith(`${bundledSkill.name} `));

    expect(result.status).toBe(0);
    expect(summaryLine).toContain("not installed");
  });

  it("normalizes and truncates skill descriptions", () => {
    expect(formatSkillDescription("  short   description  ")).toBe("short description");
    expect(formatSkillDescription("x".repeat(61))).toBe(`${"x".repeat(59)}…`);
    expect(formatSkillDescription("x".repeat(60))).toBe("x".repeat(60));
  });

  it("prints every description on one line with at most 60 characters", () => {
    const project = makeTempProject();
    const home = makeTempProject();
    const bundled = discoverBundledSkills();

    const result = runNodeCli(["list"], { cwd: project, env: { HOME: home } });
    const outputLines = result.stdout.split("\n");

    expect(result.status).toBe(0);
    for (const skill of bundled) {
      const summaryIndex = outputLines.findIndex((line) =>
        line.trimStart().startsWith(`${skill.name} `),
      );
      const descriptionLine = outputLines[summaryIndex + 1];
      const descriptionPayload = descriptionLine.trim();

      expect(summaryIndex).toBeGreaterThanOrEqual(0);
      expect(descriptionLine).not.toMatch(/[\r\n]/);
      expect(descriptionPayload.length).toBeLessThanOrEqual(60);
    }
  });

  it("includes the pickup handoff workflow", () => {
    const bundled = discoverBundledSkills();

    expect(bundled.map((skill) => skill.name)).toContain("pick-up");
  });

  it("requires pickup confirmation before reading handoff contents", () => {
    const content = readFileSync(join(process.cwd(), "pick-up", "SKILL.md"), "utf-8");

    expect(content).toContain("Do not read or load the file before confirmation.");
  });

  it("requires descriptive handoff filenames for pickup selection", () => {
    const content = readFileSync(join(process.cwd(), "handoff", "SKILL.md"), "utf-8");

    expect(content).toContain("YYYY-MM-DD-HHMM-<project>-<focus-slug>.md");
    expect(content).toContain("Do not use timestamp-only or generic names.");
  });

  it("matches pickup candidates by filename before recency fallback", () => {
    const content = readFileSync(join(process.cwd(), "pick-up", "SKILL.md"), "utf-8");

    expect(content).toContain(
      "Match filename words against the user's request/context before using recency.",
    );
  });
});
