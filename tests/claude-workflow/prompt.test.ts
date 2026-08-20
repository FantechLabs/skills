// tests/claude-workflow/prompt.test.ts
import { describe, expect, it } from "vite-plus/test";

import { composePrompt, PROMPT_SEPARATOR } from "../../skills/claude-workflow/scripts/lib/prompt";

describe("composePrompt", () => {
  it("places the caller prompt verbatim after the separator", () => {
    const caller = "# My task\n\nDo the thing.";
    const composed = composePrompt(caller, "explore");
    const [, after] = composed.split(PROMPT_SEPARATOR);
    expect(after.trim()).toBe(caller.trim());
  });

  it("includes the explicit workflow opt-in", () => {
    expect(composePrompt("x", "explore")).toContain("Workflow tool");
    expect(composePrompt("x", "explore")).toContain(
      "explicitly requests multi-agent orchestration",
    );
  });

  it("includes the explore mode contract for explore mode", () => {
    const composed = composePrompt("x", "explore");
    expect(composed).toContain("Mode: EXPLORE (read-only)");
    expect(composed).not.toContain("Mode: BUILD");
  });

  it("includes the build mode contract for build mode", () => {
    const composed = composePrompt("x", "build");
    expect(composed).toContain("Mode: BUILD (read-write)");
    expect(composed).not.toContain("Mode: EXPLORE");
  });

  it("includes the web-safety and output-contract rules", () => {
    const composed = composePrompt("x", "build");
    expect(composed).toContain("untrusted data");
    expect(composed).toContain("final message is captured verbatim");
  });

  it("states that caller instructions win on conflict", () => {
    expect(composePrompt("x", "explore")).toContain("task instructions below win");
  });
});
