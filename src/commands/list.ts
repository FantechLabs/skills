import { homedir } from "node:os";
import { relative } from "node:path";

import {
  discoverBundledSkills,
  findInstalledSkills,
  type SkillInstallLocation,
} from "../lib/skills.js";

const DESCRIPTION_MAX_LENGTH = 60;

export function formatSkillDescription(
  description: string,
  maxLength: number = DESCRIPTION_MAX_LENGTH,
): string {
  const normalized = description.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function formatInstallPath(location: SkillInstallLocation, cwd: string, homeDir: string): string {
  const baseDir = location.scope === "local" ? cwd : homeDir;
  const relativePath = relative(baseDir, location.skillPath).replaceAll("\\", "/");

  return location.scope === "global" ? `~/${relativePath}` : relativePath;
}

export default async function listCommand(_args: string[]): Promise<void> {
  const cwd = process.cwd();
  const homeDir = homedir();
  const bundled = discoverBundledSkills();
  const installed = findInstalledSkills(cwd, homeDir);

  console.log("\nAvailable skills:\n");

  for (const skill of bundled) {
    const locations = installed.get(skill.name) || [];
    const status =
      locations.length > 0
        ? `installed (${locations.length} location${locations.length > 1 ? "s" : ""})`
        : "not installed";
    const scriptsLabel = skill.hasScripts ? "runnable" : "docs only";

    console.log(`  ${skill.name.padEnd(14)} ${status.padEnd(22)} ${scriptsLabel}`);
    if (skill.description) {
      console.log(`  ${"".padEnd(14)} ${formatSkillDescription(skill.description)}`);
    }
    for (const location of locations) {
      const scope = `${location.scope[0].toUpperCase()}${location.scope.slice(1)}`;
      console.log(`  ${"".padEnd(14)} ${scope} · ${location.harnesses.join(", ")}`);
      console.log(`  ${"".padEnd(14)}   ${formatInstallPath(location, cwd, homeDir)}`);
    }
    console.log();
  }
}
