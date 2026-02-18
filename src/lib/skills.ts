import { cpSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface SkillInfo {
  name: string;
  description: string;
  hasScripts: boolean;
  path: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, "..", "..");

export function discoverBundledSkills(): SkillInfo[] {
  const skills: SkillInfo[] = [];

  for (const entry of readdirSync(PACKAGE_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillDir = join(PACKAGE_ROOT, entry.name);
    const skillFile = join(skillDir, "SKILL.md");

    if (!existsSync(skillFile)) {
      continue;
    }

    const frontmatter = parseFrontmatter(readFileSync(skillFile, "utf-8"));

    skills.push({
      name: frontmatter.name || entry.name,
      description: frontmatter.description || "",
      hasScripts: existsSync(join(skillDir, "scripts")),
      path: skillDir,
    });
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export function findInstalledSkills(cwd: string): Map<string, string[]> {
  const installed = new Map<string, string[]>();

  const candidateDirs = [
    join(cwd, ".ruler", "skills"),
    join(cwd, ".agents", "skills"),
    join(cwd, ".claude", "skills"),
    join(cwd, ".cursor", "skills"),
    join(cwd, ".codex", "skills"),
    join(cwd, ".opencode", "skills"),
  ];

  for (const baseDir of candidateDirs) {
    if (!existsSync(baseDir)) {
      continue;
    }

    for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        continue;
      }

      const skillName = entry.name;
      const skillFile = join(baseDir, skillName, "SKILL.md");
      if (!existsSync(skillFile)) {
        continue;
      }

      const locations = installed.get(skillName) || [];
      locations.push(baseDir);
      installed.set(skillName, locations);
    }
  }

  return installed;
}

export function copySkill(skillPath: string, targetDir: string): void {
  rmSync(targetDir, { recursive: true, force: true });

  cpSync(skillPath, targetDir, {
    recursive: true,
    filter: (sourcePath) => {
      const normalized = sourcePath.replace(/\\/g, "/");
      return !normalized.includes("/node_modules/") && !normalized.endsWith("/node_modules");
    },
  });
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return {};
  }

  const result: Record<string, string> = {};

  for (const rawLine of match[1].split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf(":");
    if (separator < 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    const value = rawValue.replace(/^['"]/, "").replace(/['"]$/, "");
    result[key] = value;
  }

  return result;
}
