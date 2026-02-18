import { existsSync } from "node:fs";
import { join } from "node:path";

export function isRulerProject(cwd: string): boolean {
  return existsSync(join(cwd, ".ruler", "ruler.toml"));
}

export function getRulerSkillsDir(cwd: string): string {
  return join(cwd, ".ruler", "skills");
}
