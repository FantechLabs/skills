import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface PrereleaseInfo {
  mode: string | null;
  tag: string | null;
}

export interface VersionedPackage {
  name: string;
  path: string;
  oldVersion: string;
  newVersion: string;
  bump: 'major' | 'minor' | 'patch';
  prerelease: boolean;
}

/**
 * Check if in prerelease mode by reading .changeset/pre.json
 */
export function getPrereleaseInfo(cwd: string): PrereleaseInfo {
  const preJsonPath = join(cwd, '.changeset', 'pre.json');

  if (!existsSync(preJsonPath)) {
    return { mode: null, tag: null };
  }

  try {
    const content = JSON.parse(readFileSync(preJsonPath, 'utf-8'));
    return {
      mode: content.mode || null,
      tag: content.tag || null,
    };
  } catch {
    return { mode: null, tag: null };
  }
}

/**
 * Get pending changeset files
 */
export function getPendingChangesets(cwd: string): string[] {
  const changesetDir = join(cwd, '.changeset');

  if (!existsSync(changesetDir)) {
    return [];
  }

  return readdirSync(changesetDir).filter(
    (f) =>
      f.endsWith('.md') &&
      f !== 'README.md' &&
      !f.startsWith('.')
  );
}

/**
 * Run changeset version and return versioned packages
 */
export function runChangesetVersion(
  cwd: string,
  dryRun: boolean = false
): VersionedPackage[] {
  if (dryRun) {
    // For dry run, we simulate by reading changesets
    return simulateVersion(cwd);
  }

  // Run actual changeset version
  try {
    execSync('pnpm changeset version', {
      cwd,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
  } catch (error) {
    throw new Error(`Failed to run changeset version: ${error}`);
  }

  // Parse git diff to find versioned packages
  return getVersionedPackagesFromDiff(cwd);
}

/**
 * Simulate version bumps by analyzing changesets
 */
function simulateVersion(cwd: string): VersionedPackage[] {
  const changesets = getPendingChangesets(cwd);
  const packageBumps = new Map<string, 'major' | 'minor' | 'patch'>();

  for (const file of changesets) {
    const content = readFileSync(join(cwd, '.changeset', file), 'utf-8');
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

    if (frontmatterMatch) {
      const lines = frontmatterMatch[1].split('\n');
      for (const line of lines) {
        const match = line.match(/^['"]?([^'"]+)['"]?\s*:\s*(major|minor|patch)/);
        if (match) {
          const [, pkg, bump] = match;
          const currentBump = packageBumps.get(pkg);
          // Take highest bump
          if (!currentBump || bumpPriority(bump as any) > bumpPriority(currentBump)) {
            packageBumps.set(pkg, bump as any);
          }
        }
      }
    }
  }

  // Get current versions and simulate new ones
  const result: VersionedPackage[] = [];
  const prerelease = getPrereleaseInfo(cwd);

  for (const [name, bump] of packageBumps) {
    const pkgInfo = findPackageInfo(cwd, name);
    if (pkgInfo) {
      const newVersion = bumpVersion(pkgInfo.version, bump, prerelease.tag);
      result.push({
        name,
        path: pkgInfo.path,
        oldVersion: pkgInfo.version,
        newVersion,
        bump,
        prerelease: !!prerelease.tag,
      });
    }
  }

  return result;
}

function bumpPriority(bump: 'major' | 'minor' | 'patch'): number {
  return { major: 3, minor: 2, patch: 1 }[bump];
}

function bumpVersion(
  version: string,
  bump: 'major' | 'minor' | 'patch',
  prereleaseTag: string | null
): string {
  // Strip existing prerelease suffix
  const baseVersion = version.replace(/-.*$/, '');
  const [major, minor, patch] = baseVersion.split('.').map(Number);

  let newMajor = major;
  let newMinor = minor;
  let newPatch = patch;

  switch (bump) {
    case 'major':
      newMajor++;
      newMinor = 0;
      newPatch = 0;
      break;
    case 'minor':
      newMinor++;
      newPatch = 0;
      break;
    case 'patch':
      newPatch++;
      break;
  }

  const newBase = `${newMajor}.${newMinor}.${newPatch}`;

  if (prereleaseTag) {
    // For prerelease, add suffix
    return `${newBase}-${prereleaseTag}.0`;
  }

  return newBase;
}

function findPackageInfo(
  cwd: string,
  name: string
): { path: string; version: string } | null {
  const dirs = ['apps', 'packages', 'tooling'];

  for (const dir of dirs) {
    const dirPath = join(cwd, dir);
    if (!existsSync(dirPath)) continue;

    const entries = readdirSync(dirPath);
    for (const entry of entries) {
      const pkgJsonPath = join(dirPath, entry, 'package.json');
      if (existsSync(pkgJsonPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
          if (pkg.name === name) {
            return {
              path: join(dirPath, entry),
              version: pkg.version || '0.0.0',
            };
          }
        } catch {
          // Skip invalid package.json
        }
      }
    }
  }

  return null;
}

function getVersionedPackagesFromDiff(cwd: string): VersionedPackage[] {
  // Get changed package.json files
  const diff = execSync('git diff --name-only HEAD~1', {
    cwd,
    encoding: 'utf-8',
  });

  const result: VersionedPackage[] = [];
  const prerelease = getPrereleaseInfo(cwd);

  const packageJsonFiles = diff
    .split('\n')
    .filter((f) => f.endsWith('package.json') && !f.startsWith('node_modules'));

  for (const file of packageJsonFiles) {
    const fullPath = join(cwd, file);
    if (!existsSync(fullPath)) continue;

    try {
      const pkg = JSON.parse(readFileSync(fullPath, 'utf-8'));

      // Get old version from git
      let oldVersion = '0.0.0';
      try {
        const oldContent = execSync(`git show HEAD~1:${file}`, {
          cwd,
          encoding: 'utf-8',
        });
        oldVersion = JSON.parse(oldContent).version || '0.0.0';
      } catch {
        // File might be new
      }

      if (pkg.version !== oldVersion) {
        result.push({
          name: pkg.name,
          path: join(cwd, file.replace('/package.json', '')),
          oldVersion,
          newVersion: pkg.version,
          bump: detectBumpType(oldVersion, pkg.version),
          prerelease: pkg.version.includes('-'),
        });
      }
    } catch {
      // Skip invalid package.json
    }
  }

  return result;
}

function detectBumpType(
  oldVersion: string,
  newVersion: string
): 'major' | 'minor' | 'patch' {
  const oldBase = oldVersion.replace(/-.*$/, '').split('.').map(Number);
  const newBase = newVersion.replace(/-.*$/, '').split('.').map(Number);

  if (newBase[0] > oldBase[0]) return 'major';
  if (newBase[1] > oldBase[1]) return 'minor';
  return 'patch';
}
