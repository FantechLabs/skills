import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve, sep, join } from "node:path";
import { findMonorepoRoot } from "./runtime.js";

export function inferScopeFromFiles(files: string[], cwd: string): string | null {
  const root = findMonorepoRoot(cwd);
  if (!root) {
    return null;
  }

  const counts = new Map<string, number>();
  const monorepoRoots = new Set(["apps", "packages", "tooling"]);

  for (const file of files) {
    const absolute = resolve(cwd, file);
    const rel = relative(root, absolute);
    if (!rel || rel.startsWith(`..${sep}`)) {
      continue;
    }

    const parts = rel.split(/[\\/]/);
    if (parts.length < 2 || !monorepoRoots.has(parts[0])) {
      continue;
    }

    const scope = parts[1];
    counts.set(scope, (counts.get(scope) || 0) + 1);
  }

  if (counts.size === 0) {
    const hasRootFiles = files.some((file) => !file.includes("/") && !file.includes("\\"));
    return hasRootFiles ? "repo" : null;
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export function extractIssueKey(branch: string): string | null {
  const match = branch.match(/([A-Z]+-\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

export function getCurrentBranch(cwd: string): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { cwd, encoding: "utf-8" }).trim();
  } catch {
    return "HEAD";
  }
}

export function detectPackageScope(cwd: string): string | null {
  try {
    const packagePath = join(cwd, "package.json");
    if (!existsSync(packagePath)) {
      return null;
    }

    const pkg = JSON.parse(readFileSync(packagePath, "utf-8"));
    if (typeof pkg.name === "string" && pkg.name.startsWith("@") && pkg.name.includes("/")) {
      return pkg.name.split("/")[0].slice(1);
    }
  } catch {
    // Ignore parsing errors.
  }

  return null;
}
