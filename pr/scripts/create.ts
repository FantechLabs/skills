#!/usr/bin/env node

import { execSync } from "node:child_process";
import { parseArgs } from "node:util";

import { getCurrentBranch, getDefaultTarget, detectPRType, extractIssueKey, extractVersion, branchToTitle } from "./lib/branch";
import { detectReviewBot } from "./lib/coderabbit";
import { checkChangeset, isChangesetExpected } from "./lib/changeset";
import { getCommitsSinceTarget, getDiffStats, findWIPCommits } from "./lib/commits";
import { assertGitRepo, ensureBranchPushed } from "./lib/git";
import { createGitHubPR } from "./lib/github";
import { createGitLabMR } from "./lib/gitlab";
import { detectPlatform, getPlatformReadinessError } from "./lib/platform";
import * as prompts from "./lib/prompts";
import { findMonorepoRoot, isInteractive } from "./lib/runtime";
import { suggestReviewers } from "./lib/reviewers";
import type { PRAnalysis, PRCreateParams, PRType } from "./lib/types";

const { values: args } = parseArgs({
  options: {
    ci: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    draft: { type: "boolean" },
    title: { type: "string" },
    body: { type: "string" },
    target: { type: "string" },
    reviewer: { type: "string", multiple: true },
    label: { type: "string", multiple: true },
    help: { type: "boolean", default: false },
  },
  allowPositionals: false,
});

function printHelp(): void {
  console.log(`
Usage: pr [options]

Options:
  --ci                Non-interactive mode
  --dry-run           Analyze only, output JSON
  --draft             Create as draft PR
  --title <title>     PR title (required in CI mode)
  --body <body>       PR description
  --target <branch>   Target branch (default: origin/HEAD -> main/master fallback)
  --reviewer <user>   Add reviewer (repeatable)
  --label <label>     Add label (repeatable)
  --help              Show this help
  `);
}

/**
 * Build suggested PR title based on branch type.
 */
function buildSuggestedTitle(
  prType: PRType,
  issueKey: string | null,
  version: string | null,
  branch: string,
  commits: { description: string }[],
): string {
  const inferred = commits.length === 1 ? commits[0].description : branchToTitle(branch);

  switch (prType) {
    case "feature":
      return issueKey ? `${issueKey} | ${inferred}` : inferred;
    case "release":
      return `Release v${version || "?"} | ${inferred}`;
    case "hotfix":
      return `Hotfix v${version || "?"} | ${inferred}`;
    default:
      return inferred;
  }
}

/**
 * Build PR description template.
 */
function buildDescription(analysis: PRAnalysis, reviewBotMode: boolean): string {
  const { commits, issueKey, changeset } = analysis;

  if (reviewBotMode) {
    const lines = ["## Summary", "", "<!-- @coderabbitai will generate a summary -->", ""];
    if (issueKey) lines.push(issueKey);
    return lines.join("\n");
  }

  const lines: string[] = [];

  lines.push("## Summary", "");
  lines.push("<!-- What does this PR do and why? -->", "");

  lines.push("## Changes", "");
  for (const commit of commits) {
    lines.push(`- ${commit.description}`);
  }
  lines.push("");

  if (changeset.exists && changeset.packages.length > 0) {
    lines.push(`**Packages affected:** ${changeset.packages.join(", ")}`, "");
  }

  lines.push("## Test Plan", "");
  lines.push("- [ ] Tested locally");
  lines.push("- [ ] Tests pass");
  lines.push("");

  lines.push("## Checklist", "");
  lines.push(`- [${changeset.exists ? "x" : " "}] Branch includes changeset`);
  lines.push("- [ ] Types pass");
  lines.push("- [ ] Linting passes");
  lines.push("");

  if (issueKey) lines.push(issueKey);

  return lines.join("\n");
}

/**
 * Analyze current branch state for PR creation.
 */
function analyze(cwd: string, targetOverride?: string): PRAnalysis {
  const platform = detectPlatform(cwd);
  const branch = getCurrentBranch(cwd);
  const target = targetOverride || getDefaultTarget(cwd);
  const prType = detectPRType(branch);
  const issueKey = extractIssueKey(branch);
  const version = extractVersion(branch);

  const commits = getCommitsSinceTarget(target, cwd);
  const diffStats = getDiffStats(target, cwd);
  const changeset = checkChangeset(cwd, target, issueKey);
  const reviewBot = detectReviewBot(cwd);
  const suggestedReviewers = suggestReviewers(diffStats.files, cwd);
  const wipCommits = findWIPCommits(commits);

  const draftReasons: string[] = [];
  if (wipCommits.length > 0) draftReasons.push("WIP commits detected");
  if (isChangesetExpected(cwd) && !changeset.exists) draftReasons.push("missing branch changeset");

  const warnings: string[] = [];
  if (platform === "unknown") {
    warnings.push("Unsupported or undetected git host (supported: GitHub/GitLab)");
  }
  if (commits.length === 0) {
    warnings.push(`No commits found between ${target} and HEAD`);
  }

  return {
    platform,
    branch,
    target,
    prType,
    issueKey,
    version,
    commits,
    diffStats,
    changeset,
    reviewBot,
    suggestedTitle: buildSuggestedTitle(prType, issueKey, version, branch, commits),
    suggestedReviewers,
    suggestDraft: draftReasons.length > 0,
    draftReasons,
    wipCommits,
    warnings,
  };
}

