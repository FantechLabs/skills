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

export function buildClaudeArgs(mode: Mode): string[] {
  const base = ["-p", "--verbose", "--output-format", "stream-json"];
  if (mode === "explore") {
    return [
      ...base,
      "--allowedTools",
      ...EXPLORE_ALLOWED_TOOLS,
      "--disallowedTools",
      ...EXPLORE_DISALLOWED_TOOLS,
    ];
  }
  return [...base, "--dangerously-skip-permissions"];
}
