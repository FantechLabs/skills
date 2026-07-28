import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createRun,
  finalizeStopped,
  isPidAlive,
  readMeta,
  writeMeta,
  type RunMeta,
} from "../../claude-workflow/scripts/lib/runs";
import {
  buildShellCommand,
  handleForegroundSignal,
  launchAndWait,
  resultFileName,
  shellQuote,
  usageText,
} from "../../claude-workflow/scripts/workflow";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const WORKFLOW_TS = resolve(moduleDir, "../../claude-workflow/scripts/workflow.ts");
const SIGINT_HARNESS_TS = resolve(moduleDir, "fixtures/sigint-harness.ts");
// The stub MUST be named `claude` — PATH lookup resolves the command name, so a
// file named anything else is invisible to `ensureClaudeOnPath()` and the spawned
// shell command. (On dev machines a real `claude` further down PATH would mask a
// misnamed stub; CI has none, so the lookup fails outright.)
const FAKE_CLAUDE_DIR = dirname(resolve(moduleDir, "fixtures/claude"));

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

  it("start with a stray positional exits 1 with a clean error, not an ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL stack trace", () => {
    // `start task.md --mode explore` (prompt passed positionally instead of via
    // --prompt) used to escape isParseArgsError's fixed unknown-option/invalid-value
    // allowlist and print a raw stack trace.
    const dir = mkdtempSync(join(tmpdir(), "cw-positional-"));
    try {
      const promptPath = join(dir, "task.md");
      writeFileSync(promptPath, "hello");
      const result = spawnSync("bun", [WORKFLOW_TS, "start", promptPath, "--mode", "explore"], {
        encoding: "utf-8",
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("error:");
      expect(result.stderr).not.toContain("at ");
      expect(result.stderr).not.toContain("ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("start --max-budget-usd 5abc fails cleanly instead of silently truncating to 5", () => {
    // Number.parseFloat("5abc") is 5 (parses a leading numeric prefix and ignores
    // the rest) — a typo'd budget flag would silently be accepted. Number("5abc")
    // is NaN, which the existing finite/positive check already rejects.
    const dir = mkdtempSync(join(tmpdir(), "cw-budget-"));
    try {
      const promptPath = join(dir, "task.md");
      writeFileSync(promptPath, "hello");
      const result = spawnSync(
        "bun",
        [
          WORKFLOW_TS,
          "start",
          "--mode",
          "explore",
          "--prompt",
          promptPath,
          "--max-budget-usd",
          "5abc",
        ],
        { encoding: "utf-8" },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("error:");
      expect(result.stderr).toContain("--max-budget-usd must be a positive number");
      expect(result.stderr).not.toContain("at ");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

describe("handleForegroundSignal", () => {
  let base: string;
  let child: ReturnType<typeof spawn>;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "cw-sigfg-"));
    process.env.CLAUDE_WORKFLOW_HOME = base;
    // Detached, own process group — same shape launchAndWait spawns its child in —
    // so killProcessGroup's `process.kill(-pid, ...)` has a real group to reap.
    child = spawn("/bin/sh", ["-c", "sleep 30"], { detached: true, stdio: "ignore" });
  });

  afterEach(() => {
    delete process.env.CLAUDE_WORKFLOW_HOME;
    if (child.pid !== undefined && isPidAlive(child.pid)) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // already dead
      }
    }
    rmSync(base, { recursive: true, force: true });
  });

  it("kills the child's process group, finalizes the run as failed, and exits 130 on SIGINT", async () => {
    const { dir } = createRun("sigint-handler-run", "explore", "/tmp", "PROMPT");
    const pid = child.pid!;
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      expect(() => handleForegroundSignal(pid, dir, "SIGINT")).toThrow("process.exit:130");
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("SIGINT"));
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }

    expect(readMeta(dir).state).toBe("failed");

    // SIGTERM delivery to a plain `sleep` is effectively immediate but not
    // synchronous with process.kill() returning — poll briefly instead of a fixed
    // sleep so this isn't a source of flakiness under load.
    const deadline = Date.now() + 2000;
    while (isPidAlive(pid) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(isPidAlive(pid)).toBe(false);
  });

  it("exits 143 on SIGTERM", () => {
    const { dir } = createRun("sigterm-handler-run", "explore", "/tmp", "PROMPT");
    const pid = child.pid!;
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      expect(() => handleForegroundSignal(pid, dir, "SIGTERM")).toThrow("process.exit:143");
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }

    expect(readMeta(dir).state).toBe("failed");
  });
});

