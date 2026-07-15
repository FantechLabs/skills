import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runUpdateCommand, type UpdateCommandDependencies } from "../../src/commands/update.js";
import type { InstalledSkill } from "../../src/lib/installed-skills.js";
import type { LatestSkillPackage } from "../../src/lib/npm-skills.js";
import { formatVersionTransition, planSkillUpdates } from "../../src/lib/skill-updates.js";
import type { SkillInfo } from "../../src/lib/skills.js";
import { cleanupTempProject, createTempProject } from "../utils/fs.js";

const tempProjects: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  while (tempProjects.length > 0) {
    cleanupTempProject(tempProjects.pop()!);
  }
});

function makeTempProject(): string {
  const temp = realpathSync(createTempProject());
  tempProjects.push(temp);
  return temp;
}

function installed(
  name: string,
  version: string | undefined,
  canonicalPath: string,
  path: string,
  isSymlink = false,
): InstalledSkill {
  return {
    canonicalPath,
    installRoot: join(path, ".."),
    isSymlink,
    name,
    path,
    version,
  };
}

function latest(name: string, version: string, path = `/latest/${name}`): SkillInfo {
  return {
    description: `${name} description`,
    hasScripts: false,
    name,
    path,
    version,
  };
}

function writeSkill(
  skillDir: string,
  name: string,
  version: string | undefined,
  body = "old\n",
): void {
  mkdirSync(skillDir, { recursive: true });
  const versionLine = version ? `\nversion: ${version}` : "";
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---\nname: ${name}${versionLine}\ndescription: ${name}\n---\n${body}`,
    "utf-8",
  );
}

function createLatestPackage(
  skills: Array<{ name: string; version: string; withPackage?: boolean }>,
): { cleanup: ReturnType<typeof vi.fn>; latestPackage: LatestSkillPackage; root: string } {
  const root = makeTempProject();
  const cleanup = vi.fn();
  const infos = skills.map(({ name, version, withPackage }) => {
    const skillDir = join(root, name);
    writeSkill(skillDir, name, version, "new\n");
    if (withPackage) {
      const scriptsDir = join(skillDir, "scripts");
      mkdirSync(scriptsDir, { recursive: true });
      writeFileSync(join(scriptsDir, "package.json"), '{"name":"fixture"}\n', "utf-8");
    }
    return latest(name, version, skillDir);
  });

  return {
    cleanup,
    latestPackage: {
      cleanup,
      packageRoot: root,
      packageVersion: "9.9.9",
      skills: infos,
    },
    root,
  };
}

function commandDependencies(options: {
  cwd: string;
  installPaths: string[];
  relatedInstallPaths?: string[];
  interactive?: boolean;
  latestPackage: LatestSkillPackage;
  selectPlans?: UpdateCommandDependencies["selectPlans"];
  confirm?: UpdateCommandDependencies["confirm"];
}): UpdateCommandDependencies {
  return {
    cwd: () => options.cwd,
    isInteractive: () => options.interactive ?? false,
    loadLatestPackage: async () => options.latestPackage,
    resolveTargets: async () => ({
      installPaths: options.installPaths,
      relatedInstallPaths: options.relatedInstallPaths ?? options.installPaths,
      useSymlinkMode: false,
    }),
    selectPlans: options.selectPlans ?? (async () => []),
    confirm: options.confirm ?? (async () => true),
  };
}

describe("planSkillUpdates", () => {
  it("plans legacy and lower versions but not equal or higher versions", () => {
    const plans = planSkillUpdates(
      [
        installed("legacy", undefined, "/legacy", "/agents/legacy"),
        installed("lower", "1.2.0", "/lower", "/agents/lower"),
        installed("current", "2.0.0", "/current", "/agents/current"),
        installed("higher", "3.0.0", "/higher", "/agents/higher"),
      ],
      [
        latest("legacy", "2.0.0"),
        latest("lower", "2.0.0"),
        latest("current", "2.0.0"),
        latest("higher", "2.0.0"),
      ],
      [],
    );

    expect(plans.map((plan) => plan.name)).toEqual(["legacy", "lower"]);
    expect(formatVersionTransition(plans[0])).toBe("legacy -> 2.0.0");
    expect(formatVersionTransition(plans[1])).toBe("1.2.0 -> 2.0.0");
  });

  it("plans only older locations and deduplicates a shared canonical source", () => {
    const plans = planSkillUpdates(
      [
        installed("commit", undefined, "/shared/commit", "/agents/commit"),
        installed("commit", "1.0.0", "/shared/commit", "/claude/commit", true),
        installed("commit", "2.0.0", "/current/commit", "/cursor/commit"),
      ],
      [latest("commit", "2.0.0")],
      [],
    );

    expect(plans).toHaveLength(1);
    expect(plans[0].locations.map((location) => location.path)).toEqual([
      "/agents/commit",
      "/claude/commit",
    ]);
    expect(plans[0].updatePaths).toEqual(["/shared/commit"]);
    expect(formatVersionTransition(plans[0])).toContain("legacy, 1.0.0, 2.0.0 -> 2.0.0");
  });

  it("summarizes every resolved installed version while updating only outdated locations", () => {
    const plans = planSkillUpdates(
      [
        installed("commit", undefined, "/legacy", "/agents/commit"),
        installed("commit", "1.0.0", "/older", "/claude/commit"),
        installed("commit", "2.0.0", "/current", "/cursor/commit"),
        installed("commit", "3.0.0", "/ahead", "/other/commit"),
      ],
      [latest("commit", "2.0.0")],
      [],
    );

    expect(plans[0].installedVersions).toEqual(["legacy", "1.0.0", "2.0.0", "3.0.0"]);
    expect(plans[0].updatePaths).toEqual(["/legacy", "/older"]);
  });

  it("limits plans to explicit requested names", () => {
    const plans = planSkillUpdates(
      [
        installed("commit", "1.0.0", "/commit", "/agents/commit"),
        installed("review", "1.0.0", "/review", "/agents/review"),
      ],
      [latest("commit", "2.0.0"), latest("review", "2.0.0")],
      ["review"],
    );

    expect(plans.map((plan) => plan.name)).toEqual(["review"]);
  });

  it("returns no update for explicitly requested current or higher skills", () => {
    expect(
      planSkillUpdates(
        [
          installed("current", "2.0.0", "/current", "/agents/current"),
          installed("higher", "3.0.0", "/higher", "/agents/higher"),
        ],
        [latest("current", "2.0.0"), latest("higher", "2.0.0")],
        ["current", "higher"],
      ),
    ).toEqual([]);
  });

  it("rejects explicitly requested unknown skills", () => {
    expect(() => planSkillUpdates([], [], ["missing"])).toThrow("Unknown skill: missing");
  });

  it("rejects explicitly requested uninstalled skills", () => {
    expect(() => planSkillUpdates([], [latest("commit", "2.0.0")], ["commit"])).toThrow(
      "Skill is not installed: commit",
    );
  });

  it("rejects explicitly requested skills missing from the latest package", () => {
    expect(() =>
      planSkillUpdates([installed("commit", "1.0.0", "/commit", "/agents/commit")], [], ["commit"]),
    ).toThrow("Skill is missing from the latest package: commit");
  });

  it("skips unrequested installed skills missing from the latest package", () => {
    expect(
      planSkillUpdates([installed("private", "1.0.0", "/private", "/agents/private")], [], []),
    ).toEqual([]);
  });
});

describe("runUpdateCommand", () => {
  it("updates every outdated installed skill with --yes", async () => {
    const cwd = makeTempProject();
    const installRoot = join(cwd, ".agents", "skills");
    writeSkill(join(installRoot, "commit"), "commit", "1.0.0");
    writeSkill(join(installRoot, "review"), "review", "1.0.0");
    const fixture = createLatestPackage([
      { name: "commit", version: "2.0.0" },
      { name: "review", version: "2.0.0" },
    ]);

    await runUpdateCommand(
      ["--yes", "--skip-deps"],
      commandDependencies({
        cwd,
        installPaths: [installRoot],
        latestPackage: fixture.latestPackage,
      }),
    );

    expect(readFileSync(join(installRoot, "commit", "SKILL.md"), "utf-8")).toContain(
      "version: 2.0.0",
    );
    expect(readFileSync(join(installRoot, "review", "SKILL.md"), "utf-8")).toContain(
      "version: 2.0.0",
    );
    expect(fixture.cleanup).toHaveBeenCalledOnce();
  });

  it("updates only explicit names", async () => {
    const cwd = makeTempProject();
    const installRoot = join(cwd, ".agents", "skills");
    writeSkill(join(installRoot, "commit"), "commit", "1.0.0");
    writeSkill(join(installRoot, "review"), "review", "1.0.0");
    const fixture = createLatestPackage([
      { name: "commit", version: "2.0.0" },
      { name: "review", version: "2.0.0" },
    ]);

    await runUpdateCommand(
      ["review", "--yes", "--skip-deps"],
      commandDependencies({
        cwd,
        installPaths: [installRoot],
        latestPackage: fixture.latestPackage,
      }),
    );

    expect(readFileSync(join(installRoot, "commit", "SKILL.md"), "utf-8")).toContain(
      "version: 1.0.0",
    );
    expect(readFileSync(join(installRoot, "review", "SKILL.md"), "utf-8")).toContain(
      "version: 2.0.0",
    );
  });

  it("rejects non-interactive updates without --yes before mutation", async () => {
    const cwd = makeTempProject();
    const installRoot = join(cwd, ".agents", "skills");
    const installedPath = join(installRoot, "commit");
    writeSkill(installedPath, "commit", "1.0.0");
    const fixture = createLatestPackage([{ name: "commit", version: "2.0.0" }]);

    await expect(
      runUpdateCommand(
        ["--skip-deps"],
        commandDependencies({
          cwd,
          installPaths: [installRoot],
          latestPackage: fixture.latestPackage,
        }),
      ),
    ).rejects.toThrow("Non-interactive updates require --yes");
    expect(readFileSync(join(installedPath, "SKILL.md"), "utf-8")).toContain("version: 1.0.0");
    expect(fixture.cleanup).toHaveBeenCalledOnce();
  });

  it("exits successfully without prompting when all installed skills are current", async () => {
    const cwd = makeTempProject();
    const installRoot = join(cwd, ".agents", "skills");
    writeSkill(join(installRoot, "commit"), "commit", "2.0.0");
    const fixture = createLatestPackage([{ name: "commit", version: "2.0.0" }]);
    const selectPlans = vi.fn<UpdateCommandDependencies["selectPlans"]>();
    const confirm = vi.fn<UpdateCommandDependencies["confirm"]>();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runUpdateCommand(
      [],
      commandDependencies({
        cwd,
        installPaths: [installRoot],
        interactive: true,
        latestPackage: fixture.latestPackage,
        selectPlans,
        confirm,
      }),
    );

    expect(selectPlans).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("All selected installed skills are current.");
    expect(fixture.cleanup).toHaveBeenCalledOnce();
  });

  it("reports unnamed installed skills absent from latest npm as not updateable", async () => {
    const cwd = makeTempProject();
    const installRoot = join(cwd, ".agents", "skills");
    writeSkill(join(installRoot, "private-skill"), "private-skill", "1.0.0");
    const fixture = createLatestPackage([{ name: "commit", version: "2.0.0" }]);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message = "") => logs.push(String(message)));

    await runUpdateCommand(
      ["--yes", "--skip-deps"],
      commandDependencies({
        cwd,
        installPaths: [installRoot],
        latestPackage: fixture.latestPackage,
      }),
    );

    expect(logs.join("\n")).toMatch(/not updateable/i);
    expect(logs.join("\n")).toContain("private-skill");
    expect(logs.join("\n")).not.toContain("All selected installed skills are current.");
  });

  it("installs dependencies by default for an updated runnable skill", async () => {
    const cwd = makeTempProject();
    const installRoot = join(cwd, ".agents", "skills");
    const logFile = join(cwd, "pm.log");
    const binDir = join(cwd, "bin");
    mkdirSync(binDir);
    const npmPath = join(binDir, "npm");
    writeFileSync(
      npmPath,
      '#!/usr/bin/env node\nrequire("node:fs").appendFileSync(process.env.SKILLS_PM_LOG, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }) + "\\n");\n',
      "utf-8",
    );
    chmodSync(npmPath, 0o755);
    writeFileSync(join(cwd, "package-lock.json"), "{}\n", "utf-8");
    vi.stubEnv("PATH", `${binDir}:${process.env.PATH ?? ""}`);
    vi.stubEnv("SKILLS_PM_LOG", logFile);
    writeSkill(join(installRoot, "commit"), "commit", "1.0.0");
    const fixture = createLatestPackage([{ name: "commit", version: "2.0.0", withPackage: true }]);

    await runUpdateCommand(
      ["--yes"],
      commandDependencies({
        cwd,
        installPaths: [installRoot],
        latestPackage: fixture.latestPackage,
      }),
    );

    const installs = readFileSync(logFile, "utf-8").trim().split("\n").map(JSON.parse);
    expect(installs).toEqual([
      {
        args: ["install"],
        cwd: join(installRoot, "commit", "scripts"),
      },
    ]);
  });

  it("skips dependency installation with --skip-deps", async () => {
    const cwd = makeTempProject();
    const installRoot = join(cwd, ".agents", "skills");
    const logFile = join(cwd, "pm.log");
    const binDir = join(cwd, "bin");
    mkdirSync(binDir);
    const npmPath = join(binDir, "npm");
    writeFileSync(
      npmPath,
      '#!/usr/bin/env node\nrequire("node:fs").appendFileSync(process.env.SKILLS_PM_LOG, process.cwd() + "\\n");\n',
      "utf-8",
    );
    chmodSync(npmPath, 0o755);
    vi.stubEnv("PATH", `${binDir}:${process.env.PATH ?? ""}`);
    vi.stubEnv("SKILLS_PM_LOG", logFile);
    writeSkill(join(installRoot, "commit"), "commit", "1.0.0");
    const fixture = createLatestPackage([{ name: "commit", version: "2.0.0", withPackage: true }]);

    await runUpdateCommand(
      ["--yes", "--skip-deps"],
      commandDependencies({
        cwd,
        installPaths: [installRoot],
        latestPackage: fixture.latestPackage,
      }),
    );

    expect(existsSync(logFile)).toBe(false);
  });

  it("preserves logical symlinks and updates their canonical source once", async () => {
    const cwd = makeTempProject();
    const agentsRoot = join(cwd, ".agents", "skills");
    const claudeRoot = join(cwd, ".claude", "skills");
    const source = join(cwd, "shared", "commit");
    writeSkill(source, "commit", "1.0.0");
    mkdirSync(agentsRoot, { recursive: true });
    mkdirSync(claudeRoot, { recursive: true });
    symlinkSync(source, join(agentsRoot, "commit"));
    symlinkSync(source, join(claudeRoot, "commit"));
    const fixture = createLatestPackage([{ name: "commit", version: "2.0.0" }]);

    await runUpdateCommand(
      ["--yes", "--skip-deps"],
      commandDependencies({
        cwd,
        installPaths: [agentsRoot, claudeRoot],
        latestPackage: fixture.latestPackage,
      }),
    );

    expect(lstatSync(join(agentsRoot, "commit")).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(claudeRoot, "commit")).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(source, "SKILL.md"), "utf-8")).toContain("version: 2.0.0");
  });

  it("shows detected global links affected by updating a narrowly selected shared source", async () => {
    const cwd = makeTempProject();
    const agentsRoot = join(cwd, ".agents", "skills");
    const claudeRoot = join(cwd, ".claude", "skills");
    const cursorRoot = join(cwd, ".cursor", "skills");
    const source = join(agentsRoot, "commit");
    const claudeLink = join(claudeRoot, "commit");
    const cursorLink = join(cursorRoot, "commit");
    writeSkill(source, "commit", "1.0.0");
    mkdirSync(claudeRoot, { recursive: true });
    mkdirSync(cursorRoot, { recursive: true });
    symlinkSync(source, claudeLink);
    symlinkSync(source, cursorLink);
    const fixture = createLatestPackage([{ name: "commit", version: "2.0.0" }]);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message = "") => logs.push(String(message)));

    await runUpdateCommand(
      ["commit", "--global"],
      commandDependencies({
        cwd,
        installPaths: [agentsRoot],
        relatedInstallPaths: [agentsRoot, claudeRoot, cursorRoot],
        interactive: true,
        latestPackage: fixture.latestPackage,
        confirm: async () => false,
      }),
    );

    expect(logs.join("\n")).toContain(`${claudeLink} (affected symlink)`);
    expect(logs.join("\n")).toContain(`${cursorLink} (affected symlink)`);
    expect(readFileSync(join(source, "SKILL.md"), "utf-8")).toContain("version: 1.0.0");
  });

  it("shows update help without resolving targets or loading npm", async () => {
    const cwd = makeTempProject();
    const resolveTargets = vi.fn<UpdateCommandDependencies["resolveTargets"]>();
    const loadLatestPackage = vi.fn<UpdateCommandDependencies["loadLatestPackage"]>();
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message = "") => logs.push(String(message)));

    await runUpdateCommand(["--help"], {
      ...commandDependencies({
        cwd,
        installPaths: [],
        latestPackage: createLatestPackage([]).latestPackage,
      }),
      resolveTargets,
      loadLatestPackage,
    });

    expect(resolveTargets).not.toHaveBeenCalled();
    expect(loadLatestPackage).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("--skip-deps");
    expect(logs.join("\n")).toMatch(/npm.*latest/i);
  });

  it("cleans up the latest package after selection cancellation", async () => {
    const cwd = makeTempProject();
    const installRoot = join(cwd, ".agents", "skills");
    writeSkill(join(installRoot, "commit"), "commit", "1.0.0");
    const fixture = createLatestPackage([{ name: "commit", version: "2.0.0" }]);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await runUpdateCommand(
      [],
      commandDependencies({
        cwd,
        installPaths: [installRoot],
        interactive: true,
        latestPackage: fixture.latestPackage,
        selectPlans: async () => null,
      }),
    );

    expect(log).toHaveBeenCalledWith("Cancelled");
    expect(readFileSync(join(installRoot, "commit", "SKILL.md"), "utf-8")).toContain(
      "version: 1.0.0",
    );
    expect(fixture.cleanup).toHaveBeenCalledOnce();
  });

  it("cleans up the latest package after confirmation cancellation", async () => {
    const cwd = makeTempProject();
    const installRoot = join(cwd, ".agents", "skills");
    writeSkill(join(installRoot, "commit"), "commit", "1.0.0");
    const fixture = createLatestPackage([{ name: "commit", version: "2.0.0" }]);

    await runUpdateCommand(
      ["commit"],
      commandDependencies({
        cwd,
        installPaths: [installRoot],
        interactive: true,
        latestPackage: fixture.latestPackage,
        confirm: async () => false,
      }),
    );

    expect(readFileSync(join(installRoot, "commit", "SKILL.md"), "utf-8")).toContain(
      "version: 1.0.0",
    );
    expect(fixture.cleanup).toHaveBeenCalledOnce();
  });

  it("cleans up the latest package after an apply failure", async () => {
    const cwd = makeTempProject();
    const installRoot = join(cwd, ".agents", "skills");
    writeSkill(join(installRoot, "commit"), "commit", "1.0.0");
    const fixture = createLatestPackage([{ name: "commit", version: "2.0.0" }]);
    fixture.latestPackage.skills[0].path = join(cwd, "missing-latest-skill");

    await expect(
      runUpdateCommand(
        ["--yes", "--skip-deps"],
        commandDependencies({
          cwd,
          installPaths: [installRoot],
          latestPackage: fixture.latestPackage,
        }),
      ),
    ).rejects.toThrow();
    expect(fixture.cleanup).toHaveBeenCalledOnce();
  });

  it("offers only outdated plans and confirms with transitions and logical locations", async () => {
    const cwd = makeTempProject();
    const agentsRoot = join(cwd, ".agents", "skills");
    const claudeRoot = join(cwd, ".claude", "skills");
    const shared = join(cwd, "shared", "commit");
    writeSkill(shared, "commit", "1.0.0");
    writeSkill(join(agentsRoot, "review"), "review", "2.0.0");
    mkdirSync(claudeRoot, { recursive: true });
    symlinkSync(shared, join(claudeRoot, "commit"));
    const fixture = createLatestPackage([
      { name: "commit", version: "2.0.0" },
      { name: "review", version: "2.0.0" },
    ]);
    const selectedOptions: Array<{ value: string; label: string; hint?: string }> = [];
    const messages: string[] = [];
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message = "") => logs.push(String(message)));

    await runUpdateCommand(
      [],
      commandDependencies({
        cwd,
        installPaths: [agentsRoot, claudeRoot],
        interactive: true,
        latestPackage: fixture.latestPackage,
        selectPlans: async (options) => {
          selectedOptions.push(...options);
          return ["commit"];
        },
        confirm: async (message) => {
          messages.push(message);
          return false;
        },
      }),
    );

    expect(selectedOptions).toEqual([
      expect.objectContaining({
        value: "commit",
        label: expect.stringContaining("1.0.0 -> 2.0.0"),
      }),
    ]);
    expect(messages).toEqual(["Update 1 skill(s)?"]);
    expect(logs.join("\n")).toContain(join(claudeRoot, "commit"));
    expect(logs.join("\n")).toContain(`shared source: ${shared}`);
  });
});
