#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import {
  allCommitsInternal,
  areCommitsRelated,
  getCommitsSince,
  groupCommitsByScope,
  type BumpType,
  type ParsedCommit,
} from "./lib/commits";
import {
  extractIssueKey,
  extractScope,
  getAllPackages,
  getChangedFiles,
  getCurrentBranch,
} from "./lib/packages";
import * as prompts from "./lib/prompts";
import { findMonorepoRoot, isInteractive } from "./lib/runtime";
import { transformCommits } from "./lib/transform";

// Parse command line arguments
const { values: args } = parseArgs({
  options: {
    ci: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    "no-ai": { type: "boolean", default: false },
    bullets: { type: "boolean", default: false },
    collapsed: { type: "boolean", default: false },
    "skip-empty": { type: "boolean", default: false },
    bump: { type: "string" },
    summary: { type: "string" },
    help: { type: "boolean", default: false },
  },
  allowPositionals: true,
});

interface PackageAnalysis {
  name: string;
  path: string;
  currentVersion: string;
  suggestedBump: BumpType;
  reason: string;
  commits: string[];
  parsedCommits: ParsedCommit[];
  codeTransform: string;
  suggestedFormat: "collapsed" | "bullets";
}

interface AnalysisResult {
  branch: string;
  issueKey: string | null;
  packages: PackageAnalysis[];
  changesetFile: string;
  noChangesetNeeded: boolean;
}

function printHelp(): void {
  console.log(`
Usage: create-changeset [options]

Options:
  --ci              Non-interactive mode (for agents/CI)
  --dry-run         Analyze only, don't create files
  --no-ai           Skip AI polish (code transform only)
  --bullets         Force bullet format
  --collapsed       Force collapsed format
  --skip-empty      Don't create empty changeset for internal changes
  --bump <spec>     Override bumps (e.g., "ui:minor,utils:patch")
  --summary <spec>  Override summaries (e.g., "ui:Added feature")
  --help            Show this help
  `);
}

/**
 * Parse bump overrides from CLI
 * Format: "ui:minor,utils:patch"
 */
function parseBumpOverrides(spec: string): Map<string, BumpType> {
  const overrides = new Map<string, BumpType>();
  for (const part of spec.split(",")) {
    const [scope, bump] = part.split(":");
    if (scope && bump && ["major", "minor", "patch"].includes(bump)) {
      overrides.set(scope.trim(), bump as BumpType);
    }
  }
  return overrides;
}

/**
 * Parse summary overrides from CLI
 * Format: "ui:Added feature,utils:Fixed bug"
 */
function parseSummaryOverrides(spec: string): Map<string, string> {
  const overrides = new Map<string, string>();
  for (const part of spec.split(",")) {
    const colonIndex = part.indexOf(":");
    if (colonIndex > 0) {
      const scope = part.slice(0, colonIndex).trim();
      const summary = part.slice(colonIndex + 1).trim();
      if (scope && summary) {
        overrides.set(scope, summary);
      }
    }
  }
  return overrides;
}

/**
 * Analyze commits and packages
 */
function analyze(cwd: string): AnalysisResult {
  const branch = getCurrentBranch(cwd);
  const issueKey = extractIssueKey(branch);
  const packages = getAllPackages(cwd);

  // Build scope → package name mapping
  const scopeToPackage = new Map<string, string>();
  for (const pkg of packages) {
    const scope = extractScope(pkg.relativePath);
    if (scope) {
      scopeToPackage.set(scope, pkg.name);
    }
  }

  // Get commits and group by scope
  const commits = getCommitsSince("main", cwd);
  const grouped = groupCommitsByScope(commits, scopeToPackage);

  // Also check changed files for packages without scoped commits
  const changedFiles = getChangedFiles("main", cwd);
  for (const file of changedFiles) {
    const scope = extractScope(file);
    if (!scope) continue;

    const pkg = packages.find((p) => p.relativePath.includes(scope));
    if (pkg && !grouped.has(pkg.name)) {
      // Package has changes but no scoped commits - check for unscoped commits
      const unscopedCommits = commits.filter((c) => !c.scope);
      if (unscopedCommits.length > 0) {
        grouped.set(pkg.name, {
          packageName: pkg.name,
          scope,
          commits: unscopedCommits,
          suggestedBump: "patch",
          reason: "changes detected",
        });
      }
    }
  }

  // Check if all commits are internal
  const noChangesetNeeded = allCommitsInternal(commits);

  // Build analysis result
  const analysisPackages: PackageAnalysis[] = [];

  for (const [pkgName, group] of grouped) {
    const pkg = packages.find((p) => p.name === pkgName);
    if (!pkg) continue;

    // Filter out internal-only commits for bump calculation
    const userFacingCommits = group.commits.filter((c) =>
      ["feat", "fix", "perf", "refactor"].includes(c.type),
    );

    if (userFacingCommits.length === 0 && !noChangesetNeeded) {
      continue; // Skip packages with only internal changes
    }

    const commitsToUse = userFacingCommits.length > 0 ? userFacingCommits : group.commits;
    const related = areCommitsRelated(commitsToUse);

    analysisPackages.push({
      name: pkgName,
      path: pkg.path,
      currentVersion: pkg.version,
      suggestedBump: group.suggestedBump,
      reason: group.reason,
      commits: group.commits.map((c) => c.raw),
      parsedCommits: group.commits,
      codeTransform: transformCommits(commitsToUse, "collapsed"),
      suggestedFormat: related ? "collapsed" : "bullets",
    });
  }

  return {
    branch,
    issueKey,
    packages: analysisPackages,
    changesetFile: issueKey ? `${issueKey}.md` : "changeset.md",
    noChangesetNeeded,
  };
}

