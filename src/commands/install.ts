import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import * as p from "@clack/prompts";

import {
  detectGlobalAgentTargets,
  type GlobalAgentTarget,
  resolveGlobalAgentTarget,
} from "../lib/agents.js";
import { resolveInstallTargets, type TargetFlags } from "../lib/install-targets.js";
import { detectPackageManager, installPackageDependencies } from "../lib/package-manager.js";
import { applyRulerAfterChanges } from "../lib/ruler.js";
import {
  compareSkillDirectories,
  copySkill,
  discoverBundledSkills,
  findSkillPackageDirs,
  type SkillInfo,
} from "../lib/skills.js";

type InstallStatus = "current" | "missing" | "update";

interface InstallFlags extends TargetFlags {
  "skip-deps": boolean;
  symlink: boolean;
}

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
      global: { type: "boolean", default: false },
      symlink: { type: "boolean", default: false },
      "skip-deps": { type: "boolean", default: false },
    },
    allowPositionals: true,
  }) as { values: InstallFlags; positionals: string[] };

  const cwd = process.cwd();
  const skills = discoverBundledSkills();
  const interactive = isInteractiveTty();
  const { installPaths, useSymlinkMode } = await resolveInstallTargets({
    cwd,
    flags,
    interactive,
  });
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

  if (flags.global && useSymlinkMode) {
    linkGlobalSymlinkTargets(selectedSkills, flags.agent);
  }

  await applyRulerAfterChanges({ installPaths, interactive, yes: flags.yes });

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
  flags: Pick<InstallFlags, "skip-deps" | "yes">;
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

function linkGlobalSymlinkTargets(
  selectedSkills: SkillInstallPlan[],
  requestedAgents: string[] | undefined,
): void {
  const globalAgentsDir = join(homedir(), ".agents", "skills");
  const globalClaudeDir = join(homedir(), ".claude", "skills");
  const globalCursorDir = join(homedir(), ".cursor", "skills");
  const detectedGlobalTargets = detectGlobalAgentTargets();
  const targetIds = new Set(detectedGlobalTargets.map((target) => target.id));

  const requestedTargets =
    requestedAgents && requestedAgents.length > 0
      ? new Set(
          requestedAgents
            .map((agentName) => resolveGlobalAgentTarget(agentName))
            .filter((target): target is GlobalAgentTarget => target !== null)
            .map((target) => target.id),
        )
      : null;

  const shouldLinkClaude =
    targetIds.has("claude") && (!requestedTargets || requestedTargets.has("claude"));
  const shouldLinkCursor =
    targetIds.has("cursor") && (!requestedTargets || requestedTargets.has("cursor"));

  if (shouldLinkClaude) {
    mkdirSync(globalClaudeDir, { recursive: true });
  }

  if (shouldLinkCursor) {
    mkdirSync(globalCursorDir, { recursive: true });
  }

  for (const plan of selectedSkills) {
    const source = join(globalAgentsDir, plan.skill.name);
    const linkTargets: string[] = [];

    if (shouldLinkClaude) {
      linkTargets.push(join(globalClaudeDir, plan.skill.name));
    }

    if (shouldLinkCursor) {
      linkTargets.push(join(globalCursorDir, plan.skill.name));
    }

    for (const target of linkTargets) {
      const stat = getPathStat(target);
      if (stat) {
        if (!stat.isSymbolicLink()) {
          console.log(`  ↷ skip symlink for ${plan.skill.name} (manual override at ${target})`);
          continue;
        }

        const current = readlinkSync(target);
        if (current === source) {
          console.log(`  ✓ ${plan.skill.name} already linked at ${target}`);
          continue;
        }

        rmSync(target, { recursive: true, force: true });
      }

      symlinkSync(source, target);
      console.log(`  🔗 ${plan.skill.name} -> ${target}`);
    }
  }
}

function getPathStat(path: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }

    throw error;
  }
}
