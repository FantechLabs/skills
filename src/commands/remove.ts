import { rmSync } from "node:fs";
import { parseArgs } from "node:util";

import * as p from "@clack/prompts";

import {
  resolveInstallTargets,
  type InstallTargetResolution,
  type TargetFlags,
} from "../lib/install-targets.js";
import { findInstalledSkills } from "../lib/installed-skills.js";
import { applyRulerAfterChanges } from "../lib/ruler.js";
import { planSkillRemovals, type SkillRemovalPlan } from "../lib/skill-removals.js";

interface RemoveFlags extends TargetFlags {
  global: boolean;
  ruler: boolean;
  yes: boolean;
}

interface RemoveSelectionOption {
  hint?: string;
  label: string;
  value: string;
}

interface RulerApplyOptions {
  installPaths: string[];
  interactive: boolean;
  yes: boolean;
}

export interface RemoveCommandDependencies {
  applyRuler(options: RulerApplyOptions): Promise<void>;
  confirm(message: string): Promise<boolean | null>;
  cwd(): string;
  isInteractive(): boolean;
  resolveTargets(options: {
    cwd: string;
    flags: TargetFlags;
    interactive: boolean;
  }): Promise<InstallTargetResolution>;
  selectPlans(options: RemoveSelectionOption[]): Promise<string[] | null>;
}

const defaultDependencies: RemoveCommandDependencies = {
  applyRuler: applyRulerAfterChanges,
  confirm: async (message) => {
    const answer = await p.confirm({ message });
    return p.isCancel(answer) ? null : answer;
  },
  cwd: () => process.cwd(),
  isInteractive: () => !!(process.stdout.isTTY && process.stdin.isTTY),
  resolveTargets: resolveInstallTargets,
  selectPlans: async (options) => {
    const selected = await p.multiselect<string>({
      message: "Select skills to remove",
      options,
      required: true,
    });
    return p.isCancel(selected) ? null : selected;
  },
};

export async function runRemoveCommand(
  args: string[],
  dependencies: RemoveCommandDependencies,
): Promise<number> {
  const { values: flags, positionals } = parseArgs({
    args,
    options: {
      agent: { type: "string", multiple: true },
      global: { type: "boolean", default: false },
      ruler: { type: "boolean", default: false },
      yes: { type: "boolean", default: false },
    },
    allowPositionals: true,
  }) as { values: RemoveFlags; positionals: string[] };

  if (flags.yes && positionals.length === 0) {
    throw new Error("Remove --yes requires explicit skill names.");
  }

  const interactive = dependencies.isInteractive();
  if (!interactive && (positionals.length === 0 || !flags.yes)) {
    throw new Error("Non-interactive removals require explicit skill names and --yes.");
  }

  const cwd = dependencies.cwd();
  const { installPaths } = await dependencies.resolveTargets({ cwd, flags, interactive });
  const installed = findInstalledSkills(installPaths);
  let plans = planSkillRemovals(installed, positionals);

  if (plans.length === 0) {
    console.log("No installed skills found in the selected targets.");
    return 0;
  }

  if (positionals.length === 0) {
    const selectedNames = await dependencies.selectPlans(
      plans.map((plan) => ({
        value: plan.name,
        label: plan.name,
        hint: plan.locations.map(formatLogicalLocation).join(", "),
      })),
    );

    if (!selectedNames || selectedNames.length === 0) {
      console.log("Cancelled");
      return 0;
    }

    const selectedSet = new Set(selectedNames);
    plans = plans.filter((plan) => selectedSet.has(plan.name));

    if (plans.length === 0) {
      console.log("Cancelled");
      return 0;
    }
  }

  printRemovalPlan(plans);

  if (!flags.yes) {
    const confirmed = await dependencies.confirm(`Remove ${plans.length} skill(s)?`);
    if (!confirmed) {
      console.log("Cancelled");
      return 0;
    }
  }

  for (const plan of plans) {
    for (const location of plan.locations) {
      rmSync(location.path, { recursive: true, force: true });
      console.log(`  ✓ ${plan.name} -> ${formatLogicalLocation(location)}`);
    }
  }

  await dependencies.applyRuler({ installPaths, interactive, yes: flags.yes });
  console.log(`\nRemoved ${plans.length} skill(s).`);
  return 0;
}

export default async function removeCommand(args: string[]): Promise<void> {
  await runRemoveCommand(args, defaultDependencies);
}

function printRemovalPlan(plans: SkillRemovalPlan[]): void {
  console.log("\nRemoval plan:\n");

  for (const plan of plans) {
    console.log(`  - ${plan.name}`);
    for (const location of plan.locations) {
      console.log(`    - ${formatLogicalLocation(location)}`);
    }
  }

  console.log();
}

function formatLogicalLocation(location: SkillRemovalPlan["locations"][number]): string {
  return `${location.path}${location.isSymlink ? " (symlink)" : ""}`;
}
