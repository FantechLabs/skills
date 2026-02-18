import { execSync } from "node:child_process";
import type { VersionedPackage } from "./version";

export interface TagInfo {
  tag: string;
  packageName: string;
  version: string;
  created: boolean;
}

/**
 * Check if a tag already exists
 */
export function tagExists(tag: string, cwd: string): boolean {
  try {
    execSync(`git rev-parse ${tag}`, {
      cwd,
      stdio: "pipe",
      encoding: "utf-8",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create git tag for a package
 */
export function createTag(pkg: VersionedPackage, cwd: string, dryRun: boolean = false): TagInfo {
  const tag = `${pkg.name}@${pkg.newVersion}`;

  if (dryRun) {
    return {
      tag,
      packageName: pkg.name,
      version: pkg.newVersion,
      created: false,
    };
  }

  if (tagExists(tag, cwd)) {
    console.log(`Tag ${tag} already exists, skipping`);
    return {
      tag,
      packageName: pkg.name,
      version: pkg.newVersion,
      created: false,
    };
  }

  try {
    execSync(`git tag -a "${tag}" -m "Release ${tag}"`, {
      cwd,
      stdio: "pipe",
      encoding: "utf-8",
    });

    return {
      tag,
      packageName: pkg.name,
      version: pkg.newVersion,
      created: true,
    };
  } catch (error) {
    throw new Error(`Failed to create tag ${tag}: ${String(error)}`, { cause: error });
  }
}

/**
 * Create tags for all versioned packages
 */
export function createTags(
  packages: VersionedPackage[],
  cwd: string,
  dryRun: boolean = false,
): TagInfo[] {
  return packages.map((pkg) => createTag(pkg, cwd, dryRun));
}

/**
 * Push tags to remote
 */
export function pushTags(cwd: string, dryRun: boolean = false): void {
  if (dryRun) {
    console.log("[dry-run] Would push tags to remote");
    return;
  }

  try {
    execSync("git push --follow-tags", {
      cwd,
      stdio: "pipe",
      encoding: "utf-8",
    });
  } catch (error) {
    throw new Error(`Failed to push tags: ${String(error)}`, { cause: error });
  }
}

/**
 * Get all existing tags for a package
 */
export function getPackageTags(packageName: string, cwd: string): string[] {
  try {
    const output = execSync(`git tag -l "${packageName}@*"`, {
      cwd,
      encoding: "utf-8",
    });

    return output
      .trim()
      .split("\n")
      .filter((t) => t.length > 0);
  } catch {
    return [];
  }
}

/**
 * Get the latest tag for a package
 */
export function getLatestTag(packageName: string, cwd: string): string | null {
  const tags = getPackageTags(packageName, cwd);

  if (tags.length === 0) {
    return null;
  }

  // Sort by semver (simplified)
  tags.sort((a, b) => {
    const versionA = a.replace(`${packageName}@`, "");
    const versionB = b.replace(`${packageName}@`, "");
    return compareVersions(versionB, versionA); // Descending
  });

  return tags[0];
}

function compareVersions(a: string, b: string): number {
  const partsA = a.replace(/-.*$/, "").split(".").map(Number);
  const partsB = b.replace(/-.*$/, "").split(".").map(Number);

  for (let i = 0; i < 3; i++) {
    if (partsA[i] > partsB[i]) return 1;
    if (partsA[i] < partsB[i]) return -1;
  }

  return 0;
}
