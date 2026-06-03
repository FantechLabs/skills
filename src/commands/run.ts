import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { runTypeScriptScript } from "../lib/runtime.js";
import { discoverBundledSkills } from "../lib/skills.js";

const SCRIPT_FILE_REGEX = /\.(?:[cm]?[jt]sx?)$/;

function normalizeScriptPath(path: string): string {
  const trimmed = path.replace(/^\.\/+/, "");
  if (trimmed.startsWith("scripts/")) {
    return trimmed.slice("scripts/".length);
  }
  return trimmed;
}

function getScriptBaseName(fileName: string): string | null {
  if (
    fileName.endsWith(".d.ts") ||
    fileName.endsWith(".d.mts") ||
    fileName.endsWith(".d.cts") ||
    !SCRIPT_FILE_REGEX.test(fileName)
  ) {
    return null;
  }

  const extensionMatch = fileName.match(/\.[^.]+$/);
  if (!extensionMatch) {
    return null;
  }

  return fileName.slice(0, -extensionMatch[0].length);
}

function discoverScriptFiles(skillPath: string): Map<string, string> {
  const scriptsDir = join(skillPath, "scripts");
  const scripts = new Map<string, string>();

  if (!existsSync(scriptsDir)) {
    return scripts;
  }

  for (const entry of readdirSync(scriptsDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    const baseName = getScriptBaseName(entry.name);
    if (!baseName) {
      continue;
    }

    scripts.set(baseName, entry.name);
  }

  return scripts;
}

function extractScriptPath(command: string): string | null {
  const match = command.match(/(?:^|\s)(?:bun|node|tsx)\s+["']?([^"'\s]+\.(?:[cm]?[jt]sx?))["']?/);
  if (!match) {
    return null;
  }

  return normalizeScriptPath(match[1]);
}

function discoverPackageScriptTargets(skillPath: string): Map<string, string> {
  const result = new Map<string, string>();
  const packageJsonPath = join(skillPath, "scripts", "package.json");

  if (!existsSync(packageJsonPath)) {
    return result;
  }

  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
      scripts?: Record<string, unknown>;
    };

    if (!parsed.scripts) {
      return result;
    }

    for (const [name, scriptCommand] of Object.entries(parsed.scripts)) {
      if (typeof scriptCommand !== "string") {
        continue;
      }

      const extracted = extractScriptPath(scriptCommand);
      if (extracted) {
        result.set(name, extracted);
      }
    }
  } catch {
    // Ignore malformed script package metadata and rely on file discovery.
  }

  return result;
}

function resolveConfiguredDefaultScript(
  configuredDefault: string,
  commandTargets: Map<string, string>,
): string | null {
  const candidate = configuredDefault.trim();
  if (!candidate) {
    return null;
  }

  if (commandTargets.has(candidate)) {
    return commandTargets.get(candidate)!;
  }

  const normalizedCandidate = normalizeScriptPath(candidate);

  for (const target of commandTargets.values()) {
    if (normalizeScriptPath(target) === normalizedCandidate) {
      return target;
    }
  }

  const fileSegment = normalizedCandidate.split("/").pop() || normalizedCandidate;
  const baseName = getScriptBaseName(fileSegment);
  if (baseName && commandTargets.has(baseName)) {
    return commandTargets.get(baseName)!;
  }

  return null;
}

function resolveDefaultScript(
  skillName: string,
  commandTargets: Map<string, string>,
  configuredDefault: string | null,
): string | null {
  if (configuredDefault) {
    return configuredDefault;
  }

  const explicitSkillScript = commandTargets.get(skillName);
  if (explicitSkillScript) {
    return explicitSkillScript;
  }

  const createScript = commandTargets.get("create");
  if (createScript) {
    return createScript;
  }

  const uniqueTargets = new Set<string>(commandTargets.values());
  if (uniqueTargets.size === 1) {
    return [...uniqueTargets][0]!;
  }

  return null;
}

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

  const scriptFiles = discoverScriptFiles(skill.path);
  const packageTargets = discoverPackageScriptTargets(skill.path);
  const commandTargets = new Map<string, string>(scriptFiles);

  for (const [commandName, target] of packageTargets) {
    if (!commandTargets.has(commandName)) {
      commandTargets.set(commandName, target);
    }
  }

  if (commandTargets.size === 0) {
    console.error(`Skill "${skillName}" has no executable scripts.`);
    process.exit(1);
  }

  let entryFile: string;
  let forwardArgs = args.slice(1);
  let configuredDefault: string | null = null;
  if (skill.defaultScript) {
    configuredDefault = resolveConfiguredDefaultScript(skill.defaultScript, commandTargets);
    if (!configuredDefault) {
      console.error(
        `Skill "${skillName}" declares an invalid default_script: ${JSON.stringify(skill.defaultScript)}`,
      );
      console.error(`Available subcommands: ${[...commandTargets.keys()].sort().join(", ")}`);
      process.exit(1);
    }
  }

  const defaultEntry = resolveDefaultScript(skillName, commandTargets, configuredDefault);
  const hasMultipleTargets = new Set(commandTargets.values()).size > 1;

  if (!hasMultipleTargets) {
    if (!defaultEntry) {
      console.error(`Skill "${skillName}" has executable scripts but no resolvable default entry.`);
      process.exit(1);
    }

    entryFile = defaultEntry;
  } else {
    const maybeSubcommand = args[1];

    if (!maybeSubcommand || maybeSubcommand.startsWith("-")) {
      if (!defaultEntry) {
        console.error(`Skill "${skillName}" has multiple scripts and no default entry.`);
        console.error(`Use one of: ${[...commandTargets.keys()].sort().join(", ")}`);
        process.exit(1);
      }

      entryFile = defaultEntry;
    } else if (commandTargets.has(maybeSubcommand)) {
      entryFile = commandTargets.get(maybeSubcommand)!;
      forwardArgs = args.slice(2);
    } else {
      console.error(`Unknown subcommand for ${skillName}: ${maybeSubcommand}`);
      console.error(`Available: ${[...commandTargets.keys()].sort().join(", ")}`);
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
