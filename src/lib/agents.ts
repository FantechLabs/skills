import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AgentInfo {
  id: string;
  name: string;
  configDir: string;
  installDir: string;
  supportsAgentsDir: boolean;
}

export interface GlobalAgentTarget {
  id: "agents" | "claude" | "cursor";
  baseDir: string;
  installDir: string;
  aliases: string[];
}

const KNOWN_AGENTS: AgentInfo[] = [
  {
    id: "claude",
    name: "Claude Code",
    configDir: ".claude",
    installDir: ".claude/skills",
    supportsAgentsDir: false,
  },
  {
    id: "cursor",
    name: "Cursor",
    configDir: ".cursor",
    installDir: ".cursor/skills",
    supportsAgentsDir: false,
  },
  {
    id: "codex",
    name: "Codex",
    configDir: ".codex",
    installDir: ".agents/skills",
    supportsAgentsDir: true,
  },
  {
    id: "opencode",
    name: "OpenCode",
    configDir: ".opencode",
    installDir: ".agents/skills",
    supportsAgentsDir: true,
  },
  {
    id: "pi",
    name: "Pi",
    configDir: ".pi",
    installDir: ".agents/skills",
    supportsAgentsDir: true,
  },
  {
    id: "hermes",
    name: "Hermes",
    configDir: ".hermes",
    installDir: ".agents/skills",
    supportsAgentsDir: true,
  },
  {
    id: "openclaw",
    name: "OpenClaw",
    configDir: "openclaw.json",
    installDir: ".agents/skills",
    supportsAgentsDir: true,
  },
];

const GLOBAL_AGENT_TARGETS: GlobalAgentTarget[] = [
  {
    id: "agents",
    baseDir: ".agents",
    installDir: ".agents/skills",
    aliases: [
      "agents",
      "codex",
      "opencode",
      "pi",
      "pi agent",
      "hermes",
      "hermes agent",
      "openclaw",
      "openclaw agent",
      "claw",
    ],
  },
  {
    id: "claude",
    baseDir: ".claude",
    installDir: ".claude/skills",
    aliases: ["claude", "claude code"],
  },
  {
    id: "cursor",
    baseDir: ".cursor",
    installDir: ".cursor/skills",
    aliases: ["cursor"],
  },
];

export function detectAgents(cwd: string): AgentInfo[] {
  return KNOWN_AGENTS.filter((agent) => existsSync(join(cwd, agent.configDir)));
}

export function getSharedAgentNames(cwd?: string): string[] {
  const compatibleAgents = KNOWN_AGENTS.filter((agent) => agent.supportsAgentsDir);
  if (!cwd) {
    return compatibleAgents.map((agent) => agent.name);
  }

  const detected = detectAgents(cwd).filter((agent) => agent.supportsAgentsDir);
  return (detected.length > 0 ? detected : compatibleAgents).map((agent) => agent.name);
}

export function getInstallPaths(cwd: string, agents: AgentInfo[]): string[] {
  const paths = new Set<string>();

  if (agents.some((agent) => agent.supportsAgentsDir)) {
    paths.add(join(cwd, ".agents", "skills"));
  }

  for (const agent of agents) {
    if (!agent.supportsAgentsDir) {
      paths.add(join(cwd, agent.installDir));
    }
  }

  return [...paths];
}

export function resolveAgentInstallPath(cwd: string, agentName: string): string {
  const normalized = agentName.trim().toLowerCase();

  const known = KNOWN_AGENTS.find(
    (agent) => agent.id === normalized || agent.name.toLowerCase() === normalized,
  );
  if (known) {
    return join(cwd, known.installDir);
  }

  if (normalized === "agents") {
    return join(cwd, ".agents", "skills");
  }

  return join(cwd, `.${normalized}`, "skills");
}

export function detectGlobalAgentTargets(homeDir: string = homedir()): GlobalAgentTarget[] {
  return GLOBAL_AGENT_TARGETS.filter((target) => existsSync(join(homeDir, target.baseDir)));
}

export function resolveGlobalAgentTarget(agentName: string): GlobalAgentTarget | null {
  const normalized = agentName.trim().toLowerCase();
  return GLOBAL_AGENT_TARGETS.find((target) => target.aliases.includes(normalized)) ?? null;
}

export function resolveGlobalAgentInstallPath(agentName: string): string {
  const normalized = agentName.trim().toLowerCase();
  const home = homedir();

  const target = resolveGlobalAgentTarget(agentName);
  if (target) {
    return join(home, target.installDir);
  }

  const known = KNOWN_AGENTS.find(
    (agent) => agent.id === normalized || agent.name.toLowerCase() === normalized,
  );
  if (known) {
    if (known.supportsAgentsDir) {
      return join(home, ".agents", "skills");
    }

    return join(home, known.installDir);
  }

  return join(home, `.${normalized}`, "skills");
}
