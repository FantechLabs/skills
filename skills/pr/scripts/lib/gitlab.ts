import { spawnSync } from "node:child_process";

import type { PRCreateParams } from "./types";

export interface MRCreateResult {
  success: boolean;
  url: string | null;
  error: string | null;
}

/**
 * Create GitLab merge request through glab CLI.
 */
export function createGitLabMR(params: PRCreateParams, cwd: string): MRCreateResult {
  const args: string[] = [
    "mr",
    "create",
    "--title",
    params.title,
    "--target-branch",
    params.target,
    "--description",
    params.body,
  ];

  if (params.draft) args.push("--draft");
  for (const reviewer of params.reviewers) args.push("--reviewer", reviewer);
  for (const label of params.labels) args.push("--label", label);

  const result = spawnSync("glab", args, {
    cwd,
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
    error: (result.stderr || result.stdout || "glab mr create failed").trim(),
  };
}

function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/\S+/);
  return match ? match[0] : null;
}
