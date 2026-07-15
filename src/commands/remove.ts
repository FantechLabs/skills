import { rmSync } from "node:fs";
import { parseArgs } from "node:util";

import * as p from "@clack/prompts";

import {
  resolveManagementTargets,
  type ManagementTargetResolution,
  type TargetFlags,
} from "../lib/install-targets.js";
import { findInstalledSkills, type InstalledSkill } from "../lib/installed-skills.js";
import { applyRulerAfterChanges } from "../lib/ruler.js";
import { planSkillRemovals, type SkillRemovalPlan } from "../lib/skill-removals.js";

interface RemoveFlags extends TargetFlags {
  global: boolean;
  help: boolean;
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
  }): Promise<ManagementTargetResolution>;
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
  resolveTargets: resolveManagementTargets,
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
  if (args.includes("--help") || args.includes("-h")) {
    showRemoveHelp();
    return 0;
  }

  const { values: flags, positionals } = parseArgs({
    args,
    options: {
      agent: { type: "string", multiple: true },
      global: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
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
  const { installPaths, relatedInstallPaths } = await dependencies.resolveTargets({
    cwd,
    flags,
    interactive,
  });
  const installed = findInstalledSkills(installPaths);
  const relatedInstalled = findInstalledSkills(relatedInstallPaths);
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

  const impacts = plans.map((plan) => buildRemovalImpact(plan, relatedInstalled));
  printRemovalPlan(impacts);

  if (!flags.yes) {
    const confirmed = await dependencies.confirm(`Remove ${plans.length} skill(s)?`);
    if (!confirmed) {
      console.log("Cancelled");
      return 0;
    }
  }

  for (const impact of impacts) {
    for (const location of [...impact.plan.locations, ...impact.affectedSymlinks]) {
      rmSync(location.path, { recursive: true, force: true });
      console.log(`  ✓ ${impact.plan.name} -> ${formatImpactedLocation(location, impact)}`);
    }
  }

  await dependencies.applyRuler({ installPaths, interactive, yes: flags.yes });
  console.log(`\nRemoved ${plans.length} skill(s).`);
  return 0;
}

export default async function removeCommand(args: string[]): Promise<void> {
  await runRemoveCommand(args, defaultDependencies);
}

interface RemovalImpact {
  affectedSymlinks: InstalledSkill[];
  plan: SkillRemovalPlan;
  sharedSourcePaths: Set<string>;
}

function printRemovalPlan(impacts: RemovalImpact[]): void {
  console.log("\nRemoval plan:\n");

  for (const impact of impacts) {
    console.log(`  - ${impact.plan.name}`);
    for (const location of impact.plan.locations) {
      console.log(`    - ${formatImpactedLocation(location, impact)}`);
    }
    for (const location of impact.affectedSymlinks) {
      console.log(`    - ${formatImpactedLocation(location, impact)}`);
    }
  }

  console.log();
}

function buildRemovalImpact(
  plan: SkillRemovalPlan,
  relatedInstalled: InstalledSkill[],
): RemovalImpact {
  const selectedPaths = new Set(plan.locations.map((location) => location.path));
  const selectedSources = plan.locations.filter((location) => !location.isSymlink);
  const selectedCanonicalSources = new Set(
    selectedSources.map((location) => location.canonicalPath),
  );
  const backedSymlinks = relatedInstalled.filter(
    (location) =>
      location.name === plan.name &&
      location.isSymlink &&
      selectedCanonicalSources.has(location.canonicalPath),
  );

  return {
    affectedSymlinks: backedSymlinks.filter((location) => !selectedPaths.has(location.path)),
    plan,
    sharedSourcePaths: new Set(
      selectedSources
        .filter((source) =>
          backedSymlinks.some((link) => link.canonicalPath === source.canonicalPath),
        )
        .map((source) => source.path),
    ),
  };
}

function formatImpactedLocation(location: InstalledSkill, impact: RemovalImpact): string {
  if (impact.affectedSymlinks.some((entry) => entry.path === location.path)) {
    return `${location.path} (affected symlink)`;
  }
  if (impact.sharedSourcePaths.has(location.path)) {
    return `${location.path} (shared source)`;
  }
  return formatLogicalLocation(location);
}

function formatLogicalLocation(location: SkillRemovalPlan["locations"][number]): string {
  return `${location.path}${location.isSymlink ? " (symlink)" : ""}`;
}

function showRemoveHelp(): void {
  console.log(`
Usage:
  skills remove [skills...] [options]

Remove installed skills from selected logical targets after confirmation.

Options:
  --agent <agent>  Restrict discovery to an agent target; repeat for multiple agents
  --global         Inventory detected global agent skill roots
  --ruler          Use the current project's .ruler/skills root
  --yes            Skip confirmation; requires explicit skill names
  -h, --help       Show this help

Safety:
  Removing a dedicated symlink preserves its shared source. Removing a selected shared source
  also lists and removes detected affected symlinks so no dangling logical installs remain.
`);
}
