import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import * as p from "@clack/prompts";

import {
  detectAgents,
  detectGlobalAgentTargets,
  getInstallPaths,
  type GlobalAgentTarget,
  resolveAgentInstallPath,
  resolveGlobalAgentTarget,
} from "../lib/agents.js";
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
      global: { type: "boolean", default: false },
      symlink: { type: "boolean", default: false },
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

  if (flags.global && flags.ruler) {
    console.error("`--global` and `--ruler` cannot be used together.");
    process.exit(1);
  }

  if (flags.symlink && !flags.global) {
    console.error("`--symlink` requires `--global`.");
    process.exit(1);
  }

  const globalAgentsDir = join(homedir(), ".agents", "skills");
  const globalClaudeDir = join(homedir(), ".claude", "skills");
  const globalCursorDir = join(homedir(), ".cursor", "skills");
  let useSymlinkMode = flags.symlink;
  let installPaths: string[] = [];

  if (flags.global) {
    const detectedGlobalTargets = detectGlobalAgentTargets();
    const targetIds = new Set(detectedGlobalTargets.map((target) => target.id));

    if (detectedGlobalTargets.length === 0) {
      console.error(
        "No supported global agent directories found. Expected one of: ~/.agents, ~/.claude, ~/.cursor",
      );
      process.exit(1);
    }

    let selectedTargetIds = new Set(detectedGlobalTargets.map((target) => target.id));

    if (flags.agent && flags.agent.length > 0) {
      selectedTargetIds = new Set();

      for (const agentName of flags.agent) {
        const target = resolveGlobalAgentTarget(agentName);
        if (!target) {
          console.error(`Unsupported global agent target: ${agentName}`);
          console.error("Supported global agent targets: agents, codex, opencode, claude, cursor");
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
            label: "Copy to both",
            hint: "Copy into detected global agent directories",
          },
          {
            value: "symlink",
            label: "Prefer ~/.agents + symlink",
            hint: "Install in ~/.agents/skills and symlink into ~/.claude/skills / ~/.cursor/skills",
          },
        ],
      });

      if (p.isCancel(globalMode)) {
        p.cancel("Cancelled");
        process.exit(0);
      }

      useSymlinkMode = globalMode === "symlink";
    }

    if (useSymlinkMode) {
      if (!targetIds.has("agents")) {
        console.error(
          "`--global --symlink` requires ~/.agents to be installed as the source target.",
        );
        process.exit(1);
      }

      installPaths = [globalAgentsDir];
    } else {
      if (selectedTargetIds.has("agents")) {
        installPaths.push(globalAgentsDir);
      }

      if (selectedTargetIds.has("claude")) {
        installPaths.push(globalClaudeDir);
      }

      if (selectedTargetIds.has("cursor")) {
        installPaths.push(globalCursorDir);
      }
    }
  } else if (flags.ruler || isRulerProject(cwd)) {
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

  if (flags.global && useSymlinkMode) {
    const detectedGlobalTargets = detectGlobalAgentTargets();
    const targetIds = new Set(detectedGlobalTargets.map((target) => target.id));

    const requestedTargets =
      flags.agent && flags.agent.length > 0
        ? new Set(
            flags.agent
              .map((agentName) => resolveGlobalAgentTarget(agentName))
              .filter((target): target is GlobalAgentTarget => target !== null)
              .map((target) => target.id),
          )
        : null;

    const shouldLinkClaude =
      targetIds.has("claude") && (!requestedTargets || requestedTargets.has("claude"));
    const shouldLinkCursor =
      targetIds.has("cursor") && (!requestedTargets || requestedTargets.has("cursor"));

    if (shouldLinkClaude) {
      mkdirSync(globalClaudeDir, { recursive: true });
    }

    if (shouldLinkCursor) {
      mkdirSync(globalCursorDir, { recursive: true });
    }

    for (const skill of selectedSkills) {
      const source = join(globalAgentsDir, skill.name);
      const linkTargets: string[] = [];

      if (shouldLinkClaude) {
        linkTargets.push(join(globalClaudeDir, skill.name));
      }

      if (shouldLinkCursor) {
        linkTargets.push(join(globalCursorDir, skill.name));
      }

      for (const target of linkTargets) {
        if (existsSync(target)) {
          const stat = lstatSync(target);
          if (!stat.isSymbolicLink()) {
            console.log(`  ↷ skip symlink for ${skill.name} (manual override at ${target})`);
            continue;
          }

          const current = readlinkSync(target);
          if (current === source) {
            console.log(`  ✓ ${skill.name} already linked at ${target}`);
            continue;
          }

          rmSync(target, { recursive: true, force: true });
        }

        symlinkSync(source, target);
        console.log(`  🔗 ${skill.name} -> ${target}`);
      }
    }
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
