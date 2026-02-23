import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runNodeCli } from "../utils/exec";
import { cleanupTempProject, createTempProject } from "../utils/fs";

describe("skill entrypoint smoke tests", () => {
  it("runs commit help", () => {
    const result = runNodeCli(["run", "commit", "--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: commit");
  });

  it("runs release help", () => {
    const result = runNodeCli(["run", "release", "--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: release");
  });

  it("supports commit dry-run JSON", () => {
    const result = runNodeCli([
      "run",
      "commit",
      "--dry-run",
      "--type",
      "feat",
      "--message",
      "test dry run",
    ]);

    expect(result.status).toBe(0);

    const normalized = result.stdout.trim();
    let payload: { type: string; description: string };

    try {
      payload = JSON.parse(normalized) as { type: string; description: string };
    } catch {
      throw new Error(
        `Failed to parse dry-run JSON (status=${result.status}). Raw stdout:\n${result.stdout}`,
      );
    }

    expect(payload.type).toBe("feat");
    expect(payload.description).toBe("test dry run");
  });

  it("fails CI commit mode when no files are staged", () => {
    const temp = createTempProject();

    try {
      execSync("git init", { cwd: temp, stdio: "pipe" });
      execSync("git branch -m main", { cwd: temp, stdio: "pipe" });
      execSync('git config user.email "tests@example.com"', { cwd: temp, stdio: "pipe" });
      execSync('git config user.name "Test Runner"', { cwd: temp, stdio: "pipe" });

      writeFileSync(join(temp, "README.md"), "# temp\n");
      execSync("git add README.md", { cwd: temp, stdio: "pipe" });
      execSync('git commit -m "chore: initial"', { cwd: temp, stdio: "pipe" });

      const result = runNodeCli(["run", "commit", "--ci", "--type", "chore", "--message", "test"], {
        cwd: temp,
      });

      expect(result.status).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toContain("No staged files found");
    } finally {
      cleanupTempProject(temp);
    }
  });
});
