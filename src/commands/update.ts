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

export interface UpdateFileSystem {
  exists(path: string): boolean;
  remove(path: string): void;
  rename(sourcePath: string, destinationPath: string): void;
}

export interface UpdateCommandDependencies {
  applyRuler(options: RulerApplyOptions): Promise<void>;
  confirm(message: string): Promise<boolean | null>;
  cwd(): string;
  fileSystem: UpdateFileSystem;
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
  fileSystem: {
    exists: existsSync,
    remove: (path) => rmSync(path, { recursive: true, force: true }),
    rename: renameSync,
  },
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
      fileSystem: dependencies.fileSystem,
      installDependencies: !flags["skip-deps"],
      plans,
    });
    console.log(`\nUpdated ${plans.length} skill(s).`);
  } finally {
    try {
      latestPackage.cleanup();
    } catch (error) {
      console.warn(
        `Failed to clean up latest npm skill package at ${latestPackage.packageRoot}: ${formatError(error)}. Check for retained package files and remove them manually.`,
      );
    }
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
  fileSystem: UpdateFileSystem;
  installDependencies: boolean;
  plans: SkillUpdatePlan[];
}): Promise<void> {
  const updates: StagedSkillUpdate[] = [];

  try {
    for (const plan of options.plans) {
      for (const destinationPath of plan.updatePaths) {
        const stagingPath = createUniqueSiblingPath(destinationPath, "staging", options.fileSystem);
        const backupPath = createUniqueSiblingPath(destinationPath, "backup", options.fileSystem);
        updates.push({ backupPath, destinationPath, name: plan.name, stagingPath });
        copySkill(plan.latest.path, stagingPath);
      }
    }

    if (options.installDependencies) {
      installUpdatedDependencies(updates, options.cwd);
    }

    for (const update of updates) {
      options.fileSystem.rename(update.destinationPath, update.backupPath);
      options.fileSystem.rename(update.stagingPath, update.destinationPath);
      console.log(`  ✓ ${update.name} -> ${update.destinationPath}`);
    }

    await options.applyRuler();
  } catch (error) {
    const rollbackFailures: Array<{
      backupPath: string;
      destinationPath: string;
      displacedPath?: string;
      error: unknown;
    }> = [];
    for (const update of [...updates].reverse()) {
      if (!options.fileSystem.exists(update.backupPath)) {
        continue;
      }

      let displacedPath: string | undefined;
      try {
        if (options.fileSystem.exists(update.destinationPath)) {
          displacedPath = createUniqueSiblingPath(
            update.destinationPath,
            "rollback",
            options.fileSystem,
          );
          options.fileSystem.rename(update.destinationPath, displacedPath);
        }

        try {
          options.fileSystem.rename(update.backupPath, update.destinationPath);
        } catch (rollbackError) {
          if (displacedPath && options.fileSystem.exists(displacedPath)) {
            try {
              options.fileSystem.rename(displacedPath, update.destinationPath);
              displacedPath = undefined;
            } catch (displacedRestoreError) {
              rollbackFailures.push({
                backupPath: update.backupPath,
                destinationPath: update.destinationPath,
                displacedPath,
                error: new Error(
                  `${formatError(rollbackError)}; failed to restore displaced live update: ${formatError(displacedRestoreError)}`,
                  { cause: rollbackError },
                ),
              });
              continue;
            }
          }

          rollbackFailures.push({
            backupPath: update.backupPath,
            destinationPath: update.destinationPath,
            error: rollbackError,
          });
          continue;
        }

        if (displacedPath) {
          options.fileSystem.remove(displacedPath);
          displacedPath = undefined;
        }
      } catch (rollbackError) {
        rollbackFailures.push({
          backupPath: update.backupPath,
          destinationPath: update.destinationPath,
          displacedPath,
          error: rollbackError,
        });
      }
    }

    if (rollbackFailures.length > 0) {
      const retainedBackups = updates
        .map((update) => update.backupPath)
        .filter((backupPath) => options.fileSystem.exists(backupPath));
      const retainedBackupDetails = retainedBackups.map((path) => `- ${path}`).join("\n");
      const retainedDisplacedPaths = rollbackFailures
        .map((failure) => failure.displacedPath)
        .filter(
          (path): path is string => typeof path === "string" && options.fileSystem.exists(path),
        );
      const retainedDisplacedDetails = retainedDisplacedPaths.map((path) => `- ${path}`).join("\n");
      const rollbackErrorDetails = rollbackFailures
        .map(
          (failure) =>
            `- ${failure.backupPath} -> ${failure.destinationPath}: ${formatError(failure.error)}`,
        )
        .join("\n");
      throw new Error(
        [
          "Skill update failed and rollback was incomplete.",
          `Original error: ${formatError(error)}`,
          "Retained backups for manual recovery:",
          retainedBackupDetails || "- none detected",
          ...(retainedDisplacedPaths.length > 0
            ? ["Retained displaced live updates for manual recovery:", retainedDisplacedDetails]
            : []),
          "Rollback errors:",
          rollbackErrorDetails,
        ].join("\n"),
        { cause: error },
      );
    }
    throw error;
  } finally {
    for (const update of updates) {
      try {
        options.fileSystem.remove(update.stagingPath);
      } catch (error) {
        console.warn(
          `Failed to clean up staging path ${update.stagingPath}: ${formatError(error)}. Remove this retained staging directory manually.`,
        );
      }
    }
  }

  for (const update of updates) {
    try {
      options.fileSystem.remove(update.backupPath);
    } catch (error) {
      console.warn(
        `Update committed, but backup cleanup failed for ${update.backupPath}: ${formatError(error)}. Remove this retained backup manually.`,
      );
    }
  }
}

function createUniqueSiblingPath(
  destinationPath: string,
  purpose: string,
  fileSystem: UpdateFileSystem,
): string {
  const siblingPath = mkdtempSync(
    join(dirname(destinationPath), `.${basename(destinationPath)}.${purpose}-`),
  );
  fileSystem.remove(siblingPath);
  return siblingPath;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
