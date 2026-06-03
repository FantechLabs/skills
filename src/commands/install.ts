import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import * as p from "@clack/prompts";

import { detectAgents, getInstallPaths, resolveAgentInstallPath } from "../lib/agents.js";
import { detectPackageManager, installPackageDependencies } from "../lib/package-manager.js";
import { getRulerSkillsDir, isRulerProject } from "../lib/ruler.js";
import {
  compareSkillDirectories,
  copySkill,
  discoverBundledSkills,
  findSkillPackageDirs,
  type SkillInfo,
} from "../lib/skills.js";

type InstallStatus = "current" | "missing" | "update";

interface SkillLocationStatus {
  changedFiles: string[];
  installPath: string;
  status: InstallStatus;
}

interface SkillInstallPlan {
  locations: SkillLocationStatus[];
  skill: SkillInfo;
}

function isInteractiveTty(): boolean {
  return !!(process.stdout.isTTY && process.stdin.isTTY);
}

export default async function installCommand(args: string[]): Promise<void> {
  const { values: flags, positionals } = parseArgs({
    args,
    options: {
      ruler: { type: "boolean", default: false },
      agent: { type: "string", multiple: true },
      yes: { type: "boolean", default: false },
      "skip-deps": { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  const cwd = process.cwd();
  const skills = discoverBundledSkills();
  const interactive = isInteractiveTty();
  const installPaths = await resolveInstallTargets({ cwd, flags, interactive });
  const installPlans = skills.map((skill) => buildSkillInstallPlan(skill, installPaths));

  let selectedSkillNames: string[] = [];

  if (positionals.length > 0) {
    selectedSkillNames = [...new Set(positionals)];
  } else if (interactive && !flags.yes) {
    p.intro("Install skills");
    printExistingInstallSummary(installPlans, cwd);

    const selected = await p.multiselect<string>({
      message: "Select skills to install",
      required: true,
      options: installPlans.map((plan) => ({
        value: plan.skill.name,
        label: plan.skill.name,
        hint: formatSelectionHint(plan, cwd) || plan.skill.description,
      })),
    });

    if (p.isCancel(selected)) {
      p.cancel("Cancelled");
      process.exit(0);
    }

    selectedSkillNames = selected;
  } else {
    selectedSkillNames = skills.map((skill) => skill.name);
  }

  for (const name of selectedSkillNames) {
    if (!skills.some((skill) => skill.name === name)) {
      console.error(`Unknown skill: ${name}`);
      console.error(`Available skills: ${skills.map((skill) => skill.name).join(", ")}`);
      process.exit(1);
    }
  }

  const selectedSkills = installPlans.filter((plan) =>
    selectedSkillNames.includes(plan.skill.name),
  );
  printSelectedInstallSummary(selectedSkills, cwd);

  const packageDirs = getTargetPackageDirs(selectedSkills, installPaths);
  const detectedPackageManager = packageDirs.length > 0 ? detectPackageManager(cwd) : null;
  const shouldInstallDependencies = await resolveDependencyInstallPreference({
    detectedPackageManager,
    flags,
    interactive,
    packageDirCount: packageDirs.length,
  });

  for (const baseDir of installPaths) {
    mkdirSync(baseDir, { recursive: true });

    for (const plan of selectedSkills) {
      const targetDir = join(baseDir, plan.skill.name);
      copySkill(plan.skill.path, targetDir);
      console.log(`  ✓ ${plan.skill.name} -> ${targetDir}`);
    }
  }

  if (shouldInstallDependencies && detectedPackageManager) {
    console.log(
      `\nInstalling dependencies with ${detectedPackageManager.manager} for ${packageDirs.length} skill package(s)...`,
    );

    for (const packageDir of packageDirs) {
      console.log(`  ↳ ${packageDir}`);
      installPackageDependencies(detectedPackageManager.manager, packageDir);
    }
  }

  if (installPaths.some((path) => path.replace(/\\/g, "/").includes("/.ruler/skills"))) {
    console.log("\nRun `ruler apply` to propagate .ruler skills to configured agents.");
  }

  console.log(`\nInstalled ${selectedSkills.length} skill(s).`);
}

function buildSkillInstallPlan(skill: SkillInfo, installPaths: string[]): SkillInstallPlan {
  return {
    locations: installPaths.map((installPath) => {
      const targetDir = join(installPath, skill.name);
      const skillFile = join(targetDir, "SKILL.md");

      if (!existsSync(skillFile)) {
        return {
          changedFiles: [],
          installPath,
          status: "missing",
        };
      }

      const diff = compareSkillDirectories(skill.path, targetDir);
      return {
        changedFiles: [...diff.addedFiles, ...diff.changedFiles, ...diff.removedFiles],
        installPath,
        status: diff.equal ? "current" : "update",
      };
    }),
    skill,
  };
}

function formatSelectionHint(plan: SkillInstallPlan, cwd: string): string {
  if (plan.locations.every((location) => location.status === "missing")) {
    return plan.skill.description;
  }

  return plan.locations.map((location) => describeLocation(location, cwd, false)).join("; ");
}

function printExistingInstallSummary(plans: SkillInstallPlan[], cwd: string): void {
  const relevantPlans = plans.filter((plan) =>
    plan.locations.some((location) => location.status !== "missing"),
  );

  if (relevantPlans.length === 0) {
    return;
  }

  console.log("\nDetected existing skills in target locations:\n");
  for (const plan of relevantPlans) {
    const symbol = plan.locations.some((location) => location.status === "update") ? "~" : "=";
    console.log(
      `  ${symbol} ${plan.skill.name}: ${plan.locations
        .map((location) => describeLocation(location, cwd, true))
        .join("; ")}`,
    );
  }
  console.log();
}

function printSelectedInstallSummary(selectedPlans: SkillInstallPlan[], cwd: string): void {
  if (selectedPlans.length === 0) {
    return;
  }

  console.log("\nInstall plan:\n");
  for (const plan of selectedPlans) {
    const symbol = plan.locations.every((location) => location.status === "missing")
      ? "+"
      : plan.locations.some((location) => location.status === "update")
        ? "~"
        : "=";
    console.log(
      `  ${symbol} ${plan.skill.name}: ${plan.locations
        .map((location) => describeLocation(location, cwd, true))
        .join("; ")}`,
    );
  }
  console.log();
}

function describeLocation(
  location: SkillLocationStatus,
  cwd: string,
  includeChangedFiles: boolean,
): string {
  const formattedInstallPath = formatInstallPath(location.installPath, cwd);

  if (location.status === "missing") {
    return `new in ${formattedInstallPath}`;
  }

  if (location.status === "current") {
    return `already current in ${formattedInstallPath}`;
  }

  if (!includeChangedFiles || location.changedFiles.length === 0) {
    return `update available in ${formattedInstallPath}`;
  }

  const preview = location.changedFiles.slice(0, 3).join(", ");
  const suffix = location.changedFiles.length > 3 ? ", ..." : "";
  const changedLabel = `${location.changedFiles.length} changed file${
    location.changedFiles.length === 1 ? "" : "s"
  }`;
  return `update available in ${formattedInstallPath} (${changedLabel}: ${preview}${suffix})`;
}

function formatInstallPath(installPath: string, cwd: string): string {
  const home = homedir();
  const normalized = installPath.replace(/\\/g, "/");
  const normalizedHome = home.replace(/\\/g, "/");

  if (normalized === normalizedHome) {
    return "~";
  }

  if (normalized.startsWith(`${normalizedHome}/`)) {
    return `~/${normalized.slice(normalizedHome.length + 1)}`;
  }

  const relativePath = relative(cwd, installPath).replace(/\\/g, "/");
  if (relativePath && !relativePath.startsWith("..")) {
    return relativePath;
  }

  return normalized;
}

function getTargetPackageDirs(selectedPlans: SkillInstallPlan[], installPaths: string[]): string[] {
  const packageDirs = new Set<string>();

  for (const plan of selectedPlans) {
    for (const sourcePackageDir of findSkillPackageDirs(plan.skill.path)) {
      const relativePackageDir = relative(plan.skill.path, sourcePackageDir);
      for (const installPath of installPaths) {
        packageDirs.add(join(installPath, plan.skill.name, relativePackageDir));
      }
    }
  }

  return [...packageDirs].sort();
}

async function resolveDependencyInstallPreference(options: {
  detectedPackageManager: ReturnType<typeof detectPackageManager> | null;
  flags: { "skip-deps": boolean; yes: boolean };
  interactive: boolean;
  packageDirCount: number;
}): Promise<boolean> {
  if (options.packageDirCount === 0 || options.flags["skip-deps"]) {
    return false;
  }

  if (!options.interactive || options.flags.yes || !options.detectedPackageManager) {
    return true;
  }

  const confirmed = await p.confirm({
    message: `Install dependencies with ${options.detectedPackageManager.manager} for ${options.packageDirCount} skill package(s)?`,
    initialValue: true,
  });

  if (p.isCancel(confirmed)) {
    p.cancel("Cancelled");
    process.exit(0);
  }

  return confirmed;
}

async function resolveInstallTargets(options: {
  cwd: string;
  flags: {
    agent?: string[];
    ruler: boolean;
    yes: boolean;
  };
  interactive: boolean;
}): Promise<string[]> {
  if (options.flags.ruler || isRulerProject(options.cwd)) {
    return [getRulerSkillsDir(options.cwd)];
  }

  if (options.flags.agent && options.flags.agent.length > 0) {
    return [
      ...new Set(options.flags.agent.map((agent) => resolveAgentInstallPath(options.cwd, agent))),
    ];
  }

  const detectedAgents = detectAgents(options.cwd);

  if (detectedAgents.length > 0) {
    return getInstallPaths(options.cwd, detectedAgents);
  }

  if (!options.interactive || options.flags.yes) {
    return [join(options.cwd, ".agents", "skills")];
  }

  const targetChoice = await p.select({
    message: "No agent config detected. Where should skills be installed?",
    options: [
      { value: "agents", label: ".agents/skills", hint: "Cross-agent shared directory" },
      { value: "claude", label: ".claude/skills", hint: "Claude Code only" },
      { value: "ruler", label: ".ruler/skills", hint: "Ruler-managed project" },
    ],
  });

  if (p.isCancel(targetChoice)) {
    p.cancel("Cancelled");
    process.exit(0);
  }

  if (targetChoice === "ruler") {
    return [getRulerSkillsDir(options.cwd)];
  }

  if (targetChoice === "claude") {
    return [join(options.cwd, ".claude", "skills")];
  }

  return [join(options.cwd, ".agents", "skills")];
}
