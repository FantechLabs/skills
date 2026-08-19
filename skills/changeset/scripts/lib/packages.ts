import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { findMonorepoRoot } from "./runtime";

const LEGACY_WORKSPACE_PATTERNS = ["apps/*", "packages/*", "tooling/*"];
const SKIP_SCAN_DIRS = new Set([
  ".git",
  ".hg",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

export interface PackageInfo {
  name: string;
  path: string;
  relativePath: string;
  version: string;
  private: boolean;
  isRoot: boolean;
}

export interface AffectedPackage extends PackageInfo {
  commits: string[];
  scope: string;
}

interface WorkspacePackageJson {
  name?: string;
  private?: boolean;
  version?: string;
  workspaces?: string[] | { packages?: string[] };
}

/**
 * Get all packages in monorepo/workspace and include root package as repo scope.
 */
export function getAllPackages(cwd: string = process.cwd()): PackageInfo[] {
  const root = findMonorepoRoot(cwd) || cwd;
  const packagesByRelativePath = new Map<string, PackageInfo>();

  const workspacePatterns = collectWorkspacePatterns(root);
  const workspacePackageDirs = discoverWorkspacePackageDirs(root, workspacePatterns);

  for (const packageDir of workspacePackageDirs) {
    const pkg = readPackageInfo(packageDir, root);
    if (pkg) {
      packagesByRelativePath.set(pkg.relativePath, pkg);
    }
  }

  // Always include root package if present so root-level changes can be mapped.
  const rootPkg = readPackageInfo(root, root);
  if (rootPkg) {
    packagesByRelativePath.set(rootPkg.relativePath, rootPkg);
  }

  return Array.from(packagesByRelativePath.values()).sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath),
  );
}

/**
 * Get changed files since base branch.
 */
export function getChangedFiles(
  baseBranch: string = "main",
  cwd: string = process.cwd(),
): string[] {
  try {
    // Get merge base
    const mergeBase = execSync(`git merge-base ${baseBranch} HEAD`, {
      cwd,
      encoding: "utf-8",
    }).trim();

    // Get changed files
    const output = execSync(`git diff --name-only ${mergeBase}...HEAD`, {
      cwd,
      encoding: "utf-8",
    });

    return output
      .trim()
      .split("\n")
      .filter((f) => f.length > 0);
  } catch {
    // Fallback: compare with base branch directly
    try {
      const output = execSync(`git diff --name-only ${baseBranch}...HEAD`, {
        cwd,
        encoding: "utf-8",
      });
      return output
        .trim()
        .split("\n")
        .filter((f) => f.length > 0);
    } catch {
      return [];
    }
  }
}

/**
 * Map a file path to its package.
 * Longest matching package path wins. Falls back to root package when available.
 */
export function fileToPackage(filePath: string, packages: PackageInfo[]): PackageInfo | null {
  const normalizedFile = normalizePath(filePath);
  let bestMatch: PackageInfo | null = null;
  let rootPkg: PackageInfo | null = null;

  for (const pkg of packages) {
    const relativePath = normalizePath(pkg.relativePath);

    if (relativePath === ".") {
      rootPkg = pkg;
      continue;
    }

    if (normalizedFile === relativePath || normalizedFile.startsWith(`${relativePath}/`)) {
      if (!bestMatch || relativePath.length > normalizePath(bestMatch.relativePath).length) {
        bestMatch = pkg;
      }
    }
  }

  return bestMatch || rootPkg;
}

/**
 * Extract a generic scope token from a file path.
 * Keeps legacy behavior for apps/packages/tooling and adds root/repo scope.
 */
export function extractScope(filePath: string): string | null {
  const normalized = normalizePath(filePath);
  if (normalized === ".") return "repo";

  const segments = normalized.split("/");
  if (segments.length === 0) return null;

  if (["apps", "packages", "tooling"].includes(segments[0]) && segments.length >= 2) {
    return segments[1];
  }

  return segments[segments.length - 1] || null;
}

/**
 * Get usable scope aliases for a package.
 */
