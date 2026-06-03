import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import * as p from "@clack/prompts";

import {
  detectAgents,
  detectGlobalAgentTargets,
  getInstallPaths,
  type GlobalAgentTarget,
  resolveAgentInstallPath,
  resolveGlobalAgentTarget,
} from "../lib/agents.js";
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

interface InstallFlags {
  agent?: string[];
  global: boolean;
  ruler: boolean;
  "skip-deps": boolean;
  symlink: boolean;
  yes: boolean;
}

interface InstallTargetResolution {
  installPaths: string[];
  useSymlinkMode: boolean;
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

  const usedRulerInstall = installPaths.some((path) =>
    path.replace(/\\/g, "/").includes("/.ruler/skills"),
  );
  if (usedRulerInstall) {
    if (interactive && !flags.yes) {
      const shouldApply = await p.confirm({
        message: "Run `ruler apply` now to propagate skills to configured agents?",
        initialValue: true,
      });

      if (p.isCancel(shouldApply)) {
        p.cancel("Skipped `ruler apply`.");
      } else if (shouldApply) {
        const result = spawnSync("ruler", ["apply"], { stdio: "inherit" });
        if (result.error) {
          const code = (result.error as NodeJS.ErrnoException).code;
          if (code === "ENOENT") {
            console.warn("`ruler` command not found. Skipping automatic apply.");
          } else {
            console.warn(`Failed to run \`ruler apply\`: ${result.error.message}`);
          }
        } else if (typeof result.status === "number" && result.status !== 0) {
          console.warn(`\`ruler apply\` exited with code ${result.status}.`);
        }
      }
    } else {
      console.log("\nRun `ruler apply` to propagate .ruler skills to configured agents.");
    }
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

async function resolveInstallTargets(options: {
  cwd: string;
  flags: InstallFlags;
  interactive: boolean;
}): Promise<InstallTargetResolution> {
  if (options.flags.global && options.flags.ruler) {
    console.error("`--global` and `--ruler` cannot be used together.");
    process.exit(1);
  }

  if (options.flags.symlink && !options.flags.global) {
    console.error("`--symlink` requires `--global`.");
    process.exit(1);
  }

  if (options.flags.global) {
    return resolveGlobalInstallTargets(options.flags, options.interactive);
  }

  if (options.flags.ruler || isRulerProject(options.cwd)) {
    return { installPaths: [getRulerSkillsDir(options.cwd)], useSymlinkMode: false };
  }

  if (options.flags.agent && options.flags.agent.length > 0) {
    return {
      installPaths: [
        ...new Set(options.flags.agent.map((agent) => resolveAgentInstallPath(options.cwd, agent))),
      ],
      useSymlinkMode: false,
    };
  }

  const detectedAgents = detectAgents(options.cwd);

  if (detectedAgents.length > 0) {
    return { installPaths: getInstallPaths(options.cwd, detectedAgents), useSymlinkMode: false };
  }

  if (!options.interactive || options.flags.yes) {
    return { installPaths: [join(options.cwd, ".agents", "skills")], useSymlinkMode: false };
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
    return { installPaths: [getRulerSkillsDir(options.cwd)], useSymlinkMode: false };
  }

  if (targetChoice === "claude") {
    return { installPaths: [join(options.cwd, ".claude", "skills")], useSymlinkMode: false };
  }

  return { installPaths: [join(options.cwd, ".agents", "skills")], useSymlinkMode: false };
}

async function resolveGlobalInstallTargets(
  flags: InstallFlags,
  interactive: boolean,
): Promise<InstallTargetResolution> {
  const detectedGlobalTargets = detectGlobalAgentTargets();
  const targetIds = new Set(detectedGlobalTargets.map((target) => target.id));

  if (detectedGlobalTargets.length === 0) {
    console.error(
      "No supported global agent directories found. Expected one of: ~/.agents, ~/.claude, ~/.cursor, ~/.pi, ~/.hermes, ~/.openclaw",
    );
    process.exit(1);
  }

  let selectedTargetIds = new Set(detectedGlobalTargets.map((target) => target.id));
  let useSymlinkMode = flags.symlink;

  if (flags.agent && flags.agent.length > 0) {
    selectedTargetIds = new Set();

    for (const agentName of flags.agent) {
      const target = resolveGlobalAgentTarget(agentName);
      if (!target) {
        console.error(`Unsupported global agent target: ${agentName}`);
        console.error(
          "Supported global agent targets: agents, codex, opencode, claude, cursor, pi, hermes, openclaw",
        );
        process.exit(1);
      }

      if (!targetIds.has(target.id)) {
        console.warn(`skip: ${target.id} (not detected at ~/${target.baseDir})`);
        continue;
      }

      selectedTargetIds.add(target.id);
    }

    if (selectedTargetIds.size === 0) {
      console.error("None of the requested global agent targets are installed.");
      process.exit(1);
    }
  } else if (interactive && !flags.yes && !useSymlinkMode) {
    const globalMode = await p.select({
      message: "Global install mode",
      options: [
        {
          value: "copy",
          label: "Copy to detected targets",
          hint: "Copy into detected global agent directories",
        },
        {
          value: "symlink",
          label: "Prefer ~/.agents + symlink",
          hint: "Install in ~/.agents/skills and symlink into detected dedicated skill roots",
        },
      ],
    });

    if (p.isCancel(globalMode)) {
      p.cancel("Cancelled");
      process.exit(0);
    }

    useSymlinkMode = globalMode === "symlink";
  }

  const globalAgentsDir = join(homedir(), ".agents", "skills");
  const globalClaudeDir = join(homedir(), ".claude", "skills");
  const globalCursorDir = join(homedir(), ".cursor", "skills");
  const globalPiDir = join(homedir(), ".pi", "agent", "skills");
  const globalHermesDir = join(homedir(), ".hermes", "skills");
  const globalOpenClawDir = join(homedir(), ".openclaw", "skills");

  if (useSymlinkMode) {
    if (!targetIds.has("agents")) {
      console.error(
        "`--global --symlink` requires ~/.agents to be installed as the source target.",
      );
      process.exit(1);
    }

    return { installPaths: [globalAgentsDir], useSymlinkMode };
  }

  const installPaths: string[] = [];

  if (selectedTargetIds.has("agents")) {
    installPaths.push(globalAgentsDir);
  }

  if (selectedTargetIds.has("claude")) {
    installPaths.push(globalClaudeDir);
  }

  if (selectedTargetIds.has("cursor")) {
    installPaths.push(globalCursorDir);
  }

  if (selectedTargetIds.has("pi")) {
    installPaths.push(globalPiDir);
  }

  if (selectedTargetIds.has("hermes")) {
    installPaths.push(globalHermesDir);
  }

  if (selectedTargetIds.has("openclaw")) {
    installPaths.push(globalOpenClawDir);
  }

  return { installPaths, useSymlinkMode };
}

function linkGlobalSymlinkTargets(
  selectedSkills: SkillInstallPlan[],
  requestedAgents: string[] | undefined,
): void {
  const globalAgentsDir = join(homedir(), ".agents", "skills");
  const globalClaudeDir = join(homedir(), ".claude", "skills");
  const globalCursorDir = join(homedir(), ".cursor", "skills");
  const globalPiDir = join(homedir(), ".pi", "agent", "skills");
  const globalHermesDir = join(homedir(), ".hermes", "skills");
  const globalOpenClawDir = join(homedir(), ".openclaw", "skills");
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
  const shouldLinkPi = targetIds.has("pi") && (!requestedTargets || requestedTargets.has("pi"));
  const shouldLinkHermes =
    targetIds.has("hermes") && (!requestedTargets || requestedTargets.has("hermes"));
  const shouldLinkOpenClaw =
    targetIds.has("openclaw") && (!requestedTargets || requestedTargets.has("openclaw"));

  if (shouldLinkClaude) {
    mkdirSync(globalClaudeDir, { recursive: true });
  }

  if (shouldLinkCursor) {
    mkdirSync(globalCursorDir, { recursive: true });
  }

  if (shouldLinkPi) {
    mkdirSync(globalPiDir, { recursive: true });
  }

  if (shouldLinkHermes) {
    mkdirSync(globalHermesDir, { recursive: true });
  }

  if (shouldLinkOpenClaw) {
    mkdirSync(globalOpenClawDir, { recursive: true });
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

    if (shouldLinkPi) {
      linkTargets.push(join(globalPiDir, plan.skill.name));
    }

    if (shouldLinkHermes) {
      linkTargets.push(join(globalHermesDir, plan.skill.name));
    }

    if (shouldLinkOpenClaw) {
      linkTargets.push(join(globalOpenClawDir, plan.skill.name));
    }

    for (const target of linkTargets) {
      if (existsSync(target)) {
        const stat = lstatSync(target);
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
