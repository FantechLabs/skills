import { describe, expect, it } from "vitest";

import { discoverBundledSkills } from "../../src/lib/skills";
import { runNodeCli } from "../utils/exec";

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
});
