import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createRun,
  finalizeExited,
  finalizeIfNeeded,
  finalizeStopped,
  isPidAlive,
  listRuns,
  readMeta,
  resolveRun,
  STARTING_GRACE_MS,
  writeMeta,
} from "../../claude-workflow/scripts/lib/runs";

let base: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "cw-runs-"));
  process.env.CLAUDE_WORKFLOW_HOME = base;
});

afterEach(() => {
  delete process.env.CLAUDE_WORKFLOW_HOME;
  rmSync(base, { recursive: true, force: true });
});

describe("createRun", () => {
  it("creates a run dir with prompt.md and running meta", () => {
    const { dir, meta } = createRun("audit-auth", "explore", "/tmp/proj", "PROMPT");
    expect(dir.startsWith(base)).toBe(true);
    expect(dir).toMatch(/-audit-auth$/);
    expect(readFileSync(join(dir, "prompt.md"), "utf-8")).toBe("PROMPT");
    expect(meta.state).toBe("running");
    expect(meta.mode).toBe("explore");
    expect(meta.skipPermissions).toBe(false);
    expect(meta.maxBudgetUsd).toBeNull();
    expect(readMeta(dir)).toEqual(meta);
  });

  it("persists skipPermissions and maxBudgetUsd when provided", () => {
    const { meta } = createRun("build-run", "build", "/tmp/proj", "PROMPT", {
      skipPermissions: true,
      maxBudgetUsd: 5,
    });
    expect(meta.skipPermissions).toBe(true);
    expect(meta.maxBudgetUsd).toBe(5);
  });

  it("gives back-to-back same-name runs distinct dirs and never overwrites the first", () => {
    const first = createRun("dup-name", "explore", "/tmp/proj", "FIRST PROMPT");
    const second = createRun("dup-name", "explore", "/tmp/proj", "SECOND PROMPT");

    expect(second.dir).not.toBe(first.dir);
    expect(readFileSync(join(first.dir, "prompt.md"), "utf-8")).toBe("FIRST PROMPT");
    expect(readFileSync(join(second.dir, "prompt.md"), "utf-8")).toBe("SECOND PROMPT");
  });
});

describe("readMeta backfill", () => {
  it("defaults skipPermissions/maxBudgetUsd for old meta files missing the fields", () => {
    const { dir } = createRun("legacy-run", "explore", "/tmp/proj", "PROMPT");
    const legacy = JSON.parse(readFileSync(join(dir, "meta.json"), "utf-8")) as Record<
      string,
      unknown
    >;
    delete legacy.skipPermissions;
    delete legacy.maxBudgetUsd;
    writeFileSync(join(dir, "meta.json"), JSON.stringify(legacy, null, 2));

    const meta = readMeta(dir);
    expect(meta.skipPermissions).toBe(false);
    expect(meta.maxBudgetUsd).toBeNull();
  });
});

describe("resolveRun / listRuns", () => {
  it("resolves by directory-name suffix and lists newest first", () => {
    const a = createRun("alpha", "explore", "/x", "p");
    const b = createRun("beta", "build", "/x", "p");
    expect(resolveRun("alpha")).toBe(a.dir);
    expect(resolveRun(b.dir)).toBe(b.dir);
    expect(() => resolveRun("nope")).toThrow(/no run matching/i);
    const runs = listRuns();
    expect(runs.map((r) => r.meta.name)).toContain("alpha");
    expect(runs.map((r) => r.meta.name)).toContain("beta");
  });
});

describe("isPidAlive", () => {
  it("is true for this process and false for an unlikely pid", () => {
    expect(isPidAlive(process.pid)).toBe(true);
    expect(isPidAlive(999999999)).toBe(false);
  });

  it("rejects sentinel/invalid pids without ever signaling them", () => {
    expect(isPidAlive(-1)).toBe(false);
    expect(isPidAlive(0)).toBe(false);
    expect(isPidAlive(1)).toBe(false);
  });
});

