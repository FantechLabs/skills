import { describe, expect, it } from "vitest";

import { wrapCommitBody } from "../../commit/scripts/lib/body";

describe("wrapCommitBody", () => {
  it("keeps short lines unchanged", () => {
    const input = "Short summary line.";
    expect(wrapCommitBody(input, 100)).toBe(input);
  });

  it("wraps long text on word boundaries to fit max line length", () => {
    const input =
      "For multi-command skills, default script determines the base command run if no subcommand is specified and keeps behavior explicit.";
    const wrapped = wrapCommitBody(input, 60);
    const lines = wrapped.split("\n");

    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(60);
    }
  });

  it("preserves explicit paragraph breaks", () => {
    const input =
      "First paragraph should wrap because this sentence is long enough to exceed the configured limit.\n\nSecond paragraph stays separate.";
    const wrapped = wrapCommitBody(input, 55);
    const lines = wrapped.split("\n");

    expect(lines).toContain("");
    expect(lines[0]).toBe("First paragraph should wrap because this sentence is");
  });

  it("keeps long unbreakable words on a single line", () => {
    const word = "x".repeat(120);
    const wrapped = wrapCommitBody(word, 100);

    expect(wrapped).toBe(word);
  });
});
