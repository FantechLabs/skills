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
});
