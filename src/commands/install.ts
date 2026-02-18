import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import * as p from "@clack/prompts";

import { detectAgents, getInstallPaths, resolveAgentInstallPath } from "../lib/agents.js";
import { getRulerSkillsDir, isRulerProject } from "../lib/ruler.js";
import { copySkill, discoverBundledSkills } from "../lib/skills.js";

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
    },
    allowPositionals: true,
  });

  const cwd = process.cwd();
  const skills = discoverBundledSkills();
  const interactive = isInteractiveTty();

  let selectedSkillNames: string[] = [];

  if (positionals.length > 0) {
    selectedSkillNames = [...new Set(positionals)];
  } else if (interactive && !flags.yes) {
    p.intro("Install skills");
    const selected = await p.multiselect<string>({
      message: "Select skills to install",
      required: true,
      options: skills.map((skill) => ({
        value: skill.name,
        label: skill.name,
        hint: skill.description,
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

  const selectedSkills = skills.filter((skill) => selectedSkillNames.includes(skill.name));

  let installPaths: string[] = [];

  if (flags.ruler || isRulerProject(cwd)) {
    installPaths = [getRulerSkillsDir(cwd)];
  } else if (flags.agent && flags.agent.length > 0) {
    installPaths = [...new Set(flags.agent.map((agent) => resolveAgentInstallPath(cwd, agent)))];
  } else {
    const detectedAgents = detectAgents(cwd);

    if (detectedAgents.length > 0) {
      installPaths = getInstallPaths(cwd, detectedAgents);
    } else if (!interactive || flags.yes) {
      installPaths = [join(cwd, ".agents", "skills")];
    } else {
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
        installPaths = [getRulerSkillsDir(cwd)];
      } else if (targetChoice === "claude") {
        installPaths = [join(cwd, ".claude", "skills")];
      } else {
        installPaths = [join(cwd, ".agents", "skills")];
      }
    }
  }

  for (const baseDir of installPaths) {
    mkdirSync(baseDir, { recursive: true });

    for (const skill of selectedSkills) {
      const targetDir = join(baseDir, skill.name);
      copySkill(skill.path, targetDir);
      console.log(`  ✓ ${skill.name} -> ${targetDir}`);
    }
  }

  if (installPaths.some((path) => path.replace(/\\/g, "/").includes("/.ruler/skills"))) {
    console.log("\nRun `ruler apply` to propagate .ruler skills to configured agents.");
  }

  console.log(`\nInstalled ${selectedSkills.length} skill(s).`);
}
