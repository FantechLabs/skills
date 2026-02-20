import * as p from "@clack/prompts";

import type { CommitInfo, ReviewerSuggestion } from "./types";

export function intro(): void {
  p.intro("Create pull request");
}

export function outro(message: string): void {
  p.outro(message);
}

export function note(message: string, title?: string): void {
  p.note(message, title);
}

export function log(message: string): void {
  p.log.message(message);
}

export function success(message: string): void {
  p.log.success(message);
}

export function warn(message: string): void {
  p.log.warn(message);
}

export function error(message: string): void {
  p.log.error(message);
}

export async function confirm(message: string): Promise<boolean> {
  const result = await p.confirm({ message });
  if (p.isCancel(result)) {
    p.cancel("Cancelled");
    process.exit(0);
  }
  return result;
}

export async function inputTitle(suggested: string): Promise<string> {
  const result = await p.text({
    message: "PR title:",
    defaultValue: suggested,
    placeholder: suggested,
    validate: (value) => {
      if (!value.trim()) return "Title is required";
    },
  });

  if (p.isCancel(result)) {
    p.cancel("Cancelled");
    process.exit(0);
  }

  return result;
}

export async function inputDescription(suggested: string): Promise<string> {
  const result = await p.text({
    message: "PR description (markdown):",
    defaultValue: suggested,
    placeholder: "Enter description or accept suggested...",
  });

  if (p.isCancel(result)) {
    p.cancel("Cancelled");
    process.exit(0);
  }

  return result || suggested;
}

export async function selectTarget(defaultTarget: string): Promise<string> {
  const result = await p.text({
    message: "Target branch:",
    defaultValue: defaultTarget,
    placeholder: defaultTarget,
  });

  if (p.isCancel(result)) {
    p.cancel("Cancelled");
    process.exit(0);
  }

  return result || defaultTarget;
}

export async function selectDraft(suggestDraft: boolean, reasons: string[]): Promise<boolean> {
  if (reasons.length > 0) {
    p.log.warn(`Suggesting draft because: ${reasons.join(", ")}`);
  }

  const result = await p.confirm({
    message: suggestDraft ? "Create as draft?" : "Create as draft? (ready by default)",
    initialValue: suggestDraft,
  });

  if (p.isCancel(result)) {
    p.cancel("Cancelled");
    process.exit(0);
  }

  return result;
}

export async function selectReviewers(suggestions: ReviewerSuggestion[]): Promise<string[]> {
  if (suggestions.length === 0) return [];

  const selectable = suggestions.filter((suggestion) => suggestion.selectable);
  const advisory = suggestions.filter((suggestion) => !suggestion.selectable);

  if (advisory.length > 0) {
    p.note(
      advisory.map((suggestion) => `- ${suggestion.username} (${suggestion.reason})`).join("\n"),
      "Contributor hints (manual reviewer assignment)",
    );
  }

  if (selectable.length === 0) return [];

  const result = await p.multiselect({
    message: "Add reviewers?",
    options: selectable.map((suggestion) => ({
      value: suggestion.username,
      label: suggestion.username,
      hint: `${suggestion.source}: ${suggestion.reason}`,
    })),
    required: false,
  });

  if (p.isCancel(result)) {
    p.cancel("Cancelled");
    process.exit(0);
  }

  return result as string[];
}

export async function confirmChangesetSkip(): Promise<"run-changeset" | "draft" | "cancel"> {
  const result = await p.select({
    message: "No branch changeset found. What to do?",
    options: [
      { value: "run-changeset", label: "Create changeset now", hint: "Runs changeset skill" },
      { value: "draft", label: "Continue as draft PR", hint: "PR will be draft" },
      { value: "cancel", label: "Cancel", hint: "Create changeset manually first" },
    ],
  });

  if (p.isCancel(result)) {
    p.cancel("Cancelled");
    process.exit(0);
  }

  return result as "run-changeset" | "draft" | "cancel";
}

export function displayCommits(commits: CommitInfo[]): void {
  const list = commits.map((commit) => `  ${commit.hash.slice(0, 7)} ${commit.message}`).join("\n");
  p.note(list || "(no commits)", `${commits.length} commit(s)`);
}
