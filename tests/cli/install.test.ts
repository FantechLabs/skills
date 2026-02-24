import { existsSync, lstatSync, mkdirSync, readlinkSync } from "node:fs";
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

  it("installs globally only for detected agent directories", () => {
    const cwd = makeTempProject();
    const home = makeTempProject();
    mkdirSync(join(home, ".agents"), { recursive: true });
    mkdirSync(join(home, ".cursor"), { recursive: true });

    const result = runNodeCli(["install", "commit", "--yes", "--global"], {
      cwd,
      env: { HOME: home },
    });

    expect(result.status).toBe(0);
    expect(existsSync(join(home, ".agents", "skills", "commit", "SKILL.md"))).toBe(true);
    expect(existsSync(join(home, ".cursor", "skills", "commit", "SKILL.md"))).toBe(true);
    expect(existsSync(join(home, ".claude", "skills", "commit", "SKILL.md"))).toBe(false);
  });

  it("fails global install when no supported agent directories are detected", () => {
    const cwd = makeTempProject();
    const home = makeTempProject();

    const result = runNodeCli(["install", "commit", "--yes", "--global"], {
      cwd,
      env: { HOME: home },
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain(
      "No supported global agent directories found",
    );
  });

  it("fails explicit global targets that are not installed", () => {
    const cwd = makeTempProject();
    const home = makeTempProject();
    mkdirSync(join(home, ".agents"), { recursive: true });

    const result = runNodeCli(["install", "commit", "--yes", "--global", "--agent", "cursor"], {
      cwd,
      env: { HOME: home },
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain(
      "None of the requested global agent targets are installed.",
    );
  });

  it("supports global symlink mode for detected Claude and Cursor", () => {
    const cwd = makeTempProject();
    const home = makeTempProject();
    mkdirSync(join(home, ".agents"), { recursive: true });
    mkdirSync(join(home, ".claude"), { recursive: true });
    mkdirSync(join(home, ".cursor"), { recursive: true });

    const result = runNodeCli(["install", "commit", "--yes", "--global", "--symlink"], {
      cwd,
      env: { HOME: home },
    });

    expect(result.status).toBe(0);

    const source = join(home, ".agents", "skills", "commit");
    const claudeTarget = join(home, ".claude", "skills", "commit");
    const cursorTarget = join(home, ".cursor", "skills", "commit");

    expect(existsSync(join(source, "SKILL.md"))).toBe(true);
    expect(lstatSync(claudeTarget).isSymbolicLink()).toBe(true);
    expect(lstatSync(cursorTarget).isSymbolicLink()).toBe(true);
    expect(readlinkSync(claudeTarget)).toBe(source);
    expect(readlinkSync(cursorTarget)).toBe(source);
  });

  it("supports explicit global symlink target while using ~/.agents as source", () => {
    const cwd = makeTempProject();
    const home = makeTempProject();
    mkdirSync(join(home, ".agents"), { recursive: true });
    mkdirSync(join(home, ".claude"), { recursive: true });

    const result = runNodeCli(
      ["install", "commit", "--yes", "--global", "--symlink", "--agent", "claude"],
      {
        cwd,
        env: { HOME: home },
      },
    );

    expect(result.status).toBe(0);

    const source = join(home, ".agents", "skills", "commit");
    const claudeTarget = join(home, ".claude", "skills", "commit");
    const cursorTarget = join(home, ".cursor", "skills", "commit");

    expect(existsSync(join(source, "SKILL.md"))).toBe(true);
    expect(lstatSync(claudeTarget).isSymbolicLink()).toBe(true);
    expect(readlinkSync(claudeTarget)).toBe(source);
    expect(existsSync(cursorTarget)).toBe(false);
  });
});
