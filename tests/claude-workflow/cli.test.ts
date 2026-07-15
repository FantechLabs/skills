import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRun, finalizeStopped, readMeta } from "../../claude-workflow/scripts/lib/runs";
import {
  buildShellCommand,
  launchAndWait,
  resultFileName,
  shellQuote,
  usageText,
} from "../../claude-workflow/scripts/workflow";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKFLOW_TS = resolve(__dirname, "../../claude-workflow/scripts/workflow.ts");

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

  it("applies a suffix to prompt/log/stderr/exit-code filenames", () => {
    const cmd = buildShellCommand(["-p"], "/runs/r1", "/proj", "-1");
    expect(cmd).toContain("< '/runs/r1/prompt-1.md'");
    expect(cmd).toContain("> '/runs/r1/log-1.jsonl'");
    expect(cmd).toContain("2> '/runs/r1/stderr-1.log'");
    expect(cmd).toContain("echo $? > '/runs/r1/exit-code-1'");
  });

  it("defaults to unsuffixed filenames when no suffix is given", () => {
    const cmd = buildShellCommand(["-p"], "/runs/r1", "/proj");
    expect(cmd).toContain("< '/runs/r1/prompt.md'");
    expect(cmd).toContain("> '/runs/r1/log.jsonl'");
    expect(cmd).toContain("2> '/runs/r1/stderr.log'");
    expect(cmd).toContain("echo $? > '/runs/r1/exit-code'");
  });
});

describe("usageText", () => {
  it("lists every subcommand with a one-line purpose", () => {
    const root = usageText();
    for (const command of ["start", "status", "result", "stop", "resume", "list"]) {
      expect(root).toContain(command);
    }
  });

  it("mentions start's flags including Fix A's skip-permissions and budget cap", () => {
    const startUsage = usageText("start");
    expect(startUsage).toContain("--mode");
    expect(startUsage).toContain("--prompt");
    expect(startUsage).toContain("--dry-run");
    expect(startUsage).toContain("--dangerously-skip-permissions");
    expect(startUsage).toContain("--max-budget-usd");
  });
});

describe("workflow.ts CLI process", () => {
  it("--help at the root prints usage and exits 0", () => {
    const result = spawnSync("bun", [WORKFLOW_TS, "--help"], { encoding: "utf-8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("start");
    expect(result.stdout).toContain("resume");
  });

  it("start --help prints subcommand usage and exits 0", () => {
    const result = spawnSync("bun", [WORKFLOW_TS, "start", "--help"], { encoding: "utf-8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--mode");
    expect(result.stdout).toContain("--dangerously-skip-permissions");
  });

  it("start --bogus-flag exits 1 with a clean error, never an uncaught stack trace", () => {
    const result = spawnSync("bun", [WORKFLOW_TS, "start", "--bogus-flag"], { encoding: "utf-8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("error:");
    expect(result.stderr).not.toContain("at ");
    expect(result.stderr).not.toContain("ERR_PARSE_ARGS_UNKNOWN_OPTION");
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
