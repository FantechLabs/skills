import * as p from '@clack/prompts';
import type { BumpType } from './commits';

export interface BumpSelection {
  packageName: string;
  bump: BumpType;
  skipped: boolean;
}

export interface SummaryEdit {
  packageName: string;
  summary: string;
}

/**
 * Display intro banner
 */
export function intro(message: string): void {
  p.intro(message);
}

/**
 * Display outro banner
 */
export function outro(message: string): void {
  p.outro(message);
}

/**
 * Display a note
 */
export function note(message: string, title?: string): void {
  p.note(message, title);
}

/**
 * Display a log message
 */
export function log(message: string): void {
  p.log.message(message);
}

/**
 * Display a success message
 */
export function success(message: string): void {
  p.log.success(message);
}

/**
 * Display a warning message
 */
export function warn(message: string): void {
  p.log.warn(message);
}

/**
 * Display an error message
 */
export function error(message: string): void {
  p.log.error(message);
}

/**
 * Prompt for bump type selection
 */
export async function selectBumpType(
  packageName: string,
  suggestedBump: BumpType,
  reason: string
): Promise<BumpSelection> {
  const result = await p.select({
    message: `Bump type for ${packageName}?`,
    options: [
      {
        value: suggestedBump,
        label: `${suggestedBump} (suggested)`,
        hint: reason,
      },
      ...(suggestedBump !== 'patch'
        ? [{ value: 'patch' as const, label: 'patch' }]
        : []),
      ...(suggestedBump !== 'minor'
        ? [{ value: 'minor' as const, label: 'minor' }]
        : []),
      ...(suggestedBump !== 'major'
        ? [{ value: 'major' as const, label: 'major' }]
        : []),
      { value: 'skip' as const, label: 'skip', hint: 'no changeset' },
    ],
  });

  if (p.isCancel(result)) {
    p.cancel('Operation cancelled');
    process.exit(0);
  }

  return {
    packageName,
    bump: result === 'skip' ? 'none' : (result as BumpType),
    skipped: result === 'skip',
  };
}

/**
 * Prompt for summary editing
 */
export async function editSummary(
  packageName: string,
  suggestedSummary: string
): Promise<SummaryEdit> {
  const result = await p.text({
    message: `Summary for ${packageName}:`,
    defaultValue: suggestedSummary,
    placeholder: suggestedSummary,
  });

  if (p.isCancel(result)) {
    p.cancel('Operation cancelled');
    process.exit(0);
  }

  return {
    packageName,
    summary: result || suggestedSummary,
  };
}

/**
 * Prompt for confirmation
 */
export async function confirm(message: string): Promise<boolean> {
  const result = await p.confirm({
    message,
  });

  if (p.isCancel(result)) {
    p.cancel('Operation cancelled');
    process.exit(0);
  }

  return result;
}

/**
 * Prompt to create empty changeset
 */
export async function promptEmptyChangeset(): Promise<boolean> {
  return confirm('No user-facing changes detected. Create empty changeset?');
}

/**
 * Show spinner while executing async task
 */
export async function spinner<T>(
  message: string,
  task: () => Promise<T>
): Promise<T> {
  const s = p.spinner();
  s.start(message);
  try {
    const result = await task();
    s.stop(message + ' done');
    return result;
  } catch (err) {
    s.stop(message + ' failed');
    throw err;
  }
}

/**
 * Display commits for a package
 */
export function displayCommits(
  packageName: string,
  commits: string[],
  suggestedBump: BumpType,
  reason: string
): void {
  const commitList = commits.map((c) => `  - ${c}`).join('\n');
  p.note(
    `${commitList}\n\nSuggested bump: ${suggestedBump} (${reason})`,
    packageName
  );
}
