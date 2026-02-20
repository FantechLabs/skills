import { execSync } from "node:child_process";
import type { CommitInfo, DiffStats } from "./types";
import { resolveBaseRef } from "./git";

/**
 * Get commits on current branch that are not in target branch.
 */
export function getCommitsSinceTarget(target: string, cwd: string): CommitInfo[] {
  const baseRef = resolveBaseRef(target, cwd);
  const raw = execSync(`git log ${baseRef}..HEAD --format=\"%H %s\"`, {
    cwd,
    encoding: "utf-8",
  }).trim();

  if (!raw) return [];

  return raw.split("\n").map((line) => {
    const hash = line.slice(0, 40);
    const message = line.slice(41);
    const parsed = parseConventionalCommit(message);
    return { hash, message, ...parsed };
  });
}

/**
 * Parse conventional commit header.
 */
function parseConventionalCommit(
  message: string,
): { type: string | null; scope: string | null; description: string } {
  const match = message.match(/^(\w+)(?:\(([^)]+)\))?!?:\s*(?:\S+\s)?(.+)/);
  if (match) {
    return {
      type: match[1],
      scope: match[2] || null,
      description: match[3],
    };
  }

  return { type: null, scope: null, description: message };
}

/**
 * Get diff stats between current branch and target.
 */
export function getDiffStats(target: string, cwd: string): DiffStats {
  const baseRef = resolveBaseRef(target, cwd);

  const statOutput = execSync(`git diff ${baseRef}...HEAD --stat`, {
    cwd,
    encoding: "utf-8",
  }).trim();

  const nameOutput = execSync(`git diff ${baseRef}...HEAD --name-only`, {
    cwd,
    encoding: "utf-8",
  }).trim();

  const files = nameOutput ? nameOutput.split("\n") : [];

  const summaryMatch = statOutput.match(
    /(\d+) files? changed(?:, (\d+) insertions?)?(?:, (\d+) deletions?)?/,
  );

  return {
    filesChanged: summaryMatch ? parseInt(summaryMatch[1], 10) : files.length,
    additions: summaryMatch?.[2] ? parseInt(summaryMatch[2], 10) : 0,
    deletions: summaryMatch?.[3] ? parseInt(summaryMatch[3], 10) : 0,
    files,
  };
}

/**
 * Find commits that likely indicate work-in-progress status.
 */
export function findWIPCommits(commits: CommitInfo[]): string[] {
  return commits
    .filter((commit) => /\bWIP\b/i.test(commit.message) || commit.message.includes("🚧"))
    .map((commit) => commit.message);
}
