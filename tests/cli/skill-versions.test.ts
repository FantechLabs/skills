import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  compareStableVersions,
  discoverBundledSkills,
  parseStableVersion,
} from "../../src/lib/skills";
import { cleanupTempProject, createTempProject } from "../utils/fs";

describe("skill versions", () => {
  it("discovers bundled skills from the package skills directory", () => {
    const root = createTempProject();
    const skillDir = join(root, "skills", "example");

    try {
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        "---\nname: example\nversion: 1.0.0\ndescription: Example\n---\n",
      );

      expect(discoverBundledSkills(root).map((skill) => skill.name)).toEqual(["example"]);
    } finally {
      cleanupTempProject(root);
    }
  });

  it("requires a stable semantic version on every bundled skill", () => {
    const skills = discoverBundledSkills();
    for (const skill of skills) {
      expect(skill.version).toMatch(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
    }
  });

  it("rejects a bundled skill with missing version metadata", () => {
    const root = createTempProject();
    try {
      mkdirSync(join(root, "skills", "example"), { recursive: true });
      writeFileSync(
        join(root, "skills", "example", "SKILL.md"),
        "---\nname: example\ndescription: Example\n---\n",
      );
      expect(() => discoverBundledSkills(root)).toThrow(/missing version/i);
    } finally {
      cleanupTempProject(root);
    }
  });

  it("orders stable semantic versions numerically", () => {
    expect(
      compareStableVersions(
        parseStableVersion("1.9.0", "left"),
        parseStableVersion("1.10.0", "right"),
      ),
    ).toBeLessThan(0);
    expect(
      compareStableVersions(
        parseStableVersion("2.0.0", "left"),
        parseStableVersion("1.99.99", "right"),
      ),
    ).toBeGreaterThan(0);
  });

  it("rejects semantic version components above the safe integer range", () => {
    expect(() => parseStableVersion("9007199254740992.0.0", "example")).toThrow(
      /invalid skill version/i,
    );
  });
});