describe("finalizeIfNeeded", () => {
  const successLog = [
    JSON.stringify({ type: "system", subtype: "init", session_id: "s1" }),
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "DONE",
      session_id: "s1",
    }),
  ].join("\n");

  it("finalizes a completed run once the pid is dead", () => {
    const { dir, meta } = createRun("done-run", "explore", "/x", "p");
    writeFileSync(join(dir, "log.jsonl"), successLog);
    writeFileSync(join(dir, "exit-code"), "0\n");
    meta.pid = 999999999; // dead
    writeMeta(dir, meta);
    const finalized = finalizeIfNeeded(dir);
    expect(finalized.state).toBe("completed");
    expect(readFileSync(join(dir, "result.md"), "utf-8")).toBe("DONE");
    expect(readFileSync(join(dir, "session-id"), "utf-8").trim()).toBe("s1");
  });

  it("marks crashed runs (no result event) as failed", () => {
    const { dir, meta } = createRun("crash-run", "explore", "/x", "p");
    writeFileSync(
      join(dir, "log.jsonl"),
      JSON.stringify({ type: "system", subtype: "init", session_id: "s2" }),
    );
    writeFileSync(join(dir, "exit-code"), "0\n");
    meta.pid = 999999999;
    writeMeta(dir, meta);
    expect(finalizeIfNeeded(dir).state).toBe("failed");
  });

  it("finalizes resumed runs from the generation log", () => {
    const { dir, meta } = createRun("resumed-run", "explore", "/x", "p");
    writeFileSync(join(dir, "log-1.jsonl"), successLog);
    writeFileSync(join(dir, "exit-code-1"), "0\n");
    meta.pid = 999999999;
    meta.resumeCount = 1;
    writeMeta(dir, meta);
    expect(finalizeIfNeeded(dir).state).toBe("completed");
    expect(readFileSync(join(dir, "result-1.md"), "utf-8")).toBe("DONE");
  });

  it("leaves live runs alone", () => {
    const { dir, meta } = createRun("live-run", "explore", "/x", "p");
    meta.pid = process.pid;
    writeMeta(dir, meta);
    expect(finalizeIfNeeded(dir).state).toBe("running");
  });

  it("fails a run with a fabricated success event when the process exit code is nonzero (Codex probe)", () => {
    const { dir, meta } = createRun("lying-run", "explore", "/x", "p");
    writeFileSync(join(dir, "log.jsonl"), successLog);
    writeFileSync(join(dir, "exit-code"), "7\n");
    meta.pid = 999999999;
    writeMeta(dir, meta);
    const finalized = finalizeIfNeeded(dir);
    expect(finalized.state).toBe("failed");
    expect(readFileSync(join(dir, "result.md"), "utf-8")).toBe("DONE");
  });

  it("fails a resumed run when the resume generation's exit code is nonzero", () => {
    const { dir, meta } = createRun("resumed-lying-run", "explore", "/x", "p");
    writeFileSync(join(dir, "log-1.jsonl"), successLog);
    writeFileSync(join(dir, "exit-code-1"), "1\n");
    meta.pid = 999999999;
    meta.resumeCount = 1;
    writeMeta(dir, meta);
    expect(finalizeIfNeeded(dir).state).toBe("failed");
  });

  it("completes a resumed run when the resume generation's exit code is zero", () => {
    const { dir, meta } = createRun("resumed-ok-run", "explore", "/x", "p");
    writeFileSync(join(dir, "log-1.jsonl"), successLog);
    writeFileSync(join(dir, "exit-code-1"), "0\n");
    meta.pid = 999999999;
    meta.resumeCount = 1;
    writeMeta(dir, meta);
    expect(finalizeIfNeeded(dir).state).toBe("completed");
  });

  it("fails a run with a success event but no exit-code file at all", () => {
    const { dir, meta } = createRun("no-exit-code-run", "explore", "/x", "p");
    writeFileSync(join(dir, "log.jsonl"), successLog);
    meta.pid = 999999999;
    writeMeta(dir, meta);
    expect(finalizeIfNeeded(dir).state).toBe("failed");
  });
});

