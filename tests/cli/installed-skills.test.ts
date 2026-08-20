import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { findInstalledSkills } from "../../src/lib/installed-skills.js";
import { cleanupTempProject, createTempProject } from "../utils/fs";

const tempProjects: string[] = [];

afterEach(() => {
  while (tempProjects.length > 0) {
    cleanupTempProject(tempProjects.pop()!);
  }
});

function makeTempProject(): string {
  const temp = realpathSync(createTempProject());
  tempProjects.push(temp);
  return temp;
}

function writeSkill(skillDir: string, frontmatter: string): void {
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(skillDir + "/SKILL.md", `---\n${frontmatter}\n---\n`, "utf-8");
}

describe("findInstalledSkills", () => {
  it("records logical and canonical paths without collapsing symlinks", () => {
    const cwd = makeTempProject();
    const agentsRoot = join(cwd, ".agents", "skills");
    const claudeRoot = join(cwd, ".claude", "skills");
    const cursorRoot = join(cwd, ".cursor", "skills");
    const sourceDir = join(cwd, "sources", "commit");

    writeSkill(join(agentsRoot, "commit"), "name: commit\nversion: 1.0.0");
    writeSkill(sourceDir, "name: commit\nversion: 2.0.0");
    mkdirSync(claudeRoot, { recursive: true });
    mkdirSync(cursorRoot, { recursive: true });
    symlinkSync(sourceDir, join(claudeRoot, "commit"));
    symlinkSync(sourceDir, join(cursorRoot, "commit"));

    const installed = findInstalledSkills([agentsRoot, claudeRoot, cursorRoot]);

    expect(installed.filter((entry) => entry.name === "commit")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          installRoot: agentsRoot,
          isSymlink: false,
          version: "1.0.0",
        }),
        expect.objectContaining({
          installRoot: claudeRoot,
          isSymlink: true,
          canonicalPath: sourceDir,
        }),
        expect.objectContaining({
          installRoot: cursorRoot,
          isSymlink: true,
          canonicalPath: sourceDir,
        }),
      ]),
    );
  });

  it("keeps legacy skills with an undefined version", () => {
    const cwd = makeTempProject();
    const agentsRoot = join(cwd, ".agents", "skills");

    writeSkill(join(agentsRoot, "legacy"), "name: legacy");

    expect(findInstalledSkills([agentsRoot])).toContainEqual(
      expect.objectContaining({ name: "legacy", version: undefined }),
    );
  });

  it("deduplicates roots, skips unreadable entries, and sorts by name then logical path", () => {
    const cwd = makeTempProject();
    const agentsRoot = join(cwd, ".agents", "skills");
    const claudeRoot = join(cwd, ".claude", "skills");

    writeSkill(join(agentsRoot, "zebra"), "name: zebra\nversion: 1.0.0");
    writeSkill(join(agentsRoot, "alpha"), "name: alpha\nversion: 1.0.0");
    writeSkill(join(claudeRoot, "alpha"), "name: alpha\nversion: 2.0.0");
    mkdirSync(claudeRoot, { recursive: true });
    symlinkSync(join(cwd, "missing"), join(claudeRoot, "dangling"));
    mkdirSync(join(claudeRoot, "not-a-skill"), { recursive: true });

    const installed = findInstalledSkills([agentsRoot, claudeRoot, agentsRoot]);

    expect(installed.map((entry) => [entry.name, entry.path])).toEqual([
      ["alpha", join(agentsRoot, "alpha")],
      ["alpha", join(claudeRoot, "alpha")],
      ["zebra", join(agentsRoot, "zebra")],
    ]);
  });
});
