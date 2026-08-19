import { execSync } from "node:child_process";

/**
 * Ensure the working directory is inside a git repository.
 */
export function assertGitRepo(cwd: string): void {
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "pipe" });
  } catch {
    throw new Error("Not inside a git repository");
  }
}

/**
 * Resolve preferred comparison reference.
 * Use origin/<target> when available, otherwise use local <target>.
 */
export function resolveBaseRef(target: string, cwd: string): string {
  const remoteRef = `origin/${target}`;

  try {
    execSync(`git rev-parse --verify ${remoteRef}`, { cwd, stdio: "pipe" });
    return remoteRef;
  } catch {
    return target;
  }
}

/**
 * Whether current branch has configured upstream.
 */
export function hasUpstream(cwd: string): boolean {
  try {
    execSync("git rev-parse --abbrev-ref --symbolic-full-name @{upstream}", {
      cwd,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Push current branch to origin when upstream is missing.
 */
export function ensureBranchPushed(cwd: string): void {
  if (hasUpstream(cwd)) return;
  execSync("git push -u origin HEAD", { cwd, stdio: "pipe" });
}
