import { execSync } from "node:child_process";

export interface FileStatus {
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

function readLines(command: string, cwd: string): string[] {
  const output = execSync(command, { cwd, encoding: "utf-8" }).trim();
  if (!output) {
    return [];
  }
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function getFileStatus(cwd: string): FileStatus {
  return {
    staged: readLines("git diff --cached --name-only", cwd),
    unstaged: readLines("git diff --name-only", cwd),
    untracked: readLines("git ls-files --others --exclude-standard", cwd),
  };
}

export function createCommit(message: string, cwd: string): void {
  execSync("git commit -F -", {
    cwd,
    input: message,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export function getGitRoot(cwd: string): string {
  return execSync("git rev-parse --show-toplevel", { cwd, encoding: "utf-8" }).trim();
}