export function getPackageScopes(pkg: PackageInfo): string[] {
  const scopes = new Set<string>();
  const addScope = (value: string | null | undefined): void => {
    if (!value) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    scopes.add(trimmed);
    scopes.add(trimmed.toLowerCase());
  };

  addScope(pkg.name);

  if (pkg.name.startsWith("@")) {
    const slashIndex = pkg.name.indexOf("/");
    if (slashIndex > 0 && slashIndex < pkg.name.length - 1) {
      addScope(pkg.name.slice(slashIndex + 1));
    }
  }

  const normalizedPath = normalizePath(pkg.relativePath);
  if (normalizedPath === ".") {
    addScope("repo");
    addScope("root");
    const rootDirName = basename(pkg.path);
    if (/^[A-Za-z0-9_-]+$/.test(rootDirName)) {
      addScope(rootDirName);
    }
  } else {
    const segments = normalizedPath.split("/");
    addScope(segments[segments.length - 1]);
    addScope(normalizedPath);
  }

  return Array.from(scopes);
}

/**
 * Get affected packages from changed files.
 */
export function getAffectedPackages(
  baseBranch: string = "main",
  cwd: string = process.cwd(),
): Map<string, PackageInfo> {
  const packages = getAllPackages(cwd);
  const changedFiles = getChangedFiles(baseBranch, cwd);
  const affected = new Map<string, PackageInfo>();

  for (const file of changedFiles) {
    const pkg = fileToPackage(file, packages);
    if (pkg && !affected.has(pkg.name)) {
      affected.set(pkg.name, pkg);
    }
  }

  return affected;
}

/**
 * Get current branch name.
 */
