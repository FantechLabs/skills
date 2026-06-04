import { readFileSync } from "node:fs";
import { join } from "node:path";

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

  it("includes the pickup handoff workflow", () => {
    const bundled = discoverBundledSkills();

    expect(bundled.map((skill) => skill.name)).toContain("pick-up");
  });

  it("requires pickup confirmation before reading handoff contents", () => {
    const content = readFileSync(join(process.cwd(), "pick-up", "SKILL.md"), "utf-8");

    expect(content).toContain("Do not read or load the file before confirmation.");
  });

  it("requires descriptive handoff filenames for pickup selection", () => {
    const content = readFileSync(join(process.cwd(), "handoff", "SKILL.md"), "utf-8");

    expect(content).toContain("YYYY-MM-DD-HHMM-<project>-<focus-slug>.md");
    expect(content).toContain("Do not use timestamp-only or generic names.");
  });

  it("matches pickup candidates by filename before recency fallback", () => {
    const content = readFileSync(join(process.cwd(), "pick-up", "SKILL.md"), "utf-8");

    expect(content).toContain(
      "Match filename words against the user's request/context before using recency.",
    );
  });
});