/**
 * Generate changeset file content
 */
function generateChangesetContent(
  packages: Array<{
    name: string;
    bump: BumpType;
    summary: string;
  }>,
  issueKey: string | null,
): string {
  // YAML frontmatter
  const frontmatter = packages
    .filter((p) => p.bump !== "none")
    .map((p) => `'${p.name}': ${p.bump}`)
    .join("\n");

  // Body with summaries
  const body = packages
    .filter((p) => p.bump !== "none")
    .map((p) => p.summary)
    .join("\n\n");

  // Add issue key at end if present
  const footer = issueKey ? `\n\n${issueKey}` : "";

  return `---\n${frontmatter}\n---\n\n${body}${footer}\n`;
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const cwd = findMonorepoRoot(process.cwd()) || process.cwd();
  const interactive = isInteractive() && !args.ci && !args["dry-run"];

  if (interactive) {
    prompts.intro("Creating changeset");
  }

  // Analyze
  const analysis = analyze(cwd);

  // Dry run - just output JSON
  if (args["dry-run"]) {
    const output = {
      branch: analysis.branch,
      issueKey: analysis.issueKey,
      packages: analysis.packages.map((p) => ({
        name: p.name,
        path: p.path,
        currentVersion: p.currentVersion,
        suggestedBump: p.suggestedBump,
        reason: p.reason,
        commits: p.commits,
        codeTransform: p.codeTransform,
        suggestedFormat: p.suggestedFormat,
      })),
      changesetFile: analysis.changesetFile,
      noChangesetNeeded: analysis.noChangesetNeeded,
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // Handle no user-facing changes
  if (analysis.noChangesetNeeded || analysis.packages.length === 0) {
    if (args["skip-empty"]) {
      console.log("No user-facing changes. Skipping changeset.");
      return;
    }

    const createEmpty = interactive ? await prompts.promptEmptyChangeset() : true; // In CI, create empty by default

    if (createEmpty) {
      const changesetDir = join(cwd, ".changeset");
      if (!existsSync(changesetDir)) {
        mkdirSync(changesetDir, { recursive: true });
      }

      const content = `---\n---\n\nInternal changes only\n\n${analysis.issueKey || ""}\n`;
      const filePath = join(changesetDir, analysis.changesetFile);
      writeFileSync(filePath, content);

      if (interactive) {
        prompts.success(`Created empty changeset: ${analysis.changesetFile}`);
        prompts.outro("Done");
      } else {
        console.log(`Created: .changeset/${analysis.changesetFile}`);
      }
    }
    return;
  }

  // Parse overrides
  const bumpOverrides = args.bump ? parseBumpOverrides(args.bump) : new Map();
  const summaryOverrides = args.summary ? parseSummaryOverrides(args.summary) : new Map();

  // Determine format
  let format: "collapsed" | "bullets" = "collapsed";
  if (args.bullets) {
    format = "bullets";
  } else if (args.collapsed) {
    format = "collapsed";
  } else if (!interactive) {
    // In CI/agent mode, use the suggested format based on commit analysis
    const hasUnrelated = analysis.packages.some((p) => p.suggestedFormat === "bullets");
    format = hasUnrelated ? "bullets" : "collapsed";
  }

  // Collect final values
  const finalPackages: Array<{
    name: string;
    bump: BumpType;
    summary: string;
  }> = [];

  for (const pkg of analysis.packages) {
    let bump = pkg.suggestedBump;
    let summary = pkg.codeTransform;

    // Apply overrides
    const scopeMatch = pkg.path.match(/(?:apps|packages|tooling)\/([^/]+)/);
    const scope = scopeMatch ? scopeMatch[1] : pkg.name;

    if (bumpOverrides.has(scope)) {
      bump = bumpOverrides.get(scope)!;
    }
    if (summaryOverrides.has(scope)) {
      summary = summaryOverrides.get(scope)!;
    }

    // Interactive prompts
    if (interactive) {
      prompts.displayCommits(pkg.name, pkg.commits, pkg.suggestedBump, pkg.reason);

      const bumpResult = await prompts.selectBumpType(pkg.name, bump, pkg.reason);

      if (bumpResult.skipped) {
        continue;
      }
      bump = bumpResult.bump;

      const summaryResult = await prompts.editSummary(pkg.name, summary);
      summary = summaryResult.summary;
    }

    // Format summary based on format preference
    if (format === "bullets" && !summary.startsWith("-")) {
      summary = transformCommits(pkg.parsedCommits, "bullets");
    }

    finalPackages.push({
      name: pkg.name,
      bump,
      summary,
    });
  }

  if (finalPackages.length === 0) {
    if (interactive) {
      prompts.warn("No packages selected for changeset");
      prompts.outro("Cancelled");
    } else {
      console.log("No packages selected for changeset");
    }
    return;
  }

  // Generate and write changeset
  const content = generateChangesetContent(finalPackages, analysis.issueKey);

  const changesetDir = join(cwd, ".changeset");
  if (!existsSync(changesetDir)) {
    mkdirSync(changesetDir, { recursive: true });
  }

  const filePath = join(changesetDir, analysis.changesetFile);
  writeFileSync(filePath, content);

  if (interactive) {
    prompts.success(`Created changeset: ${analysis.changesetFile}`);
    prompts.note(content, "Content");
    prompts.outro("Done");
  } else {
    console.log(`Created: .changeset/${analysis.changesetFile}`);
    console.log(content);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
