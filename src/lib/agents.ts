import { existsSync } from "node:fs";
import { join } from "node:path";

export interface AgentInfo {
  id: string;
  name: string;
  configDir: string;
  installDir: string;
  supportsAgentsDir: boolean;
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
];

export function detectAgents(cwd: string): AgentInfo[] {
  return KNOWN_AGENTS.filter((agent) => existsSync(join(cwd, agent.configDir)));
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
