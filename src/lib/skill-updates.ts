import type { InstalledSkill } from "./installed-skills.js";
import { compareStableVersions, parseStableVersion, type SkillInfo } from "./skills.js";

export interface SkillUpdatePlan {
  installedVersions: string[];
  latest: SkillInfo;
  locations: InstalledSkill[];
  name: string;
  updatePaths: string[];
}

export function planSkillUpdates(
  installed: InstalledSkill[],
  latest: SkillInfo[],
  requestedNames: string[],
): SkillUpdatePlan[] {
  const installedByName = groupInstalledByName(installed);
  const latestByName = new Map(latest.map((skill) => [skill.name, skill]));
  const explicitNames = [...new Set(requestedNames)];

  validateRequestedNames(explicitNames, installedByName, latestByName);

  const names = explicitNames.length > 0 ? explicitNames : [...installedByName.keys()];
  const plans: SkillUpdatePlan[] = [];

  for (const name of names) {
    const latestSkill = latestByName.get(name);
    if (!latestSkill) {
      continue;
    }

    const latestVersion = parseStableVersion(latestSkill.version, `${name} latest package`);
    const outdatedLocations = (installedByName.get(name) ?? []).filter((location) => {
      if (!location.version) {
        return true;
      }

      const installedVersion = parseStableVersion(
        location.version,
        `${name} installed at ${location.path}`,
      );
      return compareStableVersions(installedVersion, latestVersion) < 0;
    });

    if (outdatedLocations.length === 0) {
      continue;
    }

    outdatedLocations.sort((left, right) => left.path.localeCompare(right.path));
    plans.push({
      installedVersions: sortInstalledVersions(installedByName.get(name) ?? []),
      latest: latestSkill,
      locations: outdatedLocations,
      name,
      updatePaths: [...new Set(outdatedLocations.map((location) => location.canonicalPath))].sort(),
    });
  }

  return plans.sort((left, right) => left.name.localeCompare(right.name));
}

export function formatVersionTransition(plan: SkillUpdatePlan): string {
  return `${plan.installedVersions.join(", ")} -> ${plan.latest.version}`;
}

function groupInstalledByName(installed: InstalledSkill[]): Map<string, InstalledSkill[]> {
  const grouped = new Map<string, InstalledSkill[]>();

  for (const location of installed) {
    const locations = grouped.get(location.name) ?? [];
    locations.push(location);
    grouped.set(location.name, locations);
  }

  return grouped;
}

function validateRequestedNames(
  names: string[],
  installedByName: Map<string, InstalledSkill[]>,
  latestByName: Map<string, SkillInfo>,
): void {
  for (const name of names) {
    const isInstalled = installedByName.has(name);
    const isLatest = latestByName.has(name);

    if (!isInstalled && !isLatest) {
      throw new Error(`Unknown skill: ${name}`);
    }
    if (!isInstalled) {
      throw new Error(`Skill is not installed: ${name}`);
    }
    if (!isLatest) {
      throw new Error(`Skill is missing from the latest package: ${name}`);
    }
  }
}

function sortInstalledVersions(locations: InstalledSkill[]): string[] {
  const versions = new Set(locations.map((location) => location.version ?? "legacy"));

  return [...versions].sort((left, right) => {
    if (left === "legacy") {
      return right === "legacy" ? 0 : -1;
    }
    if (right === "legacy") {
      return 1;
    }
    return compareStableVersions(
      parseStableVersion(left, "installed update plan"),
      parseStableVersion(right, "installed update plan"),
    );
  });
}
