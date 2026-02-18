#!/usr/bin/env node

import { execSync } from "node:child_process";
import { parseArgs } from "node:util";

import { getLatestChangelogEntry } from "./lib/changelog";
import { buildReleaseInfo, createGitHubRelease, isGhAuthenticated } from "./lib/github";
import { createTags, pushTags } from "./lib/tags";
import { getPendingChangesets, getPrereleaseInfo, runChangesetVersion } from "./lib/version";

import { findMonorepoRoot, isInteractive } from "./lib/runtime";
import * as prompts from "./lib/prompts";

// Parse command line arguments
const { values: args } = parseArgs({
  options: {
    ci: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    "skip-github": { type: "boolean", default: false },
    "no-push": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
  allowPositionals: true,
});

interface ReleaseAnalysis {
  prereleaseMode: string | null;
  pendingChangesets: string[];
  packagesToRelease: Array<{
    name: string;
    path: string;
    currentVersion: string;
    newVersion: string;
    bump: string;
    changelogEntry: string;
    tag: string;
    githubRelease: {
      tag: string;
      title: string;
      prerelease: boolean;
    };
  }>;
  commitMessage: string;
}

function printHelp(): void {
  console.log(`
Usage: release [options]

Options:
  --ci              Non-interactive mode
  --dry-run         Analyze only, don't make changes
  --skip-github     Skip creating GitHub releases
  --no-push         Don't push to remote
  --help            Show this help
  `);
}

/**
 * Analyze what would be released
 */
function analyze(cwd: string): ReleaseAnalysis {
  const prereleaseInfo = getPrereleaseInfo(cwd);
  const pendingChangesets = getPendingChangesets(cwd);
  const packagesToRelease = runChangesetVersion(cwd, true); // dry run

  return {
    prereleaseMode: prereleaseInfo.tag,
    pendingChangesets,
    packagesToRelease: packagesToRelease.map((pkg) => {
      const changelog = getLatestChangelogEntry(pkg.path);
      const releaseInfo = buildReleaseInfo(pkg);

      return {
        name: pkg.name,
        path: pkg.path,
        currentVersion: pkg.oldVersion,
        newVersion: pkg.newVersion,
        bump: pkg.bump,
        changelogEntry: changelog?.content || "",
        tag: releaseInfo.tag,
        githubRelease: {
          tag: releaseInfo.tag,
          title: releaseInfo.title,
          prerelease: releaseInfo.prerelease,
        },
      };
    }),
    commitMessage: "chore(release): version packages",
  };
}

/**
 * Execute the release
 */
async function executeRelease(
  cwd: string,
  interactive: boolean,
  skipGithub: boolean,
  noPush: boolean,
): Promise<void> {
  // Step 1: Run changeset version
  if (interactive) {
    prompts.log("Running changeset version...");
  }

  const packages = runChangesetVersion(cwd, false);

  if (packages.length === 0) {
    if (interactive) {
      prompts.warn("No packages to release");
    } else {
      console.log("No packages to release");
    }
    return;
  }

  // Step 2: Install dependencies (update lockfile)
  if (interactive) {
    prompts.log("Updating lockfile...");
  }

  try {
    execSync("pnpm install --lockfile-only", {
      cwd,
      stdio: "pipe",
    });
  } catch {
    // Lockfile update might not be needed
  }

  // Step 3: Commit changes
  if (interactive) {
    prompts.log("Committing version changes...");
  }

  try {
    execSync("git add .", { cwd, stdio: "pipe" });
    execSync('git commit -m "chore(release): version packages"', {
      cwd,
      stdio: "pipe",
    });
  } catch (error: any) {
    if (!error.message?.includes("nothing to commit")) {
      throw error;
    }
  }

  // Step 4: Create tags
  if (interactive) {
    prompts.log("Creating tags...");
  }

  createTags(packages, cwd);

  // Step 5: Push (unless --no-push)
  if (!noPush) {
    if (interactive) {
      prompts.log("Pushing to remote...");
    }
    pushTags(cwd);
  }

  // Step 6: Create GitHub releases (unless --skip-github)
  const releaseUrls: string[] = [];

  if (!skipGithub) {
    if (!isGhAuthenticated()) {
      if (interactive) {
        prompts.warn("gh CLI not authenticated. Skipping GitHub releases.");
        prompts.log("Run: gh auth login");
      } else {
        console.log("Warning: gh CLI not authenticated. Skipping GitHub releases.");
      }
    } else {
      if (interactive) {
        prompts.log("Creating GitHub releases...");
      }

      for (const pkg of packages) {
        const releaseInfo = buildReleaseInfo(pkg);
        const result = createGitHubRelease(releaseInfo, cwd);

        if (result.success && result.url) {
          releaseUrls.push(result.url);
        } else if (result.error) {
          console.error(`Failed to create release for ${pkg.name}: ${result.error}`);
        }
      }
    }
  }

  // Step 7: Summary
  if (interactive) {
    prompts.success("Release complete!");
    prompts.note(
      packages.map((p) => `• ${p.name}@${p.newVersion}`).join("\n"),
      "Released packages",
    );

    if (releaseUrls.length > 0) {
      prompts.note(releaseUrls.map((url) => `• ${url}`).join("\n"), "GitHub releases");
    }

    prompts.log("");
    prompts.log("💡 To post release notes to Slack, run: /slack-release");
  } else {
    console.log("\n✅ Release complete!\n");
    console.log("Released packages:");
    for (const pkg of packages) {
      console.log(`  • ${pkg.name}@${pkg.newVersion}`);
    }

    if (releaseUrls.length > 0) {
      console.log("\nGitHub releases:");
      for (const url of releaseUrls) {
        console.log(`  • ${url}`);
      }
    }

    console.log("\n💡 To post release notes to Slack, run: /slack-release");
  }
}

async function main(): Promise<void> {
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const cwd = findMonorepoRoot(process.cwd()) || process.cwd();
  const interactive = isInteractive() && !args.ci && !args["dry-run"];

  if (interactive) {
    prompts.intro("Release packages");
  }

  // Check for pending changesets
  const pendingChangesets = getPendingChangesets(cwd);

  if (pendingChangesets.length === 0) {
    if (interactive) {
      prompts.warn("No pending changesets found");
      prompts.outro("Nothing to release");
    } else {
      console.log("No pending changesets found. Nothing to release.");
    }
    return;
  }

  // Dry run - output JSON
  if (args["dry-run"]) {
    const analysis = analyze(cwd);
    console.log(JSON.stringify(analysis, null, 2));
    return;
  }

  // Analyze
  const analysis = analyze(cwd);

  // Show what will be released
  if (interactive) {
    const packageList = analysis.packagesToRelease
      .map((p) => `${p.name}: ${p.currentVersion} → ${p.newVersion} (${p.bump})`)
      .join("\n");

    prompts.note(packageList, "Packages to release");

    if (analysis.prereleaseMode) {
      prompts.warn(`Prerelease mode: ${analysis.prereleaseMode}`);
    }

    const confirmed = await prompts.confirm("Proceed with release?");
    if (!confirmed) {
      prompts.outro("Cancelled");
      return;
    }
  }

  // Execute
  await executeRelease(cwd, interactive, args["skip-github"] || false, args["no-push"] || false);

  if (interactive) {
    prompts.outro("Done");
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
