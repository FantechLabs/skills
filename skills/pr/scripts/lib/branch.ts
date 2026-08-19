import { execSync } from "node:child_process";
import type { PRType } from "./types";

/**
 * Get current branch name.
 */
export function getCurrentBranch(cwd: string): string {
  return execSync("git rev-parse --abbrev-ref HEAD", { cwd, encoding: "utf-8" }).trim();
}

/**
 * Resolve default target branch.
 * Priority:
 * 1) origin/HEAD symbolic ref
 * 2) origin/main, origin/master
 * 3) local main, local master
 * 4) fallback main
 */
export function getDefaultTarget(cwd: string): string {
  try {
    const symbolic = execSync("git symbolic-ref --quiet refs/remotes/origin/HEAD", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    const match = symbolic.match(/^refs\/remotes\/origin\/(.+)$/);
    if (match?.[1]) return match[1];
  } catch {
    // continue to fallbacks
  }

  for (const candidate of ["main", "master"]) {
    try {
      execSync(`git rev-parse --verify origin/${candidate}`, { cwd, stdio: "pipe" });
      return candidate;
    } catch {
      // continue
    }

    try {
      execSync(`git rev-parse --verify ${candidate}`, { cwd, stdio: "pipe" });
      return candidate;
    } catch {
      // continue
    }
  }

  return "main";
}

/**
 * Detect PR type from branch name.
 */
export function detectPRType(branch: string): PRType {
  if (branch.startsWith("release/") || branch.startsWith("release-")) return "release";
  if (branch.startsWith("hotfix/") || branch.startsWith("hotfix-")) return "hotfix";
  if (extractIssueKey(branch)) return "feature";
  return "generic";
}

/**
 * Extract issue key from branch name.
 */
export function extractIssueKey(branch: string): string | null {
  const match = branch.match(/([A-Z][A-Z0-9]+-\d+)/);
  return match ? match[1] : null;
}

/**
 * Extract version from release/hotfix branch.
 */
export function extractVersion(branch: string): string | null {
  const match = branch.match(/(?:release|hotfix)[/-]v?(\d+\.\d+\.\d+(?:-[\w.]+)?)/);
  return match ? match[1] : null;
}

/**
 * Generate human-readable title slug from branch name.
 */
export function branchToTitle(branch: string): string {
  let slug = branch.replace(/^[^/]*\//, "");
  slug = slug.replace(/[A-Z][A-Z0-9]+-\d+-?/, "");
  slug = slug.replace(/-/g, " ").trim();

  if (!slug) return "Update";
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}
