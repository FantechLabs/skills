import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ReviewerSuggestion } from "./types";

/**
 * Suggest reviewers from CODEOWNERS (selectable) and git history (advisory only).
 */
export function suggestReviewers(changedFiles: string[], cwd: string): ReviewerSuggestion[] {
  const suggestions: ReviewerSuggestion[] = [];
  const seen = new Set<string>();

  const codeownersPath = findCodeowners(cwd);
  if (codeownersPath) {
    const owners = getCodeownersOwners(codeownersPath, changedFiles);

    for (const owner of owners) {
      const username = owner.replace(/^@/, "");
      const key = username.toLowerCase();
      if (seen.has(key)) continue;

      seen.add(key);
      suggestions.push({
        username,
        source: "codeowners",
        reason: "Matched CODEOWNERS pattern",
        selectable: true,
      });
    }
  }

  const currentUser = getCurrentUser(cwd).toLowerCase();
  const historyNames = getFrequentContributorNames(changedFiles, cwd)
    .filter((name) => name.toLowerCase() !== currentUser)
    .slice(0, 3);

  for (const name of historyNames) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    suggestions.push({
      username: name,
      source: "git-history",
      reason: "Frequent contributor to changed files (manual check)",
      selectable: false,
    });
  }

  return suggestions;
}

function findCodeowners(cwd: string): string | null {
  const paths = [join(cwd, "CODEOWNERS"), join(cwd, ".github", "CODEOWNERS"), join(cwd, "docs", "CODEOWNERS")];
  return paths.find((path) => existsSync(path)) || null;
}

function getCodeownersOwners(path: string, changedFiles: string[]): string[] {
  const content = readFileSync(path, "utf-8");
  const owners = new Set<string>();

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const parts = trimmed.split(/\s+/);
    const pattern = parts[0];
    const lineOwners = parts.slice(1).filter((entry) => entry.startsWith("@"));
    if (lineOwners.length === 0) continue;

    for (const file of changedFiles) {
      if (fileMatchesPattern(file, pattern)) {
        for (const owner of lineOwners) owners.add(owner);
      }
    }
  }

  return [...owners];
}

function fileMatchesPattern(file: string, pattern: string): boolean {
  if (pattern === "*") return true;

  if (pattern.startsWith("/")) {
    return file.startsWith(pattern.slice(1));
  }

  if (pattern.startsWith("*.")) {
    return file.endsWith(pattern.slice(1));
  }

  if (pattern.endsWith("/*") || pattern.endsWith("/")) {
    const dir = pattern.replace(/\/?\*?$/, "");
    return file.startsWith(dir);
  }

  return file.includes(pattern);
}

function getFrequentContributorNames(files: string[], cwd: string): string[] {
  if (files.length === 0) return [];

  try {
    const fileArgs = files.slice(0, 20).map((file) => `\"${file}\"`).join(" ");
    const output = execSync(`git log --format=\"%aN\" -n 80 -- ${fileArgs}`, {
      cwd,
      encoding: "utf-8",
    }).trim();

    if (!output) return [];

    const counts = new Map<string, number>();
    for (const name of output.split("\n")) {
      counts.set(name, (counts.get(name) || 0) + 1);
    }

    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);
  } catch {
    return [];
  }
}

function getCurrentUser(cwd: string): string {
  try {
    return execSync("git config user.name", { cwd, encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}
