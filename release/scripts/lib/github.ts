import { execSync } from 'node:child_process';
import type { VersionedPackage } from './version';
import { formatForGitHubRelease, getLatestChangelogEntry } from './changelog';

export interface GitHubReleaseInfo {
  tag: string;
  title: string;
  body: string;
  prerelease: boolean;
  draft: boolean;
  url?: string;
}

export interface CreateReleaseResult {
  success: boolean;
  url?: string;
  error?: string;
}

/**
 * Check if gh CLI is authenticated
 */
export function isGhAuthenticated(): boolean {
  try {
    execSync('gh auth status', {
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get repository info from git remote
 */
export function getRepoInfo(cwd: string): { owner: string; repo: string } | null {
  try {
    const remote = execSync('git remote get-url origin', {
      cwd,
      encoding: 'utf-8',
    }).trim();

    // Parse GitHub URL
    // Formats: https://github.com/owner/repo.git or git@github.com:owner/repo.git
    const httpsMatch = remote.match(/github\.com\/([^/]+)\/([^/.]+)/);
    const sshMatch = remote.match(/github\.com:([^/]+)\/([^/.]+)/);

    const match = httpsMatch || sshMatch;
    if (match) {
      return {
        owner: match[1],
        repo: match[2].replace(/\.git$/, ''),
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Build GitHub release info for a package
 */
export function buildReleaseInfo(
  pkg: VersionedPackage,
  linearWorkspace?: string
): GitHubReleaseInfo {
  const tag = `${pkg.name}@${pkg.newVersion}`;
  const title = `${pkg.name} v${pkg.newVersion}`;

  // Get changelog entry
  const changelogEntry = getLatestChangelogEntry(pkg.path);

  let body = '';
  if (changelogEntry) {
    body = formatForGitHubRelease(changelogEntry, linearWorkspace);
  } else {
    body = `Release ${pkg.name} v${pkg.newVersion}`;
  }

  return {
    tag,
    title,
    body,
    prerelease: pkg.prerelease,
    draft: false,
  };
}

/**
 * Create a GitHub release
 */
export function createGitHubRelease(
  releaseInfo: GitHubReleaseInfo,
  cwd: string,
  dryRun: boolean = false
): CreateReleaseResult {
  if (dryRun) {
    console.log(`[dry-run] Would create release: ${releaseInfo.title}`);
    return { success: true };
  }

  if (!isGhAuthenticated()) {
    return {
      success: false,
      error: 'gh CLI not authenticated. Run: gh auth login',
    };
  }

  try {
    // Build gh release create command
    const args = [
      'gh', 'release', 'create',
      `"${releaseInfo.tag}"`,
      '--title', `"${releaseInfo.title}"`,
      '--notes', `"${escapeForShell(releaseInfo.body)}"`,
    ];

    if (releaseInfo.prerelease) {
      args.push('--prerelease');
    }

    if (releaseInfo.draft) {
      args.push('--draft');
    }

    const output = execSync(args.join(' '), {
      cwd,
      encoding: 'utf-8',
      shell: true,
    });

    // gh release create outputs the URL
    const url = output.trim();

    return {
      success: true,
      url,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || String(error),
    };
  }
}

/**
 * Create GitHub releases for all packages
 */
export function createGitHubReleases(
  packages: VersionedPackage[],
  cwd: string,
  options: {
    dryRun?: boolean;
    linearWorkspace?: string;
  } = {}
): Map<string, CreateReleaseResult> {
  const results = new Map<string, CreateReleaseResult>();

  for (const pkg of packages) {
    const releaseInfo = buildReleaseInfo(pkg, options.linearWorkspace);
    const result = createGitHubRelease(releaseInfo, cwd, options.dryRun);
    results.set(pkg.name, result);
  }

  return results;
}

/**
 * Check if a release already exists
 */
export function releaseExists(tag: string, cwd: string): boolean {
  try {
    execSync(`gh release view "${tag}"`, {
      cwd,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Escape string for shell command
 */
function escapeForShell(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`')
    .replace(/\n/g, '\\n');
}
