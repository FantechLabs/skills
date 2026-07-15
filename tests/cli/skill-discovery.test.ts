import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { findInstalledSkills } from "../../src/lib/skills";
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

describe("installed skill discovery", () => {
  it("returns structured local and global locations in stable scope order", () => {
    const project = makeTempProject();
    const home = makeTempProject();
    createInstalledSkill(join(project, ".claude", "skills"), "commit");
    createInstalledSkill(join(home, ".agents", "skills"), "commit");

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
  });

  it("narrows a local shared root to the detected compatible harness", () => {
    const project = makeTempProject();
    const home = makeTempProject();
    mkdirSync(join(project, ".codex"), { recursive: true });
    createInstalledSkill(join(project, ".agents", "skills"), "review");

    const installed = findInstalledSkills(project, home);

    expect(installed.get("review")?.[0].harnesses).toEqual(["Codex"]);
  });

  it("reports every compatible harness when no local shared harness is detected", () => {
    const project = makeTempProject();
    const home = makeTempProject();
    createInstalledSkill(join(project, ".agents", "skills"), "handoff");

    const installed = findInstalledSkills(project, home);

    expect(installed.get("handoff")?.[0].harnesses).toEqual([
      "Codex",
      "OpenCode",
      "Pi",
      "Hermes",
      "OpenClaw",
    ]);
  });

  it("does not treat a generic home skills directory as a global agent install", () => {
    const project = makeTempProject();
    const home = makeTempProject();
    createInstalledSkill(join(home, "skills"), "release");

    const installed = findInstalledSkills(project, home);

    expect(installed.has("release")).toBe(false);
  });

  it("reports overlapping home-level agent roots only once as global", () => {
    const home = makeTempProject();
    createInstalledSkill(join(home, ".cursor", "skills"), "pick-up");

    const installed = findInstalledSkills(home, home);

    expect(installed.get("pick-up")).toEqual([
      {
        scope: "global",
        harnesses: ["Cursor"],
        baseDir: join(home, ".cursor", "skills"),
        skillPath: join(home, ".cursor", "skills", "pick-up"),
      },
    ]);
  });
});
