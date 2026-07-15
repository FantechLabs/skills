import { existsSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { parseArgs } from "node:util";

import * as p from "@clack/prompts";

import {
  resolveManagementTargets,
  type ManagementTargetResolution,
  type TargetFlags,
} from "../lib/install-targets.js";
import { findInstalledSkills, type InstalledSkill } from "../lib/installed-skills.js";
import { loadLatestSkillPackage, type LatestSkillPackage } from "../lib/npm-skills.js";
import { detectPackageManager, installPackageDependencies } from "../lib/package-manager.js";
import { applyRulerAfterChanges } from "../lib/ruler.js";
import {
  formatVersionTransition,
  planSkillUpdates,
  type SkillUpdatePlan,
} from "../lib/skill-updates.js";
import { copySkill, findSkillPackageDirs } from "../lib/skills.js";

interface UpdateFlags extends TargetFlags {
  help: boolean;
  "skip-deps": boolean;
}

interface UpdateSelectionOption {
  hint?: string;
  label: string;
  value: string;
}

interface RulerApplyOptions {
  installPaths: string[];
  interactive: boolean;
  yes: boolean;
}

interface StagedSkillUpdate {
  backupPath: string;
  destinationPath: string;
  name: string;
  stagingPath: string;
}

export interface UpdateCommandDependencies {
  applyRuler(options: RulerApplyOptions): Promise<void>;
  confirm(message: string): Promise<boolean | null>;
  cwd(): string;
  isInteractive(): boolean;
  loadLatestPackage(): Promise<LatestSkillPackage>;
  resolveTargets(options: {
    cwd: string;
    flags: TargetFlags;
    interactive: boolean;
  }): Promise<ManagementTargetResolution>;
  selectPlans(options: UpdateSelectionOption[]): Promise<string[] | null>;
}

const defaultDependencies: UpdateCommandDependencies = {
  applyRuler: applyRulerAfterChanges,
  confirm: async (message) => {
    const answer = await p.confirm({ message });
    return p.isCancel(answer) ? null : answer;
  },
  cwd: () => process.cwd(),
  isInteractive: () => !!(process.stdout.isTTY && process.stdin.isTTY),
  loadLatestPackage: () => loadLatestSkillPackage(),
  resolveTargets: resolveManagementTargets,
  selectPlans: async (options) => {
    const selected = await p.multiselect<string>({
      message: "Select skills to update",
      options,
      required: true,
    });
    return p.isCancel(selected) ? null : selected;
  },
};

export async function runUpdateCommand(
  args: string[],
  dependencies: UpdateCommandDependencies,
): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    showUpdateHelp();
    return;
  }

  const { values: flags, positionals } = parseArgs({
    args,
    options: {
      agent: { type: "string", multiple: true },
      global: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      ruler: { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
      "skip-deps": { type: "boolean", default: false },
    },
    allowPositionals: true,
  }) as { values: UpdateFlags; positionals: string[] };

  const cwd = dependencies.cwd();
  const interactive = dependencies.isInteractive();
  const { installPaths, relatedInstallPaths } = await dependencies.resolveTargets({
    cwd,
    flags,
    interactive,
  });
  const installed = findInstalledSkills(installPaths);
  const relatedInstalled = findInstalledSkills(relatedInstallPaths);
  const latestPackage = await dependencies.loadLatestPackage();

  try {
    const unavailableNames =
      positionals.length === 0
        ? findUnavailableInstalledSkillNames(
            installed,
            latestPackage.skills.map((skill) => skill.name),
          )
        : [];
    if (unavailableNames.length > 0) {
      console.log(
        `Installed skills absent from npm latest (not updateable): ${unavailableNames.join(", ")}`,
      );
    }

    let plans = planSkillUpdates(installed, latestPackage.skills, positionals);

    if (plans.length === 0) {
      if (unavailableNames.length === 0) {
        console.log("All selected installed skills are current.");
      } else {
        console.log("No updateable installed skills have updates available.");
      }
      return;
    }

    if (!interactive && !flags.yes) {
      throw new Error("Non-interactive updates require --yes.");
    }

    if (interactive && positionals.length === 0 && !flags.yes) {
      const selectedNames = await dependencies.selectPlans(
        plans.map((plan) => ({
          value: plan.name,
          label: `${plan.name}: ${formatVersionTransition(plan)}`,
          hint: plan.locations.map((location) => location.path).join(", "),
        })),
      );

      if (!selectedNames || selectedNames.length === 0) {
        console.log("Cancelled");
        return;
      }

      const selectedSet = new Set(selectedNames);
      plans = plans.filter((plan) => selectedSet.has(plan.name));
    }

    printUpdatePlan(plans, relatedInstalled);

    if (!flags.yes) {
      const confirmed = await dependencies.confirm(`Update ${plans.length} skill(s)?`);
      if (!confirmed) {
        console.log("Cancelled");
        return;
      }
    }

    await applyUpdatesTransactionally({
      applyRuler: () => dependencies.applyRuler({ installPaths, interactive, yes: flags.yes }),
      cwd,
      installDependencies: !flags["skip-deps"],
      plans,
    });
    console.log(`\nUpdated ${plans.length} skill(s).`);
  } finally {
    latestPackage.cleanup();
  }
}