function ensureReadyForCreate(analysis: PRAnalysis, cwd: string): void {
  if (analysis.commits.length === 0) {
    throw new Error(`No commits to open PR for (target: ${analysis.target})`);
  }

  const platformError = getPlatformReadinessError(analysis.platform, cwd);
  if (platformError) {
    throw new Error(platformError);
  }
}

async function runInteractive(cwd: string): Promise<void> {
  prompts.intro();

  const target = args.target || (await prompts.selectTarget(getDefaultTarget(cwd)));
  let analysis = analyze(cwd, target);

  prompts.displayCommits(analysis.commits);
  prompts.log(`Target: ${analysis.target} | Platform: ${analysis.platform}`);

  if (analysis.issueKey) {
    prompts.log(`Issue: ${analysis.issueKey}`);
  }

  for (const warning of analysis.warnings) {
    prompts.warn(warning);
  }

  if (analysis.commits.length === 0) {
    prompts.outro("Nothing to open as PR");
    return;
  }

  // Changeset gate
  if (isChangesetExpected(cwd) && !analysis.changeset.exists) {
    const action = await prompts.confirmChangesetSkip();

    if (action === "run-changeset") {
      prompts.log("Running changeset skill...");
      try {
        execSync("bun changeset/scripts/create.ts", { cwd, stdio: "inherit" });
      } catch {
        prompts.warn("Changeset creation failed or was cancelled");
      }

      // Recompute complete analysis so all downstream fields are accurate.
      analysis = analyze(cwd, target);

      if (!analysis.changeset.exists) {
        prompts.warn("No branch changeset detected - draft is recommended");
      }
    } else if (action === "draft") {
      if (!analysis.draftReasons.includes("user chose draft due to missing changeset")) {
        analysis.draftReasons.push("user chose draft due to missing changeset");
      }
      analysis.suggestDraft = true;
    } else {
      prompts.outro("Cancelled");
      return;
    }
  }

  const title = await prompts.inputTitle(analysis.suggestedTitle);

  const reviewBotMode = !!analysis.reviewBot?.summaryEnabled;
  const suggestedBody = buildDescription(analysis, reviewBotMode);
  const body = await prompts.inputDescription(suggestedBody);

  const draft = await prompts.selectDraft(analysis.suggestDraft, analysis.draftReasons);
  const reviewers = await prompts.selectReviewers(analysis.suggestedReviewers);

  prompts.note(
    `Title: ${title}\nTarget: ${analysis.target}\nDraft: ${draft}\nReviewers: ${reviewers.join(", ") || "none"}`,
    "PR Preview",
  );

  const confirmed = await prompts.confirm("Create this PR?");
  if (!confirmed) {
    prompts.outro("Cancelled");
    return;
  }

  ensureReadyForCreate(analysis, cwd);
  ensureBranchPushed(cwd);

  const params: PRCreateParams = {
    title,
    body,
    target: analysis.target,
    draft,
    reviewers,
    labels: args.label || [],
  };

  if (analysis.platform === "github") {
    const result = createGitHubPR(params, cwd);
    if (result.success) {
      prompts.success(`PR created: ${result.url}`);
    } else {
      prompts.error(`Failed: ${result.error}`);
    }
  } else if (analysis.platform === "gitlab") {
    const result = createGitLabMR(params, cwd);
    if (result.success) {
      prompts.success(`MR created: ${result.url}`);
    } else {
      prompts.error(`Failed: ${result.error}`);
    }
  } else {
    prompts.error("Unsupported platform");
  }

  prompts.outro("Done");
}

async function main(): Promise<void> {
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const cwd = findMonorepoRoot(process.cwd()) || process.cwd();
  assertGitRepo(cwd);

  const interactive = isInteractive() && !args.ci && !args["dry-run"];

  if (args["dry-run"]) {
    const analysis = analyze(cwd, args.target);
    console.log(JSON.stringify(analysis, null, 2));
    return;
  }

  if (interactive) {
    await runInteractive(cwd);
    return;
  }

  // CI mode
  if (!args.title) {
    console.error("Error: --title is required in CI mode");
    process.exit(1);
  }

  const analysis = analyze(cwd, args.target);
  ensureReadyForCreate(analysis, cwd);
  ensureBranchPushed(cwd);

  const params: PRCreateParams = {
    title: args.title,
    body: args.body || buildDescription(analysis, !!analysis.reviewBot?.summaryEnabled),
    target: analysis.target,
    draft: args.draft ?? analysis.suggestDraft,
    reviewers: args.reviewer || [],
    labels: args.label || [],
  };

  if (analysis.platform === "github") {
    const result = createGitHubPR(params, cwd);
    if (!result.success) {
      console.error(`Failed: ${result.error}`);
      process.exit(1);
    }

    console.log(result.url);
    return;
  }

  if (analysis.platform === "gitlab") {
    const result = createGitLabMR(params, cwd);
    if (!result.success) {
      console.error(`Failed: ${result.error}`);
      process.exit(1);
    }

    console.log(result.url);
    return;
  }

  console.error("Failed: unsupported platform");
  process.exit(1);
}

main().catch((error) => {
  console.error("Error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
