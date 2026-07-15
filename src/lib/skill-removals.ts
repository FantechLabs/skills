import type { InstalledSkill } from "./installed-skills.js";

export interface SkillRemovalPlan {
  locations: InstalledSkill[];
  name: string;
}

export function planSkillRemovals(
  installed: InstalledSkill[],
  requestedNames: string[],
): SkillRemovalPlan[] {
  const installedByName = new Map<string, InstalledSkill[]>();

  for (const location of installed) {
    const locations = installedByName.get(location.name) ?? [];
    locations.push(location);
    installedByName.set(location.name, locations);
  }

  const explicitNames = [...new Set(requestedNames)].sort();

  for (const name of explicitNames) {
    if (!installedByName.has(name)) {
      throw new Error(`Skill is not installed: ${name}`);
    }
  }

  const names = explicitNames.length > 0 ? explicitNames : [...installedByName.keys()].sort();

  return names.map((name) => ({
    locations: [...installedByName.get(name)!].sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
    name,
  }));
}
