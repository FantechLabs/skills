import { existsSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

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

describe("install command", () => {
  it("installs a selected skill into .agents/skills by default", () => {
    const cwd = makeTempProject();
    const result = runNodeCli(["install", "commit", "--yes"], { cwd });

    expect(result.status).toBe(0);
    expect(existsSync(join(cwd, ".agents", "skills", "commit", "SKILL.md"))).toBe(true);
  });

  it("supports explicit agent target", () => {
    const cwd = makeTempProject();
    const result = runNodeCli(["install", "commit", "--yes", "--agent", "claude"], { cwd });

    expect(result.status).toBe(0);
    expect(existsSync(join(cwd, ".claude", "skills", "commit", "SKILL.md"))).toBe(true);
  });

  it("supports ruler install target", () => {
    const cwd = makeTempProject();
    const result = runNodeCli(["install", "commit", "--yes", "--ruler"], { cwd });

    expect(result.status).toBe(0);
    expect(existsSync(join(cwd, ".ruler", "skills", "commit", "SKILL.md"))).toBe(true);
  });

  it("fails on unknown skills", () => {
    const cwd = makeTempProject();
    const result = runNodeCli(["install", "not-a-skill", "--yes"], { cwd });

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("Unknown skill");
  });
});
