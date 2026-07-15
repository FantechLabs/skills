import { describe, expect, it } from "vitest";

import {
  buildClaudeArgs,
  EXPLORE_ALLOWED_TOOLS,
  EXPLORE_DISALLOWED_TOOLS,
} from "../../claude-workflow/scripts/lib/modes";

describe("explore allowlist", () => {
  it("matches the spec verbatim", () => {
    expect(EXPLORE_ALLOWED_TOOLS).toEqual([
      "Read",
      "Glob",
      "Grep",
      "WebFetch",
      "WebSearch",
      "Task",
      "Agent",
      "Workflow",
      "ToolSearch",
      "TodoWrite",
      "Bash(git log:*)",
      "Bash(git diff:*)",
      "Bash(git show:*)",
      "Bash(git status:*)",
      "Bash(git blame:*)",
      "Bash(ls:*)",
    ]);
    expect(EXPLORE_DISALLOWED_TOOLS).toEqual(["Edit", "Write", "NotebookEdit"]);
  });
});

describe("buildClaudeArgs", () => {
  it("builds explore args with allow and disallow lists and stream-json output", () => {
    const args = buildClaudeArgs("explore");
    expect(args.slice(0, 4)).toEqual(["-p", "--verbose", "--output-format", "stream-json"]);
    const allowedAt = args.indexOf("--allowedTools");
    expect(allowedAt).toBeGreaterThan(-1);
    expect(args.slice(allowedAt + 1, allowedAt + 1 + EXPLORE_ALLOWED_TOOLS.length)).toEqual([
      ...EXPLORE_ALLOWED_TOOLS,
    ]);
    const disallowedAt = args.indexOf("--disallowedTools");
    expect(args.slice(disallowedAt + 1, disallowedAt + 4)).toEqual([...EXPLORE_DISALLOWED_TOOLS]);
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  it("builds build args with acceptEdits permission mode by default", () => {
    const args = buildClaudeArgs("build");
    expect(args).toEqual([
      "-p",
      "--verbose",
      "--output-format",
      "stream-json",
      "--permission-mode",
      "acceptEdits",
    ]);
  });

  it("builds build args with --dangerously-skip-permissions when opted in", () => {
    const args = buildClaudeArgs("build", { skipPermissions: true });
    expect(args).toEqual([
      "-p",
      "--verbose",
      "--output-format",
      "stream-json",
      "--dangerously-skip-permissions",
    ]);
  });

  it("throws when skipPermissions is requested in explore mode", () => {
    expect(() => buildClaudeArgs("explore", { skipPermissions: true })).toThrow(
      "--dangerously-skip-permissions is only valid in build mode",
    );
  });

  it("appends --max-budget-usd for explore mode", () => {
    const args = buildClaudeArgs("explore", { maxBudgetUsd: 5 });
    expect(args.slice(-2)).toEqual(["--max-budget-usd", "5"]);
  });

  it("appends --max-budget-usd for build mode", () => {
    const args = buildClaudeArgs("build", { maxBudgetUsd: 5 });
    expect(args.slice(-2)).toEqual(["--max-budget-usd", "5"]);
  });
});