describe("launchAndWait SIGINT integration (real OS signal, real subprocess)", () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "cw-sigint-harness-"));
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("^C on a foreground `--wait` run kills the underlying claude process group and marks the run failed", async () => {
    // Drives the real signal-handling path end to end via a subprocess (see
    // sigint-harness.ts) instead of delivering SIGINT to the vitest worker itself,
    // which would risk killing the test runner rather than exercising the code path.
    const harness = spawn("bun", [SIGINT_HARNESS_TS], {
      env: { ...process.env, CLAUDE_WORKFLOW_HOME: base },
      stdio: ["ignore", "pipe", "ignore"],
    });

    const dir = await new Promise<string>((resolvePromise, reject) => {
      let buf = "";
      const onData = (chunk: Buffer) => {
        buf += chunk.toString();
        const nl = buf.indexOf("\n");
        if (nl !== -1) {
          harness.stdout?.off("data", onData);
          resolvePromise(buf.slice(0, nl));
        }
      };
      harness.stdout?.on("data", onData);
      harness.once("error", reject);
    });

    // Wait for launchAndWait to persist the real (grand)child pid before signaling —
    // signaling before that would just hit nothing.
    let grandchildPid: number | null = null;
    const pidDeadline = Date.now() + 5000;
    while (Date.now() < pidDeadline) {
      const meta = readMeta(dir);
      if (meta.pid !== null) {
        grandchildPid = meta.pid;
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(grandchildPid).not.toBeNull();

    harness.kill("SIGINT");
    const exitCode = await new Promise<number | null>((resolvePromise) => {
      harness.once("exit", (code) => resolvePromise(code));
    });

    expect(exitCode).toBe(130);
    expect(readMeta(dir).state).toBe("failed");
    expect(isPidAlive(grandchildPid!)).toBe(false);
  }, 10_000);
});

describe("cmdResume integration (real CLI subprocess, stubbed `claude` binary)", () => {
  let base: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "cw-resume-"));
    env = {
      ...process.env,
      CLAUDE_WORKFLOW_HOME: base,
      // fixtures/claude (stub) answers `--version` (satisfies ensureClaudeOnPath) and
      // exits immediately for anything else, so the (non---wait) background launch
      // this test triggers never makes a real network call or spends real budget —
      // it just needs to exist long enough for cmdResume's own bookkeeping
      // (meta.json fields, prompt-<n>.md) to be exercised for real.
      PATH: `${FAKE_CLAUDE_DIR}:${process.env.PATH}`,
    };
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  function makeResumableRun(overrides: Partial<RunMeta> = {}): string {
    const { dir, meta } = createRun("resume-target", "build", "/tmp", "PROMPT");
    const updated: RunMeta = { ...meta, state: "completed", ...overrides };
    writeFileSync(join(dir, "session-id"), "sess-123\n");
    writeMeta(dir, updated);
    return dir;
  }

  it("resume with a corrupt explore+skipPermissions meta.json fails cleanly (fail(), not an uncaught stack trace)", () => {
    // Same guard cmdStart already had: buildClaudeArgs throws when mode is
    // "explore" and skipPermissions is true (skip-permissions is build-mode-only).
    // cmdResume reads this combination straight out of meta.json, so a corrupt or
    // hand-edited meta.json can hit it even though cmdStart itself would never
    // persist it.
    const dir = makeResumableRun({ mode: "explore", skipPermissions: true });
    const promptPath = join(base, "followup.md");
    writeFileSync(promptPath, "keep going");

    const result = spawnSync("bun", [WORKFLOW_TS, "resume", dir, "--prompt", promptPath], {
      encoding: "utf-8",
      env,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("error:");
    expect(result.stderr).toContain("build mode");
    expect(result.stderr).not.toContain("at ");
  });

  it("refreshes startedAt and bumps resumeCount on a normal resume", () => {
    const dir = makeResumableRun({ mode: "build" });
    const staleStartedAt = new Date(Date.now() - 60 * 60_000).toISOString();
    const meta = readMeta(dir);
    meta.startedAt = staleStartedAt;
    writeMeta(dir, meta);

    const promptPath = join(base, "followup2.md");
    writeFileSync(promptPath, "keep going");

    const result = spawnSync("bun", [WORKFLOW_TS, "resume", dir, "--prompt", promptPath], {
      encoding: "utf-8",
      env,
    });

    expect(result.status).toBe(0);
    const updated = readMeta(dir);
    expect(updated.resumeCount).toBe(1);
    expect(updated.startedAt).not.toBe(staleStartedAt);
    expect(Date.now() - new Date(updated.startedAt).getTime()).toBeLessThan(10_000);
    expect(existsSync(join(dir, "prompt-1.md"))).toBe(true);
  });
});
