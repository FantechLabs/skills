import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse } from "node:path";

export type PackageManager = "bun" | "npm" | "pnpm";

export interface DetectedPackageManager {
  manager: PackageManager;
  projectRoot: string | null;
  source: "default" | "lockfile" | "package-manager-field" | "runtime" | "user-agent";
}

export function detectPackageManager(cwd: string = process.cwd()): DetectedPackageManager {
  for (const dir of iterateUpwards(cwd)) {
    const fromLockfile = detectFromLockfiles(dir);
    if (fromLockfile) {
      return {
        manager: fromLockfile,
        projectRoot: dir,
        source: "lockfile",
      };
    }

    const fromPackageJson = detectFromPackageManagerField(dir);
    if (fromPackageJson) {
      return {
        manager: fromPackageJson,
        projectRoot: dir,
        source: "package-manager-field",
      };
    }
  }

  const userAgent = process.env.npm_config_user_agent ?? "";
  if (userAgent.startsWith("bun/")) {
    return { manager: "bun", projectRoot: null, source: "user-agent" };
  }
  if (userAgent.startsWith("pnpm/")) {
    return { manager: "pnpm", projectRoot: null, source: "user-agent" };
  }
  if (userAgent.startsWith("npm/")) {
    return { manager: "npm", projectRoot: null, source: "user-agent" };
  }

  if (process.versions.bun) {
    return { manager: "bun", projectRoot: null, source: "runtime" };
  }

  return { manager: "npm", projectRoot: null, source: "default" };
}

export function installPackageDependencies(
  manager: PackageManager,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const result = spawnSync(manager, ["install"], {
    cwd,
    env,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    throw new Error(`${manager} install failed in ${cwd}`);
  }
}

function detectFromLockfiles(dir: string): PackageManager | null {
  if (existsSync(join(dir, "bun.lock")) || existsSync(join(dir, "bun.lockb"))) {
    return "bun";
  }
  if (existsSync(join(dir, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (existsSync(join(dir, "package-lock.json"))) {
    return "npm";
  }

  return null;
}

function detectFromPackageManagerField(dir: string): PackageManager | null {
  const packageJsonPath = join(dir, "package.json");
  if (!existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const content = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
      packageManager?: string;
    };
    const raw = content.packageManager?.split("@")[0];
    if (raw === "bun" || raw === "pnpm" || raw === "npm") {
      return raw;
    }
  } catch {
    return null;
  }

  return null;
}

function* iterateUpwards(startDir: string): Generator<string> {
  let current = startDir;
  const root = parse(startDir).root;

  while (true) {
    yield current;

    if (current === root) {
      return;
    }

    current = dirname(current);
  }
}
