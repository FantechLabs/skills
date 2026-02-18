import { existsSync } from "node:fs";
import { join } from "node:path";

import { runTypeScriptScript } from "../lib/runtime.js";
import { discoverBundledSkills } from "../lib/skills.js";

const ENTRY_POINTS: Record<string, string | Record<string, string>> = {
  commit: "commit.ts",
  changeset: {
    _default: "create.ts",
    create: "create.ts",
    validate: "validate.ts",
    prerelease: "prerelease.ts",
  },
  release: "release.ts",
};

export default async function runCommand(args: string[]): Promise<void> {
  const skillName = args[0];
  if (!skillName) {
    console.error("Usage: skills run <skill> [args...]");
    process.exit(1);
  }

  const skills = discoverBundledSkills();
  const skill = skills.find((entry) => entry.name === skillName);
  if (!skill) {
    console.error(`Unknown skill: ${skillName}`);
    process.exit(1);
  }

  if (!skill.hasScripts) {
    console.error(`Skill "${skillName}" has no executable scripts.`);
    process.exit(1);
  }

  const entry = ENTRY_POINTS[skillName];
  if (!entry) {
    console.error(`Skill "${skillName}" is runnable but has no CLI entry mapping yet.`);
    process.exit(1);
  }

  let entryFile: string;
  let forwardArgs = args.slice(1);

  if (typeof entry === "string") {
    entryFile = entry;
  } else {
    const maybeSubcommand = args[1];

    if (!maybeSubcommand || maybeSubcommand.startsWith("-")) {
      entryFile = entry._default;
    } else if (maybeSubcommand in entry) {
      entryFile = entry[maybeSubcommand];
      forwardArgs = args.slice(2);
    } else {
      console.error(`Unknown subcommand for ${skillName}: ${maybeSubcommand}`);
      console.error(
        `Available: ${Object.keys(entry)
          .filter((key) => key !== "_default")
          .join(", ")}`,
      );
      process.exit(1);
    }
  }

  const scriptPath = join(skill.path, "scripts", entryFile);

  if (!existsSync(scriptPath)) {
    console.error(`Script not found: ${scriptPath}`);
    process.exit(1);
  }

  const exitCode = runTypeScriptScript(scriptPath, forwardArgs, process.cwd());
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
