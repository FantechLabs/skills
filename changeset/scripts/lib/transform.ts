import type { ParsedCommit } from './commits';

/**
 * Verb transformations: imperative → past tense
 */
const VERB_MAP: Record<string, string> = {
  add: 'Added',
  added: 'Added',
  fix: 'Fixed',
  fixed: 'Fixed',
  update: 'Updated',
  updated: 'Updated',
  remove: 'Removed',
  removed: 'Removed',
  delete: 'Deleted',
  deleted: 'Deleted',
  improve: 'Improved',
  improved: 'Improved',
  refactor: 'Refactored',
  refactored: 'Refactored',
  implement: 'Implemented',
  implemented: 'Implemented',
  change: 'Changed',
  changed: 'Changed',
  correct: 'Corrected',
  corrected: 'Corrected',
  handle: 'Added handling for',
  handled: 'Added handling for',
  support: 'Added support for',
  supported: 'Added support for',
  enable: 'Enabled',
  enabled: 'Enabled',
  disable: 'Disabled',
  disabled: 'Disabled',
  extract: 'Extracted',
  extracted: 'Extracted',
  optimize: 'Optimized',
  optimized: 'Optimized',
  simplify: 'Simplified',
  simplified: 'Simplified',
  replace: 'Replaced',
  replaced: 'Replaced',
  rename: 'Renamed',
  renamed: 'Renamed',
  move: 'Moved',
  moved: 'Moved',
  create: 'Created',
  created: 'Created',
  introduce: 'Introduced',
  introduced: 'Introduced',
  integrate: 'Integrated',
  integrated: 'Integrated',
  migrate: 'Migrated',
  migrated: 'Migrated',
  upgrade: 'Upgraded',
  upgraded: 'Upgraded',
  downgrade: 'Downgraded',
  downgraded: 'Downgraded',
  bump: 'Bumped',
  bumped: 'Bumped',
  enhance: 'Enhanced',
  enhanced: 'Enhanced',
  extend: 'Extended',
  extended: 'Extended',
  clean: 'Cleaned',
  cleaned: 'Cleaned',
  cleanup: 'Cleaned up',
  revert: 'Reverted',
  reverted: 'Reverted',
  prevent: 'Prevented',
  prevented: 'Prevented',
  allow: 'Allowed',
  allowed: 'Allowed',
  ensure: 'Ensured',
  ensured: 'Ensured',
  validate: 'Validated',
  validated: 'Validated',
  normalize: 'Normalized',
  normalized: 'Normalized',
  resolve: 'Resolved',
  resolved: 'Resolved',
  reduce: 'Reduced',
  reduced: 'Reduced',
  increase: 'Increased',
  increased: 'Increased',
  decrease: 'Decreased',
  decreased: 'Decreased',
  set: 'Set',
  use: 'Used',
  make: 'Made',
  made: 'Made',
  get: 'Got',
  show: 'Showed',
  showed: 'Showed',
  hide: 'Hid',
  hidden: 'Hid',
  expose: 'Exposed',
  exposed: 'Exposed',
  configure: 'Configured',
  configured: 'Configured',
  drop: 'Dropped',
  dropped: 'Dropped',
  deprecate: 'Deprecated',
  deprecated: 'Deprecated',
  wrap: 'Wrapped',
  wrapped: 'Wrapped',
  unwrap: 'Unwrapped',
  unwrapped: 'Unwrapped',
};

/**
 * Capitalize first letter
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Transform first word to past tense if it's a verb
 */
function transformVerb(word: string): string {
  const lower = word.toLowerCase();
  return VERB_MAP[lower] || capitalize(word);
}

/**
 * Transform a commit description into changelog-friendly format
 */
export function transformDescription(description: string): string {
  // Remove any leading emoji
  const withoutEmoji = description.replace(/^\p{Emoji}\s*/u, '').trim();

  if (!withoutEmoji) return '';

  // Split into words
  const words = withoutEmoji.split(/\s+/);
  if (words.length === 0) return '';

  // Transform first verb
  words[0] = transformVerb(words[0]);

  return words.join(' ');
}

/**
 * Transform a full commit message (removes type, scope, emoji)
 */
export function transformCommitMessage(message: string): string {
  // Match: type(scope): emoji description or type: emoji description
  const match = message.match(
    /^\w+(?:\([^)]+\))?!?\s*:\s*(?:\p{Emoji}\s*)?(.+)$/u
  );

  const description = match ? match[1].trim() : message.trim();
  return transformDescription(description);
}

/**
 * Transform a parsed commit
 */
export function transformCommit(commit: ParsedCommit): string {
  return transformDescription(commit.description);
}

/**
 * Combine multiple transformed descriptions into one
 */
export function combineDescriptions(
  descriptions: string[],
  format: 'collapsed' | 'bullets' = 'collapsed'
): string {
  const unique = [...new Set(descriptions.filter(Boolean))];

  if (unique.length === 0) return '';
  if (unique.length === 1) return unique[0];

  if (format === 'bullets') {
    return unique.map((d) => `- ${d}`).join('\n');
  }

  // Collapsed: join with semicolons
  return unique.join('; ');
}

/**
 * Transform multiple commits into a summary
 */
export function transformCommits(
  commits: ParsedCommit[],
  format: 'collapsed' | 'bullets' = 'collapsed'
): string {
  const descriptions = commits.map(transformCommit);
  return combineDescriptions(descriptions, format);
}

/**
 * Generate changeset content for a single package
 */
export function generatePackageSummary(
  packageName: string,
  commits: ParsedCommit[],
  format: 'collapsed' | 'bullets' = 'collapsed'
): string {
  const summary = transformCommits(commits, format);

  if (format === 'bullets') {
    return `**${packageName}**\n${summary}`;
  }

  return `**${packageName}**\n${summary}`;
}
