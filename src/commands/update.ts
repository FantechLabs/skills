import { parseArgs } from "node:util";

import * as p from "@clack/prompts";

import {
  resolveInstallTargets,
  type InstallTargetResolution,
  type TargetFlags,
} from "../lib/install-targets.js";
import { findInstalledSkills } from "../lib/installed-skills.js";
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
  "skip-deps": boolean;
}

interface UpdateSelectionOption {
  hint?: string;
  label: string;
  value: string;
}

export interface UpdateCommandDependencies {
  confirm(message: string): Promise<boolean | null>;
  cwd(): string;
  isInteractive(): boolean;
  loadLatestPackage(): Promise<LatestSkillPackage>;
  resolveTargets(options: {
    cwd: string;
    flags: TargetFlags;
    interactive: boolean;
  }): Promise<InstallTargetResolution>;
  selectPlans(options: UpdateSelectionOption[]): Promise<string[] | null>;
}

const defaultDependencies: UpdateCommandDependencies = {
  confirm: async (message) => {
    const answer = await p.confirm({ message });
    return p.isCancel(answer) ? null : answer;
  },
  cwd: () => process.cwd(),
  isInteractive: () => !!(process.stdout.isTTY && process.stdin.isTTY),
  loadLatestPackage: () => loadLatestSkillPackage(),
  resolveTargets: resolveInstallTargets,
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
  const { values: flags, positionals } = parseArgs({
    args,
    options: {
      agent: { type: "string", multiple: true },
      global: { type: "boolean", default: false },
      ruler: { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
      "skip-deps": { type: "boolean", default: false },
    },
    allowPositionals: true,
  }) as { values: UpdateFlags; positionals: string[] };

  const cwd = dependencies.cwd();
  const interactive = dependencies.isInteractive();
  const { installPaths } = await dependencies.resolveTargets({ cwd, flags, interactive });
  const installed = findInstalledSkills(installPaths);
  const latestPackage = await dependencies.loadLatestPackage();

  try {
    let plans = planSkillUpdates(installed, latestPackage.skills, positionals);

    if (plans.length === 0) {
      console.log("All selected installed skills are current.");
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

    printUpdatePlan(plans);

    if (!flags.yes) {
      const confirmed = await dependencies.confirm(`Update ${plans.length} skill(s)?`);
      if (!confirmed) {
        console.log("Cancelled");
        return;
      }
    }

    for (const plan of plans) {
      for (const updatePath of plan.updatePaths) {
        copySkill(plan.latest.path, updatePath);
        console.log(`  ✓ ${plan.name} -> ${updatePath}`);
      }
    }

    if (!flags["skip-deps"]) {
      installUpdatedDependencies(plans, cwd);
    }

    await applyRulerAfterChanges({ installPaths, interactive, yes: flags.yes });
    console.log(`\nUpdated ${plans.length} skill(s).`);
  } finally {
    latestPackage.cleanup();
  }
}

export default async function updateCommand(args: string[]): Promise<void> {
  await runUpdateCommand(args, defaultDependencies);
}

function printUpdatePlan(plans: SkillUpdatePlan[]): void {
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
  }

  console.log();
}

function installUpdatedDependencies(plans: SkillUpdatePlan[], cwd: string): void {
  const packageDirs = [
    ...new Set(
      plans.flatMap((plan) =>
        plan.updatePaths.flatMap((updatePath) => findSkillPackageDirs(updatePath)),
      ),
    ),
  ].sort();

  if (packageDirs.length === 0) {
    return;
  }

  const manager = detectPackageManager(cwd).manager;
  console.log(
    `\nInstalling dependencies with ${manager} for ${packageDirs.length} skill package(s)...`,
  );

  for (const packageDir of packageDirs) {
    console.log(`  ↳ ${packageDir}`);
    installPackageDependencies(manager, packageDir);
  }
}
