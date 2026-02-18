#!/usr/bin/env node

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { findMonorepoRoot, isInteractive } from "./lib/runtime";
import * as prompts from "./lib/prompts";

const { values: args, positionals } = parseArgs({
  options: {
    help: { type: "boolean", default: false },
  },
  allowPositionals: true,
});

function printHelp(): void {
  console.log(`
Usage: prerelease <command> [options]

Commands:
  enter <tag>    Enter prerelease mode (alpha, beta, rc)
  exit           Exit prerelease mode
  status         Show current prerelease status

Examples:
  prerelease enter alpha
  prerelease exit
  prerelease status
  `);
}

interface PrereleaseStatus {
  active: boolean;
  mode: string | null;
  tag: string | null;
  initialVersions: Record<string, string>;
  changesets: string[];
}

/**
 * Get current prerelease status
 */
function getStatus(cwd: string): PrereleaseStatus {
  const preJsonPath = join(cwd, ".changeset", "pre.json");

  if (!existsSync(preJsonPath)) {
    return {
      active: false,
      mode: null,
      tag: null,
      initialVersions: {},
      changesets: [],
    };
  }

  try {
    const content = JSON.parse(readFileSync(preJsonPath, "utf-8"));
    return {
      active: content.mode === "pre",
      mode: content.mode || null,
      tag: content.tag || null,
      initialVersions: content.initialVersions || {},
      changesets: content.changesets || [],
    };
  } catch {
    return {
      active: false,
      mode: null,
      tag: null,
      initialVersions: {},
      changesets: [],
    };
  }
}

/**
 * Enter prerelease mode
 */
function enterPrerelease(tag: string, cwd: string): void {
  const validTags = ["alpha", "beta", "rc", "next", "canary"];

  if (!validTags.includes(tag)) {
    console.error(`Invalid prerelease tag: ${tag}`);
    console.error(`Valid tags: ${validTags.join(", ")}`);
    process.exit(1);
  }

  const status = getStatus(cwd);
  if (status.active) {
    console.error(`Already in prerelease mode: ${status.tag}`);
    console.error('Run "prerelease exit" first to exit current mode.');
    process.exit(1);
  }

  try {
    execSync(`pnpm changeset pre enter ${tag}`, {
      cwd,
      stdio: "inherit",
    });
    console.log(`\n✅ Entered prerelease mode: ${tag}`);
    console.log("Future versions will be X.Y.Z-" + tag + ".N");
  } catch {
    console.error("Failed to enter prerelease mode");
    process.exit(1);
  }
}

/**
 * Exit prerelease mode
 */
function exitPrerelease(cwd: string): void {
  const status = getStatus(cwd);

  if (!status.active) {
    console.log("Not in prerelease mode.");
    return;
  }

  try {
    execSync("pnpm changeset pre exit", {
      cwd,
      stdio: "inherit",
    });
    console.log("\n✅ Exited prerelease mode");
    console.log("Future versions will be stable (X.Y.Z)");
  } catch {
    console.error("Failed to exit prerelease mode");
    process.exit(1);
  }
}

/**
 * Show prerelease status
 */
function showStatus(cwd: string, interactive: boolean): void {
  const status = getStatus(cwd);

  if (interactive) {
    if (status.active) {
      prompts.note(
        `Mode: ${status.mode}\nTag: ${status.tag}\nChangesets: ${status.changesets.length}`,
        "🏷️  Prerelease Active",
      );

      if (Object.keys(status.initialVersions).length > 0) {
        const versions = Object.entries(status.initialVersions)
          .map(([pkg, ver]) => `${pkg}: ${ver}`)
          .join("\n");
        prompts.note(versions, "Initial Versions");
      }
    } else {
      prompts.log("Not in prerelease mode. Versions will be stable (X.Y.Z)");
    }
  } else {
    console.log(JSON.stringify(status, null, 2));
  }
}

async function main(): Promise<void> {
  if (args.help || positionals.length === 0) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const cwd = findMonorepoRoot(process.cwd()) || process.cwd();
  const command = positionals[0];
  const interactive = isInteractive();

  switch (command) {
    case "enter":
      const tag = positionals[1];
      if (!tag) {
        console.error("Error: Tag required (e.g., alpha, beta, rc)");
        process.exit(1);
      }
      enterPrerelease(tag, cwd);
      break;

    case "exit":
      exitPrerelease(cwd);
      break;

    case "status":
      showStatus(cwd, interactive);
      break;

    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
