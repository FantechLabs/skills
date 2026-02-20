import { existsSync } from "node:fs";
import { join } from "node:path";

export type PackageManager = "bun" | "pnpm" | "npm";
export type ScriptRunner = "bun" | "tsx";

/**
 * Detect package manager from lockfile
 */
export function detectPackageManager(cwd: string = process.cwd()): PackageManager {
  if (existsSync(join(cwd, "bun.lock")) || existsSync(join(cwd, "bun.lockb"))) return "bun";
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(cwd, "package-lock.json"))) return "npm";
  return "pnpm"; // default
}

/**
 * Detect script runner (bun or tsx)
 */
export function detectScriptRunner(cwd: string = process.cwd()): ScriptRunner {
  if (existsSync(join(cwd, "bun.lock")) || existsSync(join(cwd, "bun.lockb"))) return "bun";
  return "tsx";
}

/**
 * Check if running in CI environment
 */
export function isCI(): boolean {
  return !!(
    process.env.CI ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.CIRCLECI ||
    process.env.JENKINS_URL
  );
}

/**
 * Check if running interactively (TTY and not CI)
 */
export function isInteractive(): boolean {
  return !!(process.stdout.isTTY && !isCI());
}

/**
 * Find monorepo root by looking for turbo.json or pnpm-workspace.yaml
 */
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
    dir = join(dir, "..");
  }

  return null;
}

/**
 * Check if current project is a monorepo
 */
export function isMonorepo(cwd: string = process.cwd()): boolean {
  return findMonorepoRoot(cwd) !== null;
}