export default async function updateCommand(args: string[]): Promise<void> {
  await runUpdateCommand(args, defaultDependencies);
}

function printUpdatePlan(plans: SkillUpdatePlan[], relatedInstalled: InstalledSkill[]): void {
  console.log("\nUpdate plan:\n");

  for (const plan of plans) {
    console.log(`  ~ ${plan.name}: ${formatVersionTransition(plan)}`);
    for (const location of plan.locations) {
      console.log(`    - ${location.path}`);
    }

    for (const updatePath of plan.updatePaths) {
      const affectedLocations = plan.locations.filter(
        (location) => location.canonicalPath === updatePath,
      );
      if (affectedLocations.some((location) => location.isSymlink)) {
        console.log(`      shared source: ${updatePath}`);
      }
    }

    for (const affectedLink of findAffectedSymlinks(plan, relatedInstalled)) {
      console.log(`    - ${affectedLink.path} (affected symlink)`);
    }
  }

  console.log();
}

function findAffectedSymlinks(
  plan: SkillUpdatePlan,
  relatedInstalled: InstalledSkill[],
): InstalledSkill[] {
  const selectedPaths = new Set(plan.locations.map((location) => location.path));
  const updatePaths = new Set(plan.updatePaths);

  return relatedInstalled.filter(
    (location) =>
      location.name === plan.name &&
      location.isSymlink &&
      updatePaths.has(location.canonicalPath) &&
      !selectedPaths.has(location.path),
  );
}

function findUnavailableInstalledSkillNames(
  installed: InstalledSkill[],
  latestNames: string[],
): string[] {
  const available = new Set(latestNames);
  return [
    ...new Set(installed.map((skill) => skill.name).filter((name) => !available.has(name))),
  ].sort();
}

function showUpdateHelp(): void {
  console.log(`
Usage:
  skills update [skills...] [options]

Update installed skills from the package selected by npm's latest dist-tag.
Only legacy or older locations are changed; the command never downgrades current or newer skills.

Options:
  --agent <agent>  Restrict discovery to an agent target; repeat for multiple agents
  --global         Inventory detected global agent skill roots
  --ruler          Use the current project's .ruler/skills root
  --yes            Skip selection and confirmation; without names, update all outdated skills
  --skip-deps      Do not install dependencies for updated runnable skills
  -h, --help       Show this help

Safety:
  Without --yes, changes require interactive confirmation. Updates preserve symlinks and show
  every detected logical link affected by a shared canonical source.
`);
}

async function applyUpdatesTransactionally(options: {
  applyRuler(): Promise<void>;
  cwd: string;
  installDependencies: boolean;
  plans: SkillUpdatePlan[];
}): Promise<void> {
  const updates: StagedSkillUpdate[] = [];

  try {
    for (const plan of options.plans) {
      for (const destinationPath of plan.updatePaths) {
        const stagingPath = createUniqueSiblingPath(destinationPath, "staging");
        const backupPath = createUniqueSiblingPath(destinationPath, "backup");
        updates.push({ backupPath, destinationPath, name: plan.name, stagingPath });
        copySkill(plan.latest.path, stagingPath);
      }
    }

    if (options.installDependencies) {
      installUpdatedDependencies(updates, options.cwd);
    }

    for (const update of updates) {
      renameSync(update.destinationPath, update.backupPath);
      renameSync(update.stagingPath, update.destinationPath);
      console.log(`  ✓ ${update.name} -> ${update.destinationPath}`);
    }

    await options.applyRuler();

    for (const update of updates) {
      rmSync(update.backupPath, { recursive: true, force: true });
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const update of [...updates].reverse()) {
      if (!existsSync(update.backupPath)) {
        continue;
      }

      try {
        rmSync(update.destinationPath, { recursive: true, force: true });
        renameSync(update.backupPath, update.destinationPath);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }

    if (rollbackErrors.length > 0) {
      throw new Error(
        "Skill update failed and one or more original directories could not be restored.",
        { cause: error },
      );
    }
    throw error;
  } finally {
    for (const update of updates) {
      rmSync(update.stagingPath, { recursive: true, force: true });
    }
  }
}

function createUniqueSiblingPath(destinationPath: string, purpose: string): string {
  const siblingPath = mkdtempSync(
    join(dirname(destinationPath), `.${basename(destinationPath)}.${purpose}-`),
  );
  rmSync(siblingPath, { recursive: true });
  return siblingPath;
}

function installUpdatedDependencies(updates: StagedSkillUpdate[], cwd: string): void {
  const packageDirs = updates
    .flatMap((update) =>
      findSkillPackageDirs(update.stagingPath).map((packageDir) => ({
        displayPath: join(update.destinationPath, relative(update.stagingPath, packageDir)),
        packageDir,
      })),
    )
    .sort((left, right) => left.displayPath.localeCompare(right.displayPath));

  if (packageDirs.length === 0) {
    return;
  }

  const manager = detectPackageManager(cwd).manager;
  console.log(
    `\nInstalling dependencies with ${manager} for ${packageDirs.length} skill package(s)...`,
  );

  for (const { displayPath, packageDir } of packageDirs) {
    console.log(`  ↳ ${displayPath}`);
    installPackageDependencies(manager, packageDir);
  }
}
