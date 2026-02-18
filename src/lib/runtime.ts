import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function isBunRuntime(): boolean {
  return !!process.versions.bun;
}

export function resolveTsxImportPath(): string {
  const resolved = import.meta.resolve("tsx");
  return resolved.startsWith("file:") ? resolved : fileURLToPath(resolved);
}

export function runTypeScriptScript(scriptPath: string, args: string[], cwd: string): number {
  if (isBunRuntime()) {
    const result = spawnSync(process.execPath, [scriptPath, ...args], {
      cwd,
      stdio: "inherit",
      env: process.env,
    });

    if (result.error) {
      throw result.error;
    }

    return result.status ?? 1;
  }

  const tsxImportPath = resolveTsxImportPath();
  const result = spawnSync(process.execPath, ["--import", tsxImportPath, scriptPath, ...args], {
    cwd,
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}
