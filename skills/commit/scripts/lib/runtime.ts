import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type PackageManager = "bun" | "pnpm" | "npm";
export type ScriptRunner = "bun" | "tsx";

export function detectPackageManager(cwd: string = process.cwd()): PackageManager {
  if (existsSync(join(cwd, "bun.lock")) || existsSync(join(cwd, "bun.lockb"))) {
    return "bun";
  }
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (existsSync(join(cwd, "package-lock.json"))) {
    return "npm";
  }
  return "pnpm";
}

export function detectScriptRunner(cwd: string = process.cwd()): ScriptRunner {
  return detectPackageManager(cwd) === "bun" ? "bun" : "tsx";
}

export function isCI(): boolean {
  return !!(
    process.env.CI ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.CIRCLECI ||
    process.env.JENKINS_URL
  );
}

export function isInteractive(): boolean {
  return !!(process.stdout.isTTY && !isCI());
}

export function findMonorepoRoot(cwd: string = process.cwd()): string | null {
  let dir = cwd;
  const root = "/";

  while (dir !== root) {
    if (
      existsSync(join(dir, "turbo.json")) ||
      existsSync(join(dir, "pnpm-workspace.yaml")) ||
      existsSync(join(dir, "lerna.json"))
    ) {
      return dir;
    }

    const packageJsonPath = join(dir, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
        if (pkg && pkg.workspaces) {
          return dir;
        }
      } catch {
        // Ignore parse errors and continue searching.
      }
    }

    dir = join(dir, "..");
  }

  return null;
}

export function isMonorepo(cwd: string = process.cwd()): boolean {
  return findMonorepoRoot(cwd) !== null;
}
