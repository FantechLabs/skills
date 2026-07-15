import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createRun,
  finalizeIfNeeded,
  isPidAlive,
  listRuns,
  readMeta,
  resolveRun,
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
    expect(readMeta(dir)).toEqual(meta);
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
    meta.pid = 999999999;
    writeMeta(dir, meta);
    expect(finalizeIfNeeded(dir).state).toBe("failed");
  });

  it("finalizes resumed runs from the generation log", () => {
    const { dir, meta } = createRun("resumed-run", "explore", "/x", "p");
    writeFileSync(join(dir, "log-1.jsonl"), successLog);
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
});
