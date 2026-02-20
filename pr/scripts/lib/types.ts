export type Platform = "github" | "gitlab" | "unknown";

export type PRType = "feature" | "release" | "hotfix" | "generic";

export interface CommitInfo {
  hash: string;
  message: string;
  type: string | null;
  scope: string | null;
  description: string;
}

export interface DiffStats {
  filesChanged: number;
  additions: number;
  deletions: number;
  files: string[];
}

export interface ChangesetInfo {
  exists: boolean;
  file: string | null;
  packages: string[];
  branchFiles: string[];
}

export interface ReviewBotInfo {
  name: string;
  summaryEnabled: boolean;
}

export interface ReviewerSuggestion {
  username: string;
  source: "codeowners" | "git-history";
  reason: string;
  selectable: boolean;
}

export interface PRAnalysis {
  platform: Platform;
  branch: string;
  target: string;
  prType: PRType;
  issueKey: string | null;
  version: string | null;
  commits: CommitInfo[];
  diffStats: DiffStats;
  changeset: ChangesetInfo;
  reviewBot: ReviewBotInfo | null;
  suggestedTitle: string;
  suggestedReviewers: ReviewerSuggestion[];
  suggestDraft: boolean;
  draftReasons: string[];
  wipCommits: string[];
  warnings: string[];
}

export interface PRCreateParams {
  title: string;
  body: string;
  target: string;
  draft: boolean;
  reviewers: string[];
  labels: string[];
}