export function getCurrentBranch(cwd: string = process.cwd()): string {
  try {
    return execSync("git symbolic-ref --short HEAD", {
      cwd,
      encoding: "utf-8",
    }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * Extract issue key from branch name.
 * Format: username/PROJ-123-description
 */
export function extractIssueKey(branch: string): string | null {
  const match = branch.match(/([A-Z]+-\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

function collectWorkspacePatterns(root: string): string[] {
  const packageJsonPatterns = readPackageJsonWorkspacePatterns(root);
  const pnpmPatterns = readPnpmWorkspacePatterns(root);
  const configuredPatterns = uniqueStrings([...packageJsonPatterns, ...pnpmPatterns]);

  if (configuredPatterns.length > 0) {
    if (configuredPatterns.some((p) => !p.startsWith("!"))) {
      return configuredPatterns;
    }

    const legacyPatterns = LEGACY_WORKSPACE_PATTERNS.filter((pattern) =>
      existsSync(join(root, extractPatternBaseDir(pattern))),
    );
    return uniqueStrings([...legacyPatterns, ...configuredPatterns]);
  }

  return LEGACY_WORKSPACE_PATTERNS.filter((pattern) =>
    existsSync(join(root, extractPatternBaseDir(pattern))),
  );
}

function readPackageJsonWorkspacePatterns(root: string): string[] {
  const packageJsonPath = join(root, "package.json");
  if (!existsSync(packageJsonPath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as WorkspacePackageJson;
    const workspaces = parsed.workspaces;

    if (Array.isArray(workspaces)) {
      return workspaces
        .map((pattern) => normalizeWorkspacePattern(pattern))
        .filter((pattern): pattern is string => pattern !== null);
    }

    if (workspaces && typeof workspaces === "object" && Array.isArray(workspaces.packages)) {
      return workspaces.packages
        .map((pattern) => normalizeWorkspacePattern(pattern))
        .filter((pattern): pattern is string => pattern !== null);
    }
  } catch {
    // Ignore invalid package.json
  }

  return [];
}

function readPnpmWorkspacePatterns(root: string): string[] {
  const workspacePath = join(root, "pnpm-workspace.yaml");
  if (!existsSync(workspacePath)) {
    return [];
  }

  const content = readFileSync(workspacePath, "utf-8");
  const lines = content.split(/\r?\n/);
  const patterns: string[] = [];

  let inPackages = false;
  let packagesIndent = 0;

  for (const line of lines) {
    if (!inPackages) {
      const headerMatch = line.match(/^(\s*)packages\s*:\s*$/);
      if (headerMatch) {
        inPackages = true;
        packagesIndent = headerMatch[1]?.length ?? 0;
      }
      continue;
    }

    if (!line.trim() || line.trim().startsWith("#")) {
      continue;
    }

    const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
    if (indent <= packagesIndent && !line.trim().startsWith("-")) {
      break;
    }

    const listItemMatch = line.match(/^\s*-\s*(.+)\s*$/);
    if (!listItemMatch) {
      continue;
    }

    let value = listItemMatch[1].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      const commentIndex = value.indexOf(" #");
      if (commentIndex >= 0) {
        value = value.slice(0, commentIndex).trim();
      }
    }

    const normalized = normalizeWorkspacePattern(value);
    if (normalized) {
      patterns.push(normalized);
    }
  }

  return uniqueStrings(patterns);
}

function discoverWorkspacePackageDirs(root: string, patterns: string[]): string[] {
  const includePatterns = patterns.filter((pattern) => !pattern.startsWith("!"));
  if (includePatterns.length === 0) {
    return [];
  }

  const includeRegexes = includePatterns.map((pattern) => globToRegex(pattern));
  const excludeRegexes = patterns
    .filter((pattern) => pattern.startsWith("!"))
    .map((pattern) => globToRegex(pattern.slice(1)));

  const baseDirs = uniqueStrings(includePatterns.map((pattern) => extractPatternBaseDir(pattern)));
  const visited = new Set<string>();
  const packageDirs = new Set<string>();

  for (const baseDir of baseDirs) {
    const startDir = baseDir === "." ? root : join(root, baseDir);
    if (!existsSync(startDir)) {
      continue;
    }

    walkDirectories(root, startDir, visited, (directory) => {
      const relativeDir = normalizePath(relative(root, directory));
      if (
        matchesWorkspacePatterns(relativeDir, includeRegexes, excludeRegexes) &&
        existsSync(join(directory, "package.json"))
      ) {
        packageDirs.add(directory);
      }
    });
  }

  return Array.from(packageDirs);
}

function walkDirectories(
  root: string,
  startDir: string,
  visited: Set<string>,
  visit: (directory: string) => void,
): void {
  const stack = [startDir];

  while (stack.length > 0) {
    const directory = stack.pop();
    if (!directory) continue;
    if (visited.has(directory)) continue;
    visited.add(directory);

    const rel = normalizePath(relative(root, directory));
    const dirName = rel === "." ? basename(root) : basename(directory);
    if (SKIP_SCAN_DIRS.has(dirName)) {
      continue;
    }

    visit(directory);

    let entries: Array<{
      name: string;
      isDirectory(): boolean;
      isSymbolicLink(): boolean;
    }> | null = null;

    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      entries = null;
    }

    if (!entries) continue;

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        continue;
      }
      if (SKIP_SCAN_DIRS.has(entry.name)) {
        continue;
      }
      if (entry.name.startsWith(".")) {
        continue;
      }
      stack.push(join(directory, entry.name));
    }
  }
}

function matchesWorkspacePatterns(
  relativeDir: string,
  includeRegexes: RegExp[],
  excludeRegexes: RegExp[],
): boolean {
  if (!includeRegexes.some((regex) => regex.test(relativeDir))) {
    return false;
  }

  return !excludeRegexes.some((regex) => regex.test(relativeDir));
}

function globToRegex(pattern: string): RegExp {
  const normalizedPattern = normalizePath(pattern);
  const doubleStarToken = "__DOUBLE_STAR__";
  const escaped = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, doubleStarToken)
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(new RegExp(doubleStarToken, "g"), ".*");

  return new RegExp(`^${escaped}$`);
}

function extractPatternBaseDir(pattern: string): string {
  const normalizedPattern = normalizePath(pattern.startsWith("!") ? pattern.slice(1) : pattern);
  const segments = normalizedPattern.split("/");
  const baseSegments: string[] = [];

  for (const segment of segments) {
    if (!segment) continue;
    if (/[*?[\]{}()]/.test(segment)) {
      break;
    }
    baseSegments.push(segment);
  }

  return baseSegments.length > 0 ? baseSegments.join("/") : ".";
}

function normalizeWorkspacePattern(pattern: string): string | null {
  const trimmed = pattern.trim();
  if (!trimmed) return null;

  const isExclude = trimmed.startsWith("!");
  let normalized = isExclude ? trimmed.slice(1).trim() : trimmed;
  normalized = normalized
    .replace(/^\.\/+/, "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  if (!normalized) normalized = ".";

  return isExclude ? `!${normalized}` : normalized;
}

function normalizePath(value: string): string {
  const normalized = value
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "");
  return normalized || ".";
}

function readPackageInfo(packagePath: string, root: string): PackageInfo | null {
  const packageJsonPath = join(packagePath, "package.json");
  if (!existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const pkgJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as WorkspacePackageJson;
    const relativePath = normalizePath(relative(root, packagePath));

    return {
      name: pkgJson.name || basename(packagePath),
      path: packagePath,
      relativePath,
      version: pkgJson.version || "0.0.0",
      private: pkgJson.private || false,
      isRoot: relativePath === ".",
    };
  } catch {
    return null;
  }
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }

  return unique;
}
