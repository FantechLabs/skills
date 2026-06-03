import { cpSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export interface SkillInfo {
  name: string;
  description: string;
  defaultScript?: string;
  hasScripts: boolean;
  path: string;
}

export interface SkillDirectoryDiff {
  addedFiles: string[];
  changedFiles: string[];
  equal: boolean;
  removedFiles: string[];
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, "..", "..");
const IGNORED_FILE_NAMES = new Set([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

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
      defaultScript:
        frontmatter.default_script || frontmatter["default-script"] || frontmatter.defaultScript,
      hasScripts: existsSync(join(skillDir, "scripts")),
      path: skillDir,
    });
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export function findInstalledSkills(cwd: string): Map<string, string[]> {
  const installed = new Map<string, string[]>();

  const candidateDirs = [
    join(cwd, "skills"),
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

export function compareSkillDirectories(sourceDir: string, targetDir: string): SkillDirectoryDiff {
  if (!existsSync(targetDir)) {
    return {
      addedFiles: listTrackedFiles(sourceDir),
      changedFiles: [],
      equal: false,
      removedFiles: [],
    };
  }

  const sourceFiles = readTrackedFileMap(sourceDir);
  const targetFiles = readTrackedFileMap(targetDir);

  const addedFiles: string[] = [];
  const changedFiles: string[] = [];
  const removedFiles: string[] = [];

  for (const [filePath, content] of sourceFiles) {
    const existing = targetFiles.get(filePath);
    if (!existing) {
      addedFiles.push(filePath);
      continue;
    }

    if (existing !== content) {
      changedFiles.push(filePath);
    }
  }

  for (const filePath of targetFiles.keys()) {
    if (!sourceFiles.has(filePath)) {
      removedFiles.push(filePath);
    }
  }

  return {
    addedFiles: addedFiles.sort(),
    changedFiles: changedFiles.sort(),
    equal: addedFiles.length === 0 && changedFiles.length === 0 && removedFiles.length === 0,
    removedFiles: removedFiles.sort(),
  };
}

export function findSkillPackageDirs(skillPath: string): string[] {
  const packageDirs: string[] = [];

  walkSkillTree(skillPath, (dir) => {
    if (existsSync(join(dir, "package.json"))) {
      packageDirs.push(dir);
    }
  });

  return packageDirs.sort();
}

function listTrackedFiles(baseDir: string): string[] {
  return [...readTrackedFileMap(baseDir).keys()].sort();
}

function readTrackedFileMap(baseDir: string): Map<string, string> {
  const files = new Map<string, string>();

  walkSkillTree(baseDir, (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() || entry.name === "node_modules" || shouldIgnoreFile(entry.name)) {
        continue;
      }

      const absolutePath = join(dir, entry.name);
      const relativePath = relative(baseDir, absolutePath).replace(/\\/g, "/");

      files.set(relativePath, readFileSync(absolutePath, "utf-8"));
    }
  });

  return files;
}

function walkSkillTree(baseDir: string, visitDirectory: (dir: string) => void): void {
  if (!existsSync(baseDir)) {
    return;
  }

  visitDirectory(baseDir);

  for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    if (entry.name === "node_modules" || shouldIgnoreFile(entry.name)) {
      continue;
    }

    walkSkillTree(join(baseDir, entry.name), visitDirectory);
  }
}

function shouldIgnoreFile(fileName: string): boolean {
  return IGNORED_FILE_NAMES.has(basename(fileName));
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
