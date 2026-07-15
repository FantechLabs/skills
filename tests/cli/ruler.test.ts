import type { spawnSync } from "node:child_process";

import * as p from "@clack/prompts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { applyRulerAfterChanges } from "../../src/lib/ruler";

vi.mock("@clack/prompts", () => ({
  cancel: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("applyRulerAfterChanges", () => {
  it("uses a shell for automatic ruler apply on Windows", async () => {
    vi.mocked(p.confirm).mockResolvedValue(true);
    const spawnSyncImpl = vi.fn(() => ({ error: undefined, status: 0 }));

    await applyRulerAfterChanges(
      {
        installPaths: ["C:\\project\\.ruler\\skills"],
        interactive: true,
        yes: false,
      },
      {
        platform: "win32",
        spawnSync: spawnSyncImpl as unknown as typeof spawnSync,
      },
    );

    expect(spawnSyncImpl).toHaveBeenCalledWith("ruler", ["apply"], {
      shell: true,
      stdio: "inherit",
    });
  });

  it("does not use a shell for automatic ruler apply on non-Windows platforms", async () => {
    vi.mocked(p.confirm).mockResolvedValue(true);
    const spawnSyncImpl = vi.fn(() => ({ error: undefined, status: 0 }));

    await applyRulerAfterChanges(
      {
        installPaths: ["/project/.ruler/skills"],
        interactive: true,
        yes: false,
      },
      {
        platform: "linux",
        spawnSync: spawnSyncImpl as unknown as typeof spawnSync,
      },
    );

    expect(spawnSyncImpl).toHaveBeenCalledWith("ruler", ["apply"], {
      shell: false,
      stdio: "inherit",
    });
  });

  it("warns when automatic ruler apply is terminated by a signal", async () => {
    vi.mocked(p.confirm).mockResolvedValue(true);
    const spawnSyncImpl = vi.fn(() => ({ error: undefined, signal: "SIGTERM", status: null }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await applyRulerAfterChanges(
      {
        installPaths: ["/project/.ruler/skills"],
        interactive: true,
        yes: false,
      },
      {
        platform: "linux",
        spawnSync: spawnSyncImpl as unknown as typeof spawnSync,
      },
    );

    expect(warn).toHaveBeenCalledWith("`ruler apply` was terminated by signal SIGTERM.");
  });

  it("warns and skips automatic apply when the ruler command is missing", async () => {
    vi.mocked(p.confirm).mockResolvedValue(true);
    const error = Object.assign(new Error("spawn ruler ENOENT"), { code: "ENOENT" });
    const spawnSyncImpl = vi.fn(() => ({ error, status: null }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await applyRulerAfterChanges(
      {
        installPaths: ["/project/.ruler/skills"],
        interactive: true,
        yes: false,
      },
      {
        platform: "linux",
        spawnSync: spawnSyncImpl as unknown as typeof spawnSync,
      },
    );

    expect(warn).toHaveBeenCalledWith("`ruler` command not found. Skipping automatic apply.");
  });

  it("warns with the spawn error when automatic ruler apply cannot start", async () => {
    vi.mocked(p.confirm).mockResolvedValue(true);
    const error = new Error("permission denied");
    const spawnSyncImpl = vi.fn(() => ({ error, status: null }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await applyRulerAfterChanges(
      {
        installPaths: ["/project/.ruler/skills"],
        interactive: true,
        yes: false,
      },
      {
        platform: "linux",
        spawnSync: spawnSyncImpl as unknown as typeof spawnSync,
      },
    );

    expect(warn).toHaveBeenCalledWith("Failed to run `ruler apply`: permission denied");
  });

  it("warns when automatic ruler apply exits with a nonzero status", async () => {
    vi.mocked(p.confirm).mockResolvedValue(true);
    const spawnSyncImpl = vi.fn(() => ({ error: undefined, status: 7 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await applyRulerAfterChanges(
      {
        installPaths: ["/project/.ruler/skills"],
        interactive: true,
        yes: false,
      },
      {
        platform: "linux",
        spawnSync: spawnSyncImpl as unknown as typeof spawnSync,
      },
    );

    expect(warn).toHaveBeenCalledWith("`ruler apply` exited with code 7.");
  });

  it.each([
    ["non-interactive", false, false],
    ["--yes", true, true],
  ])("uses reminder-only behavior for %s changes", async (_caseName, interactive, yes) => {
    const spawnSyncImpl = vi.fn();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await applyRulerAfterChanges(
      {
        installPaths: ["/project/.ruler/skills"],
        interactive,
        yes,
      },
      {
        platform: "linux",
        spawnSync: spawnSyncImpl as unknown as typeof spawnSync,
      },
    );

    expect(p.confirm).not.toHaveBeenCalled();
    expect(spawnSyncImpl).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      "\nRun `ruler apply` to propagate .ruler skills to configured agents.",
    );
  });

  it("reminds the user to run ruler apply after declining automatic apply", async () => {
    vi.mocked(p.confirm).mockResolvedValue(false);
    const spawnSyncImpl = vi.fn();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await applyRulerAfterChanges(
      {
        installPaths: ["/project/.ruler/skills"],
        interactive: true,
        yes: false,
      },
      {
        platform: "linux",
        spawnSync: spawnSyncImpl as unknown as typeof spawnSync,
      },
    );

    expect(spawnSyncImpl).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      "\nRun `ruler apply` to propagate .ruler skills to configured agents.",
    );
  });
});
