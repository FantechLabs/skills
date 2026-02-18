#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import installCommand from "./commands/install.js";
import listCommand from "./commands/list.js";
import removeCommand from "./commands/remove.js";
import runCommand from "./commands/run.js";
import updateCommand from "./commands/update.js";
import { discoverBundledSkills } from "./lib/skills.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, "..");

type CommandHandler = (args: string[]) => Promise<void>;

const COMMANDS: Record<string, CommandHandler> = {
  install: installCommand,
  list: listCommand,
  run: runCommand,
  remove: removeCommand,
  update: updateCommand,
};

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf-8"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function showHelp(): void {
  console.log(`
@fantech/skills v${getVersion()}

Usage:
  skills <command> [options]
  skills <skill-name> [args...]    Shortcut for: skills run <skill-name>

Commands:
  list                  List bundled skills and install status
  install [skills...]   Install skills into project skill directories
  run <skill> [args...] Run a skill script
  remove [skills...]    Reserved (coming soon)
  update [skills...]    Reserved (coming soon)

Options:
  -h, --help            Show help
  -v, --version         Show version
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "help" || command === "--help" || command === "-h") {
    showHelp();
    return;
  }

  if (command === "version" || command === "--version" || command === "-v") {
    console.log(getVersion());
    return;
  }

  const handler = COMMANDS[command];
  if (handler) {
    await handler(args.slice(1));
    return;
  }

  const skillNames = new Set(discoverBundledSkills().map((skill) => skill.name));
  if (skillNames.has(command)) {
    await runCommand([command, ...args.slice(1)]);
    return;
  }

  console.error(`Unknown command: ${command}`);
  showHelp();
  process.exit(1);
}

main().catch((error) => {
  console.error("Error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
