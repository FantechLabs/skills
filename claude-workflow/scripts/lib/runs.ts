import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import type { Mode } from "./prompt.js";
import { extractResult } from "./result.js";

export interface RunMeta {
  name: string;
  mode: Mode;
  cwd: string;
  pid: number | null;
  startedAt: string;
  state: "running" | "completed" | "failed";
  resumeCount: number;
}

export function runsBaseDir(): string {
  return process.env.CLAUDE_WORKFLOW_HOME ?? join(homedir(), ".agents", "claude-workflow", "runs");
}

function timestampSlug(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function createRun(
  name: string,
  mode: Mode,
  cwd: string,
  composedPrompt: string,
): { dir: string; meta: RunMeta } {
  const dir = join(runsBaseDir(), `${timestampSlug(new Date())}-${slugify(name)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "prompt.md"), composedPrompt);
  const meta: RunMeta = {
    name: slugify(name),
    mode,
    cwd,
    pid: null,
    startedAt: new Date().toISOString(),
    state: "running",
    resumeCount: 0,
  };
  writeMeta(dir, meta);
  return { dir, meta };
}

export function readMeta(dir: string): RunMeta {
  return JSON.parse(readFileSync(join(dir, "meta.json"), "utf-8")) as RunMeta;
}

export function writeMeta(dir: string, meta: RunMeta): void {
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2));
}

export function resolveRun(ref: string): string {
  if (isAbsolute(ref) && existsSync(join(ref, "meta.json"))) return ref;
  const base = runsBaseDir();
  const matches = existsSync(base)
    ? readdirSync(base).filter((d) => d === ref || d.endsWith(`-${ref}`) || d.includes(ref))
    : [];
  if (matches.length === 0) throw new Error(`no run matching "${ref}" under ${base}`);
  if (matches.length > 1) throw new Error(`ambiguous run "${ref}": ${matches.join(", ")}`);
  return join(base, matches[0]);
}

export function listRuns(): { dir: string; meta: RunMeta }[] {
  const base = runsBaseDir();
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .sort()
    .reverse()
    .map((d) => join(base, d))
    .filter((dir) => existsSync(join(dir, "meta.json")))
    .map((dir) => ({ dir, meta: finalizeIfNeeded(dir) }));
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function finalizeIfNeeded(dir: string): RunMeta {
  const meta = readMeta(dir);
  if (meta.state !== "running") return meta;
  if (meta.pid !== null && isPidAlive(meta.pid)) return meta;

  // generation 0 = the original run (log.jsonl/result.md); resumes use -<n> suffixes
  const suffix = meta.resumeCount > 0 ? `-${meta.resumeCount}` : "";
  const logPath = join(dir, `log${suffix}.jsonl`);
  const log = existsSync(logPath) ? readFileSync(logPath, "utf-8") : "";
  const result = extractResult(log);

  if (result.sessionId) writeFileSync(join(dir, "session-id"), `${result.sessionId}\n`);
  writeFileSync(
    join(dir, `result${suffix}.md`),
    result.found
      ? result.text
      : "Run crashed before producing a result. See the log and stderr files.",
  );
  meta.state = result.found && !result.isError ? "completed" : "failed";
  writeMeta(dir, meta);
  return meta;
}
