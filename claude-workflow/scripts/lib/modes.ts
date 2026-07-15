import type { Mode } from "./prompt.js";

export const EXPLORE_ALLOWED_TOOLS: readonly string[] = [
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
];

export const EXPLORE_DISALLOWED_TOOLS: readonly string[] = ["Edit", "Write", "NotebookEdit"];

export interface BuildClaudeArgsOptions {
  skipPermissions?: boolean;
  maxBudgetUsd?: number;
}

export function buildClaudeArgs(mode: Mode, opts?: BuildClaudeArgsOptions): string[] {
  const base = ["-p", "--verbose", "--output-format", "stream-json"];

  if (mode === "explore") {
    if (opts?.skipPermissions) {
      throw new Error("--dangerously-skip-permissions is only valid in build mode");
    }
    const args = [
      ...base,
      "--allowedTools",
      ...EXPLORE_ALLOWED_TOOLS,
      "--disallowedTools",
      ...EXPLORE_DISALLOWED_TOOLS,
    ];
    if (opts?.maxBudgetUsd !== undefined) {
      args.push("--max-budget-usd", String(opts.maxBudgetUsd));
    }
    return args;
  }

  const args = opts?.skipPermissions
    ? [...base, "--dangerously-skip-permissions"]
    : [...base, "--permission-mode", "acceptEdits"];
  if (opts?.maxBudgetUsd !== undefined) {
    args.push("--max-budget-usd", String(opts.maxBudgetUsd));
  }
  return args;
}
