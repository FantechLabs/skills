import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { findMonorepoRoot } from './runtime';

export interface PackageInfo {
  name: string;
  path: string;
  relativePath: string;
  version: string;
  private: boolean;
}

export interface AffectedPackage extends PackageInfo {
  commits: string[];
  scope: string;
}

/**
 * Get all packages in monorepo
 */
export function getAllPackages(cwd: string = process.cwd()): PackageInfo[] {
  const root = findMonorepoRoot(cwd) || cwd;
  const packages: PackageInfo[] = [];

  // Standard monorepo directories
  const packageDirs = ['apps', 'packages', 'tooling'];

  for (const dir of packageDirs) {
    const dirPath = join(root, dir);
    if (!existsSync(dirPath)) continue;

    const entries = readdirSync(dirPath);
    for (const entry of entries) {
      const entryPath = join(dirPath, entry);
      const pkgJsonPath = join(entryPath, 'package.json');

      if (statSync(entryPath).isDirectory() && existsSync(pkgJsonPath)) {
        try {
          const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
          packages.push({
            name: pkgJson.name || entry,
            path: entryPath,
            relativePath: relative(root, entryPath),
            version: pkgJson.version || '0.0.0',
            private: pkgJson.private || false,
          });
        } catch {
          // Skip invalid package.json
        }
      }
    }
  }

  // Also check root package.json for non-monorepo
  const rootPkgPath = join(root, 'package.json');
  if (packages.length === 0 && existsSync(rootPkgPath)) {
    try {
      const pkgJson = JSON.parse(readFileSync(rootPkgPath, 'utf-8'));
      packages.push({
        name: pkgJson.name || basename(root),
        path: root,
        relativePath: '.',
        version: pkgJson.version || '0.0.0',
        private: pkgJson.private || false,
      });
    } catch {
      // Skip invalid package.json
    }
  }

  return packages;
}

/**
 * Get changed files since base branch
 */
export function getChangedFiles(
  baseBranch: string = 'main',
  cwd: string = process.cwd()
): string[] {
  try {
    // Get merge base
    const mergeBase = execSync(`git merge-base ${baseBranch} HEAD`, {
      cwd,
      encoding: 'utf-8',
    }).trim();

    // Get changed files
    const output = execSync(`git diff --name-only ${mergeBase}...HEAD`, {
      cwd,
      encoding: 'utf-8',
    });

    return output
      .trim()
      .split('\n')
      .filter((f) => f.length > 0);
  } catch {
    // Fallback: compare with base branch directly
    try {
      const output = execSync(`git diff --name-only ${baseBranch}...HEAD`, {
        cwd,
        encoding: 'utf-8',
      });
      return output
        .trim()
        .split('\n')
        .filter((f) => f.length > 0);
    } catch {
      return [];
    }
  }
}

/**
 * Map a file path to its package
 */
export function fileToPackage(
  filePath: string,
  packages: PackageInfo[]
): PackageInfo | null {
  for (const pkg of packages) {
    if (
      filePath.startsWith(pkg.relativePath + '/') ||
      filePath === pkg.relativePath
    ) {
      return pkg;
    }
  }
  return null;
}

/**
 * Extract scope from file path (directory name under apps/packages/tooling)
 */
export function extractScope(filePath: string): string | null {
  const match = filePath.match(/^(apps|packages|tooling)\/([^/]+)/);
  return match ? match[2] : null;
}

/**
 * Get affected packages from changed files
 */
export function getAffectedPackages(
  baseBranch: string = 'main',
  cwd: string = process.cwd()
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
 * Get current branch name
 */
export function getCurrentBranch(cwd: string = process.cwd()): string {
  try {
    return execSync('git symbolic-ref --short HEAD', {
      cwd,
      encoding: 'utf-8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Extract issue key from branch name
 * Format: username/PROJ-123-description
 */
export function extractIssueKey(branch: string): string | null {
  const match = branch.match(/([A-Z]+-\d+)/i);
  return match ? match[1].toUpperCase() : null;
}
