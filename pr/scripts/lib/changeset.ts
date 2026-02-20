import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ChangesetInfo } from "./types";
import { resolveBaseRef } from "./git";
import { isMonorepo } from "./runtime";

/**
 * Return .changeset markdown files changed on current branch.
 */
export function getBranchChangesetFiles(target: string, cwd: string): string[] {
  const changesetDir = join(cwd, ".changeset");
  if (!existsSync(changesetDir)) return [];

  try {
    const baseRef = resolveBaseRef(target, cwd);
    const output = execSync(`git diff --name-only ${baseRef}...HEAD -- .changeset`, {
      cwd,
      encoding: "utf-8",
    }).trim();

    if (!output) return [];

    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((file) => file.startsWith(".changeset/"))
      .map((file) => file.replace(/^\.changeset\//, ""))
      .filter((file) => file.endsWith(".md"))
      .filter((file) => file.toLowerCase() !== "readme.md");
  } catch {
    return [];
  }
}

/**
 * Check whether this branch includes a changeset.
 */
export function checkChangeset(cwd: string, target: string, issueKey: string | null): ChangesetInfo {
  const branchFiles = getBranchChangesetFiles(target, cwd);

  if (branchFiles.length === 0) {
    return { exists: false, file: null, packages: [], branchFiles: [] };
  }

  const matchByIssue = issueKey
    ? branchFiles.find((file) => file.toUpperCase().startsWith(issueKey.toUpperCase()))
    : null;

  const chosenFile = matchByIssue || branchFiles[0];
  const packages = parseChangesetPackages(join(cwd, ".changeset", chosenFile));

  return {
    exists: true,
    file: chosenFile,
    packages,
    branchFiles,
  };
}

/**
 * Parse package names from changeset frontmatter.
 */
function parseChangesetPackages(filePath: string): string[] {
  try {
    const content = readFileSync(filePath, "utf-8");
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return [];

    return match[1]
      .split("\n")
      .filter((line) => line.includes(":"))
      .map((line) => line.split(":")[0].trim().replace(/[\"']/g, ""));
  } catch {
    return [];
  }
}

/**
 * Whether changesets are expected for this repo.
 */
export function isChangesetExpected(cwd: string): boolean {
  return isMonorepo(cwd) && existsSync(join(cwd, ".changeset", "config.json"));
}
