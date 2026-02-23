import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function createTempProject(prefix: string = "skills-cli-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function cleanupTempProject(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
