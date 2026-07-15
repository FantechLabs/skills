import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRun, finalizeStopped, readMeta } from "../../claude-workflow/scripts/lib/runs";
import {
  buildShellCommand,
  launchAndWait,
  resultFileName,
  shellQuote,
} from "../../claude-workflow/scripts/workflow";

describe("shellQuote", () => {
  it("single-quotes and escapes embedded quotes", () => {
    expect(shellQuote("plain")).toBe("'plain'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
});

describe("buildShellCommand", () => {
  it("cds into cwd, sets the wait-ceiling env var, redirects streams, records exit code", () => {
    const cmd = buildShellCommand(["-p", "--verbose"], "/runs/r1", "/proj");
    expect(cmd).toContain("cd '/proj'");
    expect(cmd).toContain("CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0");
    expect(cmd).toContain("claude '-p' '--verbose'");
    expect(cmd).toContain("< '/runs/r1/prompt.md'");
    expect(cmd).toContain("> '/runs/r1/log.jsonl'");
    expect(cmd).toContain("2> '/runs/r1/stderr.log'");
    expect(cmd).toContain("echo $? > '/runs/r1/exit-code'");
  });

  it("quotes args containing parens (Bash tool patterns)", () => {
    const cmd = buildShellCommand(["--allowedTools", "Bash(git log:*)"], "/runs/r1", "/proj");
    expect(cmd).toContain("'Bash(git log:*)'");
  });
});

describe("launchAndWait", () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "cw-cli-"));
    process.env.CLAUDE_WORKFLOW_HOME = base;
  });

  afterEach(() => {
    delete process.env.CLAUDE_WORKFLOW_HOME;
    rmSync(base, { recursive: true, force: true });
  });

  it("persists a live pid to meta.json before the child process exits", async () => {
    const { dir, meta } = createRun("wait-run", "explore", "/tmp", "PROMPT");
    // Hermetic stub in place of `claude`: sleeps briefly (so the test window can
    // observe a live pid), then writes a minimal successful log + exit-code
    // fixture, mirroring the tail of buildShellCommand's real shell command.
    const logPath = join(dir, "log.jsonl");
    const exitCodePath = join(dir, "exit-code");
    const successEvent = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "OK",
      session_id: "s1",
    });
    const shellCmd = [
      "sleep 0.2",
      `; echo ${shellQuote(successEvent)} > ${shellQuote(logPath)}`,
      `; echo $? > ${shellQuote(exitCodePath)}`,
    ].join(" ");

    expect(readMeta(dir).pid).toBeNull();

    let sawLivePid: number | null = null;
    const poll = setInterval(() => {
      const current = readMeta(dir);
      if (current.pid !== null) sawLivePid = current.pid;
    }, 20);

    try {
      await launchAndWait(shellCmd, dir, meta);
    } finally {
      clearInterval(poll);
    }

    expect(sawLivePid).not.toBeNull();
    expect(sawLivePid).toBeGreaterThan(1);
    expect(readMeta(dir).pid).toBeNull();
  });

  it("finalizes as a clean failure when the child dies before writing the exit-code file", async () => {
    const { dir, meta } = createRun("crash-wait-run", "explore", "/tmp", "PROMPT");
    // `exit 0` mimics sh being SIGKILLed/OOM'd before its `echo $? > exit-code`
    // tail: no log, no exit-code file. launchAndWait must still finalize the run
    // as failed with a crash-message result and exit 1 — not throw ENOENT.
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(launchAndWait("exit 0", dir, meta)).rejects.toThrow("process.exit:1");
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }

    expect(readMeta(dir).state).toBe("failed");
    expect(readFileSync(join(dir, "result.md"), "utf-8")).toMatch(/crashed/i);
  });

  it("does not clobber a concurrent stop's failed state after the child exits", async () => {
    const { dir, meta } = createRun("stop-race-run", "explore", "/tmp", "PROMPT");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const pending = expect(launchAndWait("sleep 0.3", dir, meta)).rejects.toThrow(
        "process.exit:1",
      );
      // Mid-run, a `stop` from another shell finalizes the run as failed.
      await new Promise((r) => setTimeout(r, 100));
      finalizeStopped(dir);
      await pending;
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }

    expect(readMeta(dir).state).toBe("failed");
    expect(readFileSync(join(dir, "result.md"), "utf-8")).toBe("Run stopped by caller.");
  });
});

describe("resultFileName", () => {
  it("uses result.md for the original run", () => {
    expect(resultFileName(0)).toBe("result.md");
  });

  it("uses the generation suffix for resumed runs", () => {
    expect(resultFileName(1)).toBe("result-1.md");
    expect(resultFileName(3)).toBe("result-3.md");
  });
});
