import { execSync } from 'node:child_process';

export type BumpType = 'major' | 'minor' | 'patch' | 'none';

export interface ParsedCommit {
  hash: string;
  type: string;
  scope: string | null;
  breaking: boolean;
  description: string;
  body: string | null;
  raw: string;
}

export interface CommitsByPackage {
  packageName: string;
  scope: string;
  commits: ParsedCommit[];
  suggestedBump: BumpType;
  reason: string;
}

// Commit types that require a changeset (user-facing)
const USER_FACING_TYPES = ['feat', 'fix', 'perf', 'refactor'];

// Commit types that don't require a changeset (internal)
const INTERNAL_TYPES = ['chore', 'docs', 'test', 'ci', 'build', 'style'];

/**
 * Parse a conventional commit message
 */
export function parseConventionalCommit(
  message: string,
  hash: string = ''
): ParsedCommit | null {
  // Match: type(scope)!: description or type!: description or type(scope): description
  const match = message.match(
    /^(\w+)(?:\(([^)]+)\))?(!)?\s*:\s*(?:\p{Emoji}\s*)?(.+)$/u
  );

  if (!match) {
    return null;
  }

  const [, type, scope, bang, description] = match;

  return {
    hash,
    type: type.toLowerCase(),
    scope: scope || null,
    breaking: !!bang,
    description: description.trim(),
    body: null,
    raw: message,
  };
}

/**
 * Get commits since base branch
 */
export function getCommitsSince(
  baseBranch: string = 'main',
  cwd: string = process.cwd()
): ParsedCommit[] {
  try {
    // Get merge base
    let mergeBase: string;
    try {
      mergeBase = execSync(`git merge-base ${baseBranch} HEAD`, {
        cwd,
        encoding: 'utf-8',
      }).trim();
    } catch {
      mergeBase = baseBranch;
    }

    // Get commits with hash and message
    const output = execSync(
      `git log ${mergeBase}..HEAD --format="%H|||%s|||%b<<<END>>>"`,
      {
        cwd,
        encoding: 'utf-8',
      }
    );

    const commits: ParsedCommit[] = [];
    const entries = output.split('<<<END>>>').filter((e) => e.trim());

    for (const entry of entries) {
      const parts = entry.trim().split('|||');
      if (parts.length >= 2) {
        const [hash, subject, body] = parts;
        const parsed = parseConventionalCommit(subject.trim(), hash.trim());
        if (parsed) {
          parsed.body = body?.trim() || null;
          commits.push(parsed);
        }
      }
    }

    return commits;
  } catch {
    return [];
  }
}

/**
 * Determine bump type from commit type
 */
export function getBumpFromCommitType(commit: ParsedCommit): BumpType {
  if (commit.breaking) return 'major';

  switch (commit.type) {
    case 'feat':
      return 'minor';
    case 'fix':
    case 'perf':
    case 'refactor':
      return 'patch';
    default:
      return 'none';
  }
}

/**
 * Get highest bump type (major > minor > patch > none)
 */
export function getHighestBump(bumps: BumpType[]): BumpType {
  if (bumps.includes('major')) return 'major';
  if (bumps.includes('minor')) return 'minor';
  if (bumps.includes('patch')) return 'patch';
  return 'none';
}

/**
 * Check if commit type requires a changeset
 */
export function requiresChangeset(type: string): boolean {
  return USER_FACING_TYPES.includes(type.toLowerCase());
}

/**
 * Check if all commits are internal (no changeset needed)
 */
export function allCommitsInternal(commits: ParsedCommit[]): boolean {
  return commits.every((c) => INTERNAL_TYPES.includes(c.type));
}

/**
 * Group commits by package scope
 */
export function groupCommitsByScope(
  commits: ParsedCommit[],
  scopeToPackage: Map<string, string>
): Map<string, CommitsByPackage> {
  const grouped = new Map<string, CommitsByPackage>();

  for (const commit of commits) {
    const scope = commit.scope;
    if (!scope) continue;

    const packageName = scopeToPackage.get(scope);
    if (!packageName) continue;

    if (!grouped.has(packageName)) {
      grouped.set(packageName, {
        packageName,
        scope,
        commits: [],
        suggestedBump: 'none',
        reason: '',
      });
    }

    const group = grouped.get(packageName)!;
    group.commits.push(commit);
  }

  // Calculate suggested bump for each package
  for (const [, group] of grouped) {
    const bumps = group.commits.map(getBumpFromCommitType);
    group.suggestedBump = getHighestBump(bumps);

    // Determine reason
    if (group.commits.some((c) => c.breaking)) {
      group.reason = 'breaking change detected';
    } else if (group.commits.some((c) => c.type === 'feat')) {
      group.reason = 'feat commit detected';
    } else if (group.commits.some((c) => c.type === 'fix')) {
      group.reason = 'fix commit detected';
    } else if (group.commits.some((c) => c.type === 'perf')) {
      group.reason = 'perf commit detected';
    } else if (group.commits.some((c) => c.type === 'refactor')) {
      group.reason = 'refactor commit detected';
    }
  }

  return grouped;
}

/**
 * Check if commits are related (same feature area)
 * Used for determining collapsed vs bullet format
 */
export function areCommitsRelated(commits: ParsedCommit[]): boolean {
  if (commits.length <= 2) return true;

  // Check if all commits have same scope
  const scopes = new Set(commits.map((c) => c.scope).filter(Boolean));
  if (scopes.size === 1) return true;

  // Check if all commits are same type (all fixes, all features)
  const types = new Set(commits.map((c) => c.type));
  if (types.size === 1) return true;

  // Check for common words in descriptions (simple heuristic)
  const words = commits.flatMap((c) =>
    c.description
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 4)
  );
  const wordCounts = new Map<string, number>();
  for (const word of words) {
    wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
  }

  // If any significant word appears in >50% of commits, they're related
  const threshold = commits.length / 2;
  for (const [, count] of wordCounts) {
    if (count >= threshold) return true;
  }

  return false;
}
