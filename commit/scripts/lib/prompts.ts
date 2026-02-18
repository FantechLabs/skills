import * as p from "@clack/prompts";
import { COMMIT_TYPES, type CommitType } from "./types.js";

export function intro(): void {
  p.intro("Create commit");
}

export function outro(message: string): void {
  p.outro(message);
}

export function warn(message: string): void {
  p.log.warn(message);
}

export function log(message: string): void {
  p.log.message(message);
}

export function note(message: string, title?: string): void {
  p.note(message, title);
}

export async function selectType(): Promise<CommitType> {
  const typeOptions = (
    Object.entries(COMMIT_TYPES) as Array<[CommitType, (typeof COMMIT_TYPES)[CommitType]]>
  ).map(([type, info]) => ({
    value: type,
    label: `${info.emoji} ${type}`,
    hint: info.description,
  }));

  const result = await p.select<CommitType>({
    message: "Commit type",
    options: typeOptions,
  });

  if (p.isCancel(result)) {
    p.cancel("Cancelled");
    process.exit(0);
  }

  return result;
}

export async function inputScope(suggested: string | null): Promise<string | null> {
  const result = await p.text({
    message: "Scope (optional)",
    defaultValue: suggested || "",
    placeholder: suggested || "e.g. web, ui, repo",
  });

  if (p.isCancel(result)) {
    p.cancel("Cancelled");
    process.exit(0);
  }

  return result.trim() ? result.trim() : null;
}

export async function inputDescription(): Promise<string> {
  const result = await p.text({
    message: "Description",
    placeholder: "imperative and concise",
    validate: (value) => {
      if (!value.trim()) {
        return "Description is required";
      }
      if (value.length > 80) {
        return "Keep the description under 80 characters";
      }
      return undefined;
    },
  });

  if (p.isCancel(result)) {
    p.cancel("Cancelled");
    process.exit(0);
  }

  return result.trim();
}

export async function inputBody(): Promise<string | null> {
  const result = await p.text({
    message: "Body (optional)",
    placeholder: "Explain why, not what. Press enter to skip.",
  });

  if (p.isCancel(result)) {
    p.cancel("Cancelled");
    process.exit(0);
  }

  return result.trim() ? result.trim() : null;
}

export async function confirmBreaking(): Promise<boolean> {
  const result = await p.confirm({
    message: "Breaking change?",
    initialValue: false,
  });

  if (p.isCancel(result)) {
    p.cancel("Cancelled");
    process.exit(0);
  }

  return result;
}

export async function confirmCommit(preview: string): Promise<boolean> {
  p.note(preview, "Commit preview");

  const result = await p.confirm({
    message: "Create this commit?",
    initialValue: true,
  });

  if (p.isCancel(result)) {
    p.cancel("Cancelled");
    process.exit(0);
  }

  return result;
}

export function showStageRequired(unstaged: string[], untracked: string[]): void {
  const all = [...unstaged, ...untracked];
  const preview = all.length > 0 ? all.map((file) => `- ${file}`).join("\n") : "No changed files";
  p.note(preview, "Changes detected (not staged)");
}
