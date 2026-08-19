import { spawnSync } from "node:child_process";

import type { PRCreateParams } from "./types";

export interface PRCreateResult {
  success: boolean;
  url: string | null;
  error: string | null;
}

/**
 * Create GitHub pull request through gh CLI.
 */
export function createGitHubPR(params: PRCreateParams, cwd: string): PRCreateResult {
  const args: string[] = ["pr", "create", "--title", params.title, "--base", params.target, "--body-file", "-"];

  if (params.draft) args.push("--draft");
  for (const reviewer of params.reviewers) args.push("--reviewer", reviewer);
  for (const label of params.labels) args.push("--label", label);

  const result = spawnSync("gh", args, {
    cwd,
    input: params.body,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (result.status === 0) {
    const combined = `${result.stdout || ""}\n${result.stderr || ""}`;
    const url = extractFirstUrl(combined) || (result.stdout || "").trim() || null;
    return { success: true, url, error: null };
  }

  return {
    success: false,
    url: null,
    error: (result.stderr || result.stdout || "gh pr create failed").trim(),
  };
}

function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/\S+/);
  return match ? match[0] : null;
}
