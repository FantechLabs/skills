import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = resolve(moduleDir, "..", "..");
export const BIN_PATH = resolve(REPO_ROOT, "bin", "skills.mjs");

export interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

interface CliOptions {
  binPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export function runNodeCli(args: string[], options: CliOptions = {}): CliResult {
  const result = spawnSync(process.execPath, [options.binPath ?? BIN_PATH, ...args], {
    cwd: options.cwd ?? REPO_ROOT,
    env: {
      ...process.env,
      ...options.env,
    },
    encoding: "utf-8",
    timeout: 30_000,
  });

  return {
    status: result.status ?? (result.error ? 1 : 0),
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
