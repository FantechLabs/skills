export type CommitType =
  | "feat"
  | "fix"
  | "refactor"
  | "chore"
  | "docs"
  | "test"
  | "perf"
  | "ci"
  | "build"
  | "revert"
  | "style";

export interface CommitTypeInfo {
  emoji: string;
  label: string;
  description: string;
}

export const COMMIT_TYPES: Record<CommitType, CommitTypeInfo> = {
  feat: { emoji: "✨", label: "Feature", description: "New feature" },
  fix: { emoji: "🐛", label: "Bug Fix", description: "Bug fix" },
  refactor: { emoji: "♻️", label: "Refactor", description: "Code change with no behavior change" },
  chore: { emoji: "🔧", label: "Chore", description: "Maintenance, dependencies, or tooling" },
  docs: { emoji: "📝", label: "Docs", description: "Documentation only changes" },
  test: { emoji: "✅", label: "Test", description: "Test coverage changes" },
  perf: { emoji: "⚡", label: "Performance", description: "Performance improvements" },
  ci: { emoji: "👷", label: "CI/CD", description: "CI/CD pipeline or workflow changes" },
  build: { emoji: "📦", label: "Build", description: "Build system or dependencies" },
  revert: { emoji: "⏪", label: "Revert", description: "Revert an earlier commit" },
  style: {
    emoji: "💄",
    label: "Style",
    description: "Formatting and non-functional styling changes",
  },
};

export interface CommitData {
  type: CommitType;
  scope: string | null;
  emoji: string;
  description: string;
  body: string | null;
  breaking: boolean;
  issueKey: string | null;
  message: string;
}
