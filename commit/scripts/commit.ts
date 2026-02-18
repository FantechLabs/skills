#!/usr/bin/env node

import { parseArgs } from "node:util";

import { extractIssueKey, getCurrentBranch, inferScopeFromFiles } from "./lib/detect.js";
import { createCommit, getFileStatus, getGitRoot } from "./lib/git.js";
import { isInteractive } from "./lib/runtime.js";
import * as prompts from "./lib/prompts.js";
import { COMMIT_TYPES, type CommitData, type CommitType } from "./lib/types.js";

const { values: args } = parseArgs({
  options: {
    ci: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    type: { type: "string" },
    scope: { type: "string" },
    message: { type: "string" },
    body: { type: "string" },
    issue: { type: "string" },
    breaking: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
  allowPositionals: false,
});

function printHelp(): void {
  console.log(`
Usage: commit [options]

Options:
  --ci               Non-interactive mode
  --dry-run          Output commit payload as JSON (no git commit)
  --type <type>      Commit type (feat, fix, chore, ...)
  --scope <scope>    Commit scope (optional)
  --message <desc>   Commit description
  --body <text>      Commit body (optional)
  --issue <key>      Explicit issue key footer (e.g. PROD-123)
  --breaking         Mark as breaking change
  --help             Show help
`);
}

function formatMessage(data: CommitData): string {
  const scopePart = data.scope ? `(${data.scope})` : "";
  const bangPart = data.breaking ? "!" : "";

  let message = `${data.type}${scopePart}${bangPart}: ${data.emoji} ${data.description}`;

  const footerLines: string[] = [];
  if (data.breaking) {
    footerLines.push("BREAKING CHANGE: describe the breaking change");
  }
  if (data.issueKey) {
    footerLines.push(data.issueKey);
  }

  if (data.body || footerLines.length > 0) {
    message += "\n";
    if (data.body) {
      message += `\n${data.body}`;
    }
    if (footerLines.length > 0) {
      message += `\n${footerLines.join("\n")}`;
    }
  }

  return message;
}

function validateTypeOrExit(rawType: string | undefined): CommitType {
  if (!rawType) {
    console.error("Error: --type is required in non-interactive mode");
    process.exit(1);
  }

  if (!(rawType in COMMIT_TYPES)) {
    console.error(
      `Error: Invalid type "${rawType}". Valid types: ${Object.keys(COMMIT_TYPES).join(", ")}`,
    );
    process.exit(1);
  }

  return rawType as CommitType;
}

async function runInteractive(cwd: string): Promise<void> {
  prompts.intro();

  const status = getFileStatus(cwd);

  if (status.staged.length === 0) {
    prompts.warn("No staged files found. Stage files deliberately before creating a commit.");
    prompts.showStageRequired(status.unstaged, status.untracked);
    prompts.outro("Nothing committed. Stage changes and rerun.");
    return;
  }

  const branch = getCurrentBranch(cwd);
  const detectedIssueKey = extractIssueKey(branch);
  const suggestedScope = inferScopeFromFiles(status.staged, cwd);

  if (detectedIssueKey) {
    prompts.log(`Detected issue key from branch: ${detectedIssueKey}`);
  }

  const type = await prompts.selectType();
  const scope = await prompts.inputScope(suggestedScope);
  const description = await prompts.inputDescription();
  const body = await prompts.inputBody();
  const breaking = await prompts.confirmBreaking();

  const data: CommitData = {
    type,
    scope,
    emoji: COMMIT_TYPES[type].emoji,
    description,
    body,
    breaking,
    issueKey: detectedIssueKey,
    message: "",
  };

  data.message = formatMessage(data);

  const confirmed = await prompts.confirmCommit(data.message);
  if (!confirmed) {
    prompts.outro("Cancelled");
    return;
  }

  createCommit(data.message, cwd);
  prompts.outro("Committed");
}

function runNonInteractive(cwd: string): CommitData {
  const type = validateTypeOrExit(args.type);

  if (!args.message?.trim()) {
    console.error("Error: --message is required in non-interactive mode");
    process.exit(1);
  }

  const issueKey = args.issue || extractIssueKey(getCurrentBranch(cwd));
  const status = getFileStatus(cwd);

  if (!args["dry-run"] && status.staged.length === 0) {
    console.error(
      "Error: No staged files found. Stage files before running non-interactive commit.",
    );
    process.exit(1);
  }

  const data: CommitData = {
    type,
    scope: args.scope?.trim() ? args.scope.trim() : null,
    emoji: COMMIT_TYPES[type].emoji,
    description: args.message.trim(),
    body: args.body?.trim() ? args.body.trim() : null,
    breaking: args.breaking || false,
    issueKey,
    message: "",
  };

  data.message = formatMessage(data);
  return data;
}

async function main(): Promise<void> {
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const cwd = getGitRoot(process.cwd());
  const interactive = isInteractive() && !args.ci && !args["dry-run"];

  if (interactive) {
    await runInteractive(cwd);
    return;
  }

  const data = runNonInteractive(cwd);

  if (args["dry-run"]) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  createCommit(data.message, cwd);
  console.log(`Committed: ${data.message.split("\n")[0]}`);
}

main().catch((error) => {
  console.error("Error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
