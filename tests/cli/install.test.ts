import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

function createFakePackageManager(projectDir: string, commandName: string): string {
  const binDir = join(projectDir, "bin");
  const commandPath = join(binDir, commandName);

  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    commandPath,
    `#!/usr/bin/env node
const { appendFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");

appendFileSync(process.env.SKILLS_PM_LOG, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }) + "\\n");
mkdirSync(join(process.cwd(), "node_modules", "@clack", "prompts"), { recursive: true });
`,
    "utf-8",
  );
  chmodSync(commandPath, 0o755);

  return binDir;
}

describe("install command", () => {
  it("installs a selected skill into .agents/skills by default", () => {
    const cwd = makeTempProject();
    const result = runNodeCli(["install", "commit", "--yes", "--skip-deps"], { cwd });

    expect(result.status).toBe(0);
    expect(existsSync(join(cwd, ".agents", "skills", "commit", "SKILL.md"))).toBe(true);
  });

  it("supports explicit agent target", () => {
    const cwd = makeTempProject();
    const result = runNodeCli(["install", "commit", "--yes", "--skip-deps", "--agent", "claude"], {
      cwd,
    });

    expect(result.status).toBe(0);
    expect(existsSync(join(cwd, ".claude", "skills", "commit", "SKILL.md"))).toBe(true);
  });

  it("supports ruler install target", () => {
    const cwd = makeTempProject();
    const result = runNodeCli(["install", "commit", "--yes", "--skip-deps", "--ruler"], { cwd });

    expect(result.status).toBe(0);
    expect(existsSync(join(cwd, ".ruler", "skills", "commit", "SKILL.md"))).toBe(true);
  });

  it("fails on unknown skills", () => {
    const cwd = makeTempProject();
    const result = runNodeCli(["install", "not-a-skill", "--yes"], { cwd });

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("Unknown skill");
  });

  it("installs copied skill dependencies with the detected package manager by default", () => {
    const cwd = makeTempProject();
    const logFile = join(cwd, "pm.log");
    const fakeBinDir = createFakePackageManager(cwd, "npm");

    writeFileSync(join(cwd, "package-lock.json"), "{}\n", "utf-8");

    const result = runNodeCli(["install", "commit", "--yes"], {
      cwd,
      env: {
        PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
        SKILLS_PM_LOG: logFile,
      },
    });

    expect(result.status).toBe(0);
    expect(existsSync(join(cwd, ".agents", "skills", "commit", "scripts", "node_modules"))).toBe(
      true,
    );

    const installs = readFileSync(logFile, "utf-8").trim().split("\n").map(JSON.parse);
    expect(installs).toHaveLength(1);
    expect(installs[0].args).toEqual(["install"]);
    expect(installs[0].cwd.replace(/^\/private/, "")).toBe(
      join(cwd, ".agents", "skills", "commit", "scripts").replace(/^\/private/, ""),
    );
  });

  it("supports skipping dependency installation", () => {
    const cwd = makeTempProject();
    const logFile = join(cwd, "pm.log");
    const fakeBinDir = createFakePackageManager(cwd, "npm");

    writeFileSync(join(cwd, "package-lock.json"), "{}\n", "utf-8");

    const result = runNodeCli(["install", "commit", "--yes", "--skip-deps"], {
      cwd,
      env: {
        PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
        SKILLS_PM_LOG: logFile,
      },
    });

    expect(result.status).toBe(0);
    expect(existsSync(logFile)).toBe(false);
    expect(existsSync(join(cwd, ".agents", "skills", "commit", "scripts", "node_modules"))).toBe(
      false,
    );
  });

  it("reports local skill updates before reinstalling changed skills", () => {
    const cwd = makeTempProject();

    const firstInstall = runNodeCli(["install", "commit", "--yes", "--skip-deps"], { cwd });
    expect(firstInstall.status).toBe(0);

    writeFileSync(
      join(cwd, ".agents", "skills", "commit", "SKILL.md"),
      "---\nname: commit\ndescription: locally modified\n---\n",
      "utf-8",
    );

    const reinstall = runNodeCli(["install", "commit", "--yes", "--skip-deps"], { cwd });

    expect(reinstall.status).toBe(0);
    expect(reinstall.stdout).toContain("update available");
    expect(reinstall.stdout).toContain("SKILL.md");
  });
});
