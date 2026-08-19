import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { findMonorepoRoot } from "../../skills/changeset/scripts/lib/runtime";
import { cleanupTempProject, createTempProject } from "../utils/fs";

const tempProjects: string[] = [];

afterEach(() => {
  while (tempProjects.length > 0) {
    const tempProject = tempProjects.pop();
    if (tempProject) {
      cleanupTempProject(tempProject);
    }
  }
});

function setupTempProject(prefix: string): string {
  const tempProject = createTempProject(prefix);
  tempProjects.push(tempProject);
  return tempProject;
}

describe("changeset runtime root detection", () => {
  it("finds monorepo root from package.json workspaces", () => {
    const project = setupTempProject("changeset-runtime-");

    writeFileSync(
      join(project, "package.json"),
      JSON.stringify(
        {
          name: "repo",
          private: true,
          workspaces: ["packages/*"],
        },
        null,
        2,
      ),
    );

    const nestedDir = join(project, "packages", "ui", "src");
    mkdirSync(nestedDir, { recursive: true });

    expect(findMonorepoRoot(nestedDir)).toBe(project);
  });
});
