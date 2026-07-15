import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runRemoveCommand, type RemoveCommandDependencies } from "../../src/commands/remove.js";
import type { InstallTargetResolution, TargetFlags } from "../../src/lib/install-targets.js";
import type { InstalledSkill } from "../../src/lib/installed-skills.js";
import { planSkillRemovals } from "../../src/lib/skill-removals.js";
import { cleanupTempProject, createTempProject } from "../utils/fs.js";

const tempProjects: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (tempProjects.length > 0) {
    cleanupTempProject(tempProjects.pop()!);
  }
});

function makeTempProject(): string {
  const temp = realpathSync(createTempProject());
  tempProjects.push(temp);
  return temp;
}

function installed(name: string, path: string, isSymlink = false): InstalledSkill {
  return {
    canonicalPath: isSymlink ? `/shared/${name}` : path,
    installRoot: join(path, ".."),
    isSymlink,
    name,
    path,
    version: "1.0.0",
  };
}

function writeSkill(skillDir: string, name: string): void {
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---\nname: ${name}\nversion: 1.0.0\ndescription: ${name}\n---\n`,
    "utf-8",
  );
}

function lstatExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function commandDependencies(options: {
  cwd: string;
  installPaths: string[];
  relatedInstallPaths?: string[];
  interactive?: boolean;
  confirm?: RemoveCommandDependencies["confirm"];
  selectPlans?: RemoveCommandDependencies["selectPlans"];
  resolveTargets?: RemoveCommandDependencies["resolveTargets"];
  applyRuler?: RemoveCommandDependencies["applyRuler"];
}): RemoveCommandDependencies {
  return {
    applyRuler: options.applyRuler ?? (async () => undefined),
    confirm: options.confirm ?? (async () => true),
    cwd: () => options.cwd,
    isInteractive: () => options.interactive ?? false,
    resolveTargets:
      options.resolveTargets ??
      (async (): Promise<InstallTargetResolution> => ({
        installPaths: options.installPaths,
        relatedInstallPaths: options.relatedInstallPaths ?? options.installPaths,
        useSymlinkMode: false,
      })),
    selectPlans: options.selectPlans ?? (async () => []),
  };
}

describe("planSkillRemovals", () => {
  it("groups installed locations by skill name in deterministic order", () => {
    const plans = planSkillRemovals(
      [
        installed("review", "/cursor/review"),
        installed("commit", "/claude/commit", true),
        installed("commit", "/agents/commit"),
      ],
      [],
    );

    expect(plans.map((plan) => plan.name)).toEqual(["commit", "review"]);
    expect(plans[0].locations.map((location) => location.path)).toEqual([
      "/agents/commit",
      "/claude/commit",
    ]);
  });

  it("limits plans to unique explicit names while preserving deterministic order", () => {
    const plans = planSkillRemovals(
      [installed("review", "/agents/review"), installed("commit", "/agents/commit")],
      ["review", "review", "commit"],
    );

    expect(plans.map((plan) => plan.name)).toEqual(["commit", "review"]);
  });

  it("rejects every explicitly requested uninstalled skill", () => {
    expect(() =>
      planSkillRemovals([installed("commit", "/agents/commit")], ["commit", "missing"]),
    ).toThrow("Skill is not installed: missing");
  });
});

describe("runRemoveCommand", () => {
  it("exits successfully when no skills are installed in the resolved targets", async () => {
    const cwd = makeTempProject();
    const installRoot = join(cwd, ".agents", "skills");
    const selectPlans = vi.fn<RemoveCommandDependencies["selectPlans"]>();
    const confirm = vi.fn<RemoveCommandDependencies["confirm"]>();

    const result = await runRemoveCommand(
      [],
      commandDependencies({
        cwd,
        installPaths: [installRoot],
        interactive: true,
        selectPlans,
        confirm,
      }),
    );

    expect(result).toBe(0);
    expect(selectPlans).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("offers grouped installed skills and removes only the picker selection", async () => {
    const cwd = makeTempProject();
    const agentsRoot = join(cwd, ".agents", "skills");
    const claudeRoot = join(cwd, ".claude", "skills");
    writeSkill(join(agentsRoot, "commit"), "commit");
    writeSkill(join(agentsRoot, "review"), "review");
    writeSkill(join(claudeRoot, "commit"), "commit");
    const selectedOptions: Array<{ hint?: string; label: string; value: string }> = [];

    const result = await runRemoveCommand(
      [],
      commandDependencies({
        cwd,
        installPaths: [claudeRoot, agentsRoot],
        interactive: true,
        selectPlans: async (options) => {
          selectedOptions.push(...options);
          return ["review"];
        },
      }),
    );

    expect(result).toBe(0);
    expect(selectedOptions.map((option) => option.value)).toEqual(["commit", "review"]);
    expect(selectedOptions[0].hint).toContain(join(agentsRoot, "commit"));
    expect(selectedOptions[0].hint).toContain(join(claudeRoot, "commit"));
    expect(existsSync(join(agentsRoot, "review"))).toBe(false);
    expect(existsSync(join(agentsRoot, "commit"))).toBe(true);
    expect(existsSync(join(claudeRoot, "commit"))).toBe(true);
  });

  it("treats an empty picker selection as cancellation, never remove-all authorization", async () => {
    const cwd = makeTempProject();
    const installRoot = join(cwd, ".agents", "skills");
    const installedSkill = join(installRoot, "commit");
    writeSkill(installedSkill, "commit");
    const confirm = vi.fn<RemoveCommandDependencies["confirm"]>();

    const result = await runRemoveCommand(
      [],
      commandDependencies({
        cwd,
        installPaths: [installRoot],
        interactive: true,
        selectPlans: async () => [],
        confirm,
      }),
    );

    expect(result).toBe(0);
    expect(confirm).not.toHaveBeenCalled();
    expect(existsSync(installedSkill)).toBe(true);
  });

  it("cancels before mutation when confirmation is declined", async () => {
    const cwd = makeTempProject();
    const installRoot = join(cwd, ".agents", "skills");
    const installedSkill = join(installRoot, "commit");
    writeSkill(installedSkill, "commit");
    const messages: string[] = [];
    const applyRuler = vi.fn<RemoveCommandDependencies["applyRuler"]>();

    const result = await runRemoveCommand(
      ["commit"],
      commandDependencies({
        cwd,
        installPaths: [installRoot],
        interactive: true,
        confirm: async (message) => {
          messages.push(message);
          return false;
        },
        applyRuler,
      }),
    );

    expect(result).toBe(0);
    expect(messages).toEqual(["Remove 1 skill(s)?"]);
    expect(applyRuler).not.toHaveBeenCalled();
    expect(existsSync(installedSkill)).toBe(true);
  });

  it("rejects non-interactive removal unless explicit names and --yes are both present", async () => {
    const cwd = makeTempProject();
    const installRoot = join(cwd, ".agents", "skills");
    const installedSkill = join(installRoot, "commit");
    writeSkill(installedSkill, "commit");

    await expect(
      runRemoveCommand(["commit"], commandDependencies({ cwd, installPaths: [installRoot] })),
    ).rejects.toThrow(/non-interactive removals require explicit skill names and --yes/i);
    await expect(
      runRemoveCommand([], commandDependencies({ cwd, installPaths: [installRoot] })),
    ).rejects.toThrow(/non-interactive removals require explicit skill names and --yes/i);
    expect(existsSync(installedSkill)).toBe(true);
  });

  it("removes explicit names with --yes without confirmation", async () => {
    const cwd = makeTempProject();
    const installRoot = join(cwd, ".agents", "skills");
    const installedSkill = join(installRoot, "commit");
    writeSkill(installedSkill, "commit");
    const confirm = vi.fn<RemoveCommandDependencies["confirm"]>();

    const result = await runRemoveCommand(
      ["commit", "--yes"],
      commandDependencies({ cwd, installPaths: [installRoot], confirm }),
    );

    expect(result).toBe(0);
    expect(confirm).not.toHaveBeenCalled();
    expect(existsSync(installedSkill)).toBe(false);
    expect(existsSync(installRoot)).toBe(true);
  });

  it("refuses remove --yes without explicit names before target resolution", async () => {
    const cwd = makeTempProject();
    const installRoot = join(cwd, ".agents", "skills");
    const installedSkill = join(installRoot, "commit");
    writeSkill(installedSkill, "commit");
    const resolveTargets =
      vi.fn<
        (options: {
          cwd: string;
          flags: TargetFlags;
          interactive: boolean;
        }) => Promise<InstallTargetResolution>
      >();

    await expect(
      runRemoveCommand(
        ["--yes"],
        commandDependencies({ cwd, installPaths: [installRoot], resolveTargets }),
      ),
    ).rejects.toThrow(/requires explicit skill names/i);
    expect(resolveTargets).not.toHaveBeenCalled();
    expect(existsSync(installedSkill)).toBe(true);
  });

  it("removes a selected symlink without following its canonical source", async () => {
    const cwd = makeTempProject();
    const claudeRoot = join(cwd, ".claude", "skills");
    const sharedSource = join(cwd, "shared", "commit");
    const claudeLink = join(claudeRoot, "commit");
    writeSkill(sharedSource, "commit");
    mkdirSync(claudeRoot, { recursive: true });
    symlinkSync(sharedSource, claudeLink);
    let resolvedFlags: TargetFlags | undefined;

    const result = await runRemoveCommand(
      ["commit", "--yes", "--global", "--agent", "claude"],
      commandDependencies({
        cwd,
        installPaths: [claudeRoot],
        resolveTargets: async ({ flags }) => {
          resolvedFlags = flags;
          return { installPaths: [claudeRoot], useSymlinkMode: false };
        },
      }),
    );

    expect(result).toBe(0);
    expect(resolvedFlags).toMatchObject({ agent: ["claude"], global: true, yes: true });
    expect(existsSync(claudeLink)).toBe(false);
    expect(existsSync(join(sharedSource, "SKILL.md"))).toBe(true);
  });

  it("removes detected global links when their narrowly selected shared source is removed", async () => {
    const cwd = makeTempProject();
    const agentsRoot = join(cwd, ".agents", "skills");
    const claudeRoot = join(cwd, ".claude", "skills");
    const cursorRoot = join(cwd, ".cursor", "skills");
    const source = join(agentsRoot, "commit");
    const claudeLink = join(claudeRoot, "commit");
    const cursorLink = join(cursorRoot, "commit");
    writeSkill(source, "commit");
    mkdirSync(claudeRoot, { recursive: true });
    mkdirSync(cursorRoot, { recursive: true });
    symlinkSync(source, claudeLink);
    symlinkSync(source, cursorLink);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message = "") => logs.push(String(message)));

    await runRemoveCommand(
      ["commit", "--yes", "--global", "--agent", "agents"],
      commandDependencies({
        cwd,
        installPaths: [agentsRoot],
        relatedInstallPaths: [agentsRoot, claudeRoot, cursorRoot],
      }),
    );

    expect(logs.join("\n")).toContain(`${source} (shared source)`);
    expect(logs.join("\n")).toContain(`${claudeLink} (affected symlink)`);
    expect(logs.join("\n")).toContain(`${cursorLink} (affected symlink)`);
    expect(lstatExists(source)).toBe(false);
    expect(lstatExists(claudeLink)).toBe(false);
    expect(lstatExists(cursorLink)).toBe(false);
  });

  it("shows remove help without resolving targets", async () => {
    const cwd = makeTempProject();
    const resolveTargets = vi.fn<RemoveCommandDependencies["resolveTargets"]>();
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message = "") => logs.push(String(message)));

    const result = await runRemoveCommand(["--help"], {
      ...commandDependencies({ cwd, installPaths: [] }),
      resolveTargets,
    });

    expect(result).toBe(0);
    expect(resolveTargets).not.toHaveBeenCalled();
    expect(logs.join("\n")).toMatch(/requires explicit skill names/i);
    expect(logs.join("\n")).toMatch(/shared source/i);
  });

  it("prints every logical location and marks symlinks", async () => {
    const cwd = makeTempProject();
    const agentsRoot = join(cwd, ".agents", "skills");
    const claudeRoot = join(cwd, ".claude", "skills");
    const sharedSource = join(cwd, "shared", "commit");
    const claudeLink = join(claudeRoot, "commit");
    writeSkill(join(agentsRoot, "commit"), "commit");
    writeSkill(sharedSource, "commit");
    mkdirSync(claudeRoot, { recursive: true });
    symlinkSync(sharedSource, claudeLink);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message = "") => logs.push(String(message)));

    await runRemoveCommand(
      ["commit"],
      commandDependencies({
        cwd,
        installPaths: [agentsRoot, claudeRoot],
        interactive: true,
        confirm: async () => false,
      }),
    );

    expect(logs.join("\n")).toContain(join(agentsRoot, "commit"));
    expect(logs.join("\n")).toContain(`${claudeLink} (symlink)`);
    expect(logs.join("\n")).not.toContain(sharedSource);
  });

  it("applies Ruler only after successful removal", async () => {
    const cwd = makeTempProject();
    const installRoot = join(cwd, ".ruler", "skills");
    const installedSkill = join(installRoot, "commit");
    writeSkill(installedSkill, "commit");
    const applyRuler = vi.fn<RemoveCommandDependencies["applyRuler"]>(async () => {
      expect(existsSync(installedSkill)).toBe(false);
    });

    await runRemoveCommand(
      ["commit", "--yes", "--ruler"],
      commandDependencies({ cwd, installPaths: [installRoot], applyRuler }),
    );

    expect(existsSync(installedSkill)).toBe(false);
    expect(applyRuler).toHaveBeenCalledWith({
      installPaths: [installRoot],
      interactive: false,
      yes: true,
    });
  });

  it("rejects explicit uninstalled names without changing installed skills", async () => {
    const cwd = makeTempProject();
    const installRoot = join(cwd, ".agents", "skills");
    const installedSkill = join(installRoot, "commit");
    writeSkill(installedSkill, "commit");

    await expect(
      runRemoveCommand(
        ["missing", "--yes"],
        commandDependencies({ cwd, installPaths: [installRoot] }),
      ),
    ).rejects.toThrow("Skill is not installed: missing");
    expect(existsSync(installedSkill)).toBe(true);
  });

  it("leaves install roots and unrelated skills intact", async () => {
    const cwd = makeTempProject();
    const installRoot = join(cwd, ".agents", "skills");
    const commitPath = join(installRoot, "commit");
    const reviewPath = join(installRoot, "review");
    writeSkill(commitPath, "commit");
    writeSkill(reviewPath, "review");

    await runRemoveCommand(
      ["commit", "--yes"],
      commandDependencies({ cwd, installPaths: [installRoot] }),
    );

    expect(existsSync(commitPath)).toBe(false);
    expect(existsSync(reviewPath)).toBe(true);
    expect(lstatSync(installRoot).isDirectory()).toBe(true);
  });
});
