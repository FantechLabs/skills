import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ChangelogEntry {
  version: string;
  date: string;
  content: string;
  linearIssues: string[];
}

/**
 * Read CHANGELOG.md and extract the latest version entry
 */
export function getLatestChangelogEntry(packagePath: string): ChangelogEntry | null {
  const changelogPath = join(packagePath, "CHANGELOG.md");

  if (!existsSync(changelogPath)) {
    return null;
  }

  const content = readFileSync(changelogPath, "utf-8");

  // Match version header pattern: ## X.Y.Z or ## [X.Y.Z]
  const versionPattern = /^## \[?(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)\]?/gm;
  const matches = [...content.matchAll(versionPattern)];

  if (matches.length === 0) {
    return null;
  }

  const latestMatch = matches[0];
  const version = latestMatch[1];
  const startIndex = latestMatch.index! + latestMatch[0].length;

  // Find end of this version's content (next version header or end of file)
  let endIndex = content.length;
  if (matches.length > 1) {
    endIndex = matches[1].index!;
  }

  const entryContent = content.slice(startIndex, endIndex).trim();

  // Extract Linear issue references
  const linearIssues = extractLinearIssues(entryContent);

  // Extract date if present (format: ## X.Y.Z - YYYY-MM-DD or similar)
  const dateMatch = content.slice(latestMatch.index!, startIndex).match(/(\d{4}-\d{2}-\d{2})/);

  return {
    version,
    date: dateMatch ? dateMatch[1] : new Date().toISOString().split("T")[0],
    content: entryContent,
    linearIssues,
  };
}

/**
 * Extract Linear issue keys from text (e.g., PROD-123, ENG-456)
 */
export function extractLinearIssues(text: string): string[] {
  const pattern = /([A-Z]+-\d+)/g;
  const matches = text.match(pattern) || [];
  return [...new Set(matches)];
}

/**
 * Format changelog entry for GitHub release
 */
export function formatForGitHubRelease(entry: ChangelogEntry, linearWorkspace?: string): string {
  let content = entry.content;

  // Add Linear links if workspace is provided
  if (linearWorkspace && entry.linearIssues.length > 0) {
    for (const issue of entry.linearIssues) {
      const link = `[${issue}](https://linear.app/${linearWorkspace}/issue/${issue})`;
      content = content.replace(new RegExp(`\\b${issue}\\b`, "g"), link);
    }
  }

  return content;
}

/**
 * Combine multiple changelog entries into a unified release body
 */
export function combineChangelogEntries(
  entries: Array<{ packageName: string; entry: ChangelogEntry }>,
  linearWorkspace?: string,
): string {
  if (entries.length === 0) {
    return "No changelog entries found.";
  }

  if (entries.length === 1) {
    return formatForGitHubRelease(entries[0].entry, linearWorkspace);
  }

  return entries
    .map(({ packageName, entry }) => {
      const formattedContent = formatForGitHubRelease(entry, linearWorkspace);
      return `## ${packageName}\n\n${formattedContent}`;
    })
    .join("\n\n---\n\n");
}

/**
 * Get all Linear issues from multiple changelog entries
 */
export function getAllLinearIssues(entries: Array<{ entry: ChangelogEntry }>): string[] {
  const allIssues = entries.flatMap(({ entry }) => entry.linearIssues);
  return [...new Set(allIssues)];
}
