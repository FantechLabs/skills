import { homedir } from "node:os";
import { join } from "node:path";
import * as p from "@clack/prompts";

import {
  detectAgents,
  detectGlobalAgentTargets,
  getInstallPaths,
  resolveAgentInstallPath,
  resolveGlobalAgentTarget,
} from "./agents.js";
import { getRulerSkillsDir, isRulerProject } from "./ruler.js";

export interface TargetFlags {
  agent?: string[];
  global: boolean;
  ruler: boolean;
  symlink?: boolean;
  yes: boolean;
}

export interface InstallTargetResolution {
  installPaths: string[];
  useSymlinkMode: boolean;
}

export interface ManagementTargetResolution {
  installPaths: string[];
  relatedInstallPaths: string[];
}

export async function resolveInstallTargets(options: {
  cwd: string;
  flags: TargetFlags;
  interactive: boolean;
}): Promise<InstallTargetResolution> {
  if (options.flags.global && options.flags.ruler) {
    console.error("`--global` and `--ruler` cannot be used together.");
    process.exit(1);
  }

  if (options.flags.symlink && !options.flags.global) {
    console.error("`--symlink` requires `--global`.");
    process.exit(1);
  }

  if (options.flags.global) {
    return resolveGlobalInstallTargets(options.flags, options.interactive);
  }

  if (options.flags.ruler || isRulerProject(options.cwd)) {
    return { installPaths: [getRulerSkillsDir(options.cwd)], useSymlinkMode: false };
  }

  if (options.flags.agent && options.flags.agent.length > 0) {
    return {
      installPaths: [
        ...new Set(options.flags.agent.map((agent) => resolveAgentInstallPath(options.cwd, agent))),
      ],
      useSymlinkMode: false,
    };
  }

  const detectedAgents = detectAgents(options.cwd);

  if (detectedAgents.length > 0) {
    return { installPaths: getInstallPaths(options.cwd, detectedAgents), useSymlinkMode: false };
  }

  if (!options.interactive || options.flags.yes) {
    return { installPaths: [join(options.cwd, ".agents", "skills")], useSymlinkMode: false };
  }

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
    return { installPaths: [getRulerSkillsDir(options.cwd)], useSymlinkMode: false };
  }

  if (targetChoice === "claude") {
    return { installPaths: [join(options.cwd, ".claude", "skills")], useSymlinkMode: false };
  }

  return { installPaths: [join(options.cwd, ".agents", "skills")], useSymlinkMode: false };
}

export async function resolveManagementTargets(options: {
  cwd: string;
  flags: TargetFlags;
  interactive: boolean;
}): Promise<ManagementTargetResolution> {
  if (!options.flags.global) {
    const { installPaths } = await resolveInstallTargets(options);
    return { installPaths, relatedInstallPaths: installPaths };
  }

  if (options.flags.ruler) {
    console.error("`--global` and `--ruler` cannot be used together.");
    process.exit(1);
  }

  const detectedGlobalTargets = detectGlobalAgentTargets();
  if (detectedGlobalTargets.length === 0) {
    console.error(
      "No supported global agent directories found. Expected one of: ~/.agents, ~/.claude, ~/.cursor",
    );
    process.exit(1);
  }

  const relatedInstallPaths = detectedGlobalTargets.map((target) =>
    join(homedir(), target.installDir),
  );
  if (!options.flags.agent || options.flags.agent.length === 0) {
    return { installPaths: relatedInstallPaths, relatedInstallPaths };
  }

  const detectedTargetIds = new Set(detectedGlobalTargets.map((target) => target.id));
  const installPaths = new Set<string>();

  for (const agentName of options.flags.agent) {
    const target = resolveGlobalAgentTarget(agentName);
    if (!target) {
      console.error(`Unsupported global agent target: ${agentName}`);
      console.error(
        "Supported global agent targets: agents, codex, opencode, claude, cursor, pi, hermes, openclaw",
      );
      process.exit(1);
    }

    if (!detectedTargetIds.has(target.id)) {
      console.warn(`skip: ${target.id} (not detected at ~/${target.baseDir})`);
      continue;
    }

    installPaths.add(join(homedir(), target.installDir));
  }

  if (installPaths.size === 0) {
    console.error("None of the requested global agent targets are installed.");
    process.exit(1);
  }

  return { installPaths: [...installPaths], relatedInstallPaths };
}

async function resolveGlobalInstallTargets(
  flags: TargetFlags,
  interactive: boolean,
): Promise<InstallTargetResolution> {
  const detectedGlobalTargets = detectGlobalAgentTargets();
  const targetIds = new Set(detectedGlobalTargets.map((target) => target.id));

  if (detectedGlobalTargets.length === 0) {
    console.error(
      "No supported global agent directories found. Expected one of: ~/.agents, ~/.claude, ~/.cursor",
    );
    process.exit(1);
  }

  let selectedTargetIds = new Set(detectedGlobalTargets.map((target) => target.id));
  let useSymlinkMode = flags.symlink ?? false;

  if (flags.agent && flags.agent.length > 0) {
    selectedTargetIds = new Set();

    for (const agentName of flags.agent) {
      const target = resolveGlobalAgentTarget(agentName);
      if (!target) {
        console.error(`Unsupported global agent target: ${agentName}`);
        console.error(
          "Supported global agent targets: agents, codex, opencode, claude, cursor, pi, hermes, openclaw",
        );
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
          label: "Copy to detected targets",
          hint: "Copy into detected global agent directories",
        },
        {
          value: "symlink",
          label: "Prefer ~/.agents + symlink",
          hint: "Install in ~/.agents/skills and symlink into detected dedicated skill roots",
        },
      ],
    });

    if (p.isCancel(globalMode)) {
      p.cancel("Cancelled");
      process.exit(0);
    }

    useSymlinkMode = globalMode === "symlink";
  }

  const globalAgentsDir = join(homedir(), ".agents", "skills");
  const globalClaudeDir = join(homedir(), ".claude", "skills");
  const globalCursorDir = join(homedir(), ".cursor", "skills");

  if (useSymlinkMode) {
    if (!targetIds.has("agents")) {
      console.error(
        "`--global --symlink` requires ~/.agents to be installed as the source target.",
      );
      process.exit(1);
    }

    return { installPaths: [globalAgentsDir], useSymlinkMode };
  }

  const installPaths: string[] = [];

  if (selectedTargetIds.has("agents")) {
    installPaths.push(globalAgentsDir);
  }

  if (selectedTargetIds.has("claude")) {
    installPaths.push(globalClaudeDir);
  }

  if (selectedTargetIds.has("cursor")) {
    installPaths.push(globalCursorDir);
  }

  return { installPaths, useSymlinkMode };
}
