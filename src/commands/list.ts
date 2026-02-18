import { discoverBundledSkills, findInstalledSkills } from "../lib/skills.js";

export default async function listCommand(_args: string[]): Promise<void> {
  const bundled = discoverBundledSkills();
  const installed = findInstalledSkills(process.cwd());

  console.log("\nAvailable skills:\n");

  for (const skill of bundled) {
    const locations = installed.get(skill.name) || [];
    const status =
      locations.length > 0
        ? `installed (${locations.length} location${locations.length > 1 ? "s" : ""})`
        : "not installed";
    const scriptsLabel = skill.hasScripts ? "runnable" : "docs only";

    console.log(`  ${skill.name.padEnd(14)} ${status.padEnd(22)} ${scriptsLabel}`);
    if (skill.description) {
      console.log(`  ${"".padEnd(14)} ${skill.description}`);
    }
    console.log();
  }
}
