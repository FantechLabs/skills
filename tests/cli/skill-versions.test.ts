import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  compareStableVersions,
  discoverBundledSkills,
  parseStableVersion,
} from "../../src/lib/skills";
import { cleanupTempProject, createTempProject } from "../utils/fs";

describe("skill versions", () => {
  it("requires a stable semantic version on every bundled skill", () => {
    const skills = discoverBundledSkills();
    expect(skills.map((skill) => skill.version)).toEqual(skills.map(() => "1.0.0"));
    for (const skill of skills) {
      expect(skill.version).toMatch(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
    }
  });

  it("rejects a bundled skill with missing version metadata", () => {
    const root = createTempProject();
    mkdirSync(join(root, "example"));
    writeFileSync(
      join(root, "example", "SKILL.md"),
      "---\nname: example\ndescription: Example\n---\n",
    );
    expect(() => discoverBundledSkills(root)).toThrow(/missing version/i);
    cleanupTempProject(root);
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
});