describe("finalizeIfNeeded - starting grace period", () => {
  it("treats a null pid with a fresh startedAt as still running and writes nothing", () => {
    const { dir } = createRun("starting-run", "explore", "/x", "p");
    // createRun leaves meta.pid === null and startedAt === now, mimicking the
    // createRun -> writeMeta -> spawn window before a real pid is persisted.
    const before = readFileSync(join(dir, "meta.json"), "utf-8");

    const finalized = finalizeIfNeeded(dir);

    expect(finalized.state).toBe("running");
    expect(readFileSync(join(dir, "meta.json"), "utf-8")).toBe(before);
  });

  it("finalizes a null pid run as failed once startedAt is older than the grace period", () => {
    const { dir, meta } = createRun("stale-start-run", "explore", "/x", "p");
    meta.startedAt = new Date(Date.now() - STARTING_GRACE_MS - 1_000).toISOString();
    writeMeta(dir, meta);

    const finalized = finalizeIfNeeded(dir);

    expect(finalized.state).toBe("failed");
  });
});

describe("finalizeExited", () => {
  const successLog = [
    JSON.stringify({ type: "system", subtype: "init", session_id: "sx" }),
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "DONE",
      session_id: "sx",
    }),
  ].join("\n");

  it("force-finalizes a completed run regardless of the starting grace period", () => {
    const { dir } = createRun("exited-ok-run", "explore", "/x", "p");
    writeFileSync(join(dir, "log.jsonl"), successLog);
    writeFileSync(join(dir, "exit-code"), "0\n");
    // pid is null and startedAt is fresh — an observer's finalizeIfNeeded grace
    // logic must not apply here: the caller KNOWS the child exited.
    const finalized = finalizeExited(dir);

    expect(finalized.state).toBe("completed");
    expect(finalized.pid).toBeNull();
    expect(readFileSync(join(dir, "result.md"), "utf-8")).toBe("DONE");
  });

  it("force-fails a run whose child died before writing the exit-code file", () => {
    const { dir } = createRun("exited-crash-run", "explore", "/x", "p");
    // No log, no exit-code (sh SIGKILLed before its `echo $? >` tail) and a fresh
    // startedAt: finalizeIfNeeded would defer for the grace period, but the exit
    // is a certainty — finalizeExited must fail it now and write a result file.
    expect(finalizeIfNeeded(dir).state).toBe("running");

    const finalized = finalizeExited(dir);

    expect(finalized.state).toBe("failed");
    expect(readFileSync(join(dir, "result.md"), "utf-8")).toMatch(/crashed/i);
  });

  it("does not clobber a concurrent stop's finalization", () => {
    const { dir, meta } = createRun("exited-stopped-run", "explore", "/x", "p");
    meta.pid = 12345;
    writeMeta(dir, meta);
    finalizeStopped(dir); // what `stop` does right after SIGTERM

    const finalized = finalizeExited(dir);

    expect(finalized.state).toBe("failed");
    expect(readFileSync(join(dir, "result.md"), "utf-8")).toBe("Run stopped by caller.");
    expect(readMeta(dir).state).toBe("failed");
  });
});

describe("finalizeStopped", () => {
  it("writes a stopped-message result and preserves the session id from an init-only log", () => {
    const { dir, meta } = createRun("stopped-run", "explore", "/x", "p");
    writeFileSync(
      join(dir, "log.jsonl"),
      JSON.stringify({ type: "system", subtype: "init", session_id: "s3" }),
    );
    meta.pid = process.pid; // still "alive" — stop must finalize regardless
    writeMeta(dir, meta);

    const finalized = finalizeStopped(dir);

    expect(finalized.state).toBe("failed");
    expect(readFileSync(join(dir, "result.md"), "utf-8")).toBe("Run stopped by caller.");
    expect(readFileSync(join(dir, "session-id"), "utf-8").trim()).toBe("s3");
    // resumable: state is not "running" and session-id exists
    expect(readMeta(dir).state).toBe("failed");
  });

  it("finalizes stopped resumed runs from the generation log", () => {
    const { dir, meta } = createRun("stopped-resume", "explore", "/x", "p");
    writeFileSync(
      join(dir, "log-1.jsonl"),
      JSON.stringify({ type: "system", subtype: "init", session_id: "s4" }),
    );
    meta.resumeCount = 1;
    writeMeta(dir, meta);

    finalizeStopped(dir);

    expect(readFileSync(join(dir, "result-1.md"), "utf-8")).toBe("Run stopped by caller.");
    expect(readFileSync(join(dir, "session-id"), "utf-8").trim()).toBe("s4");
  });
});
