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
  skipPermissions: boolean;
  maxBudgetUsd: number | null;
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

// Computes the run directory path a `createRun` call with this name would use,
// without creating anything. Used by --dry-run so it can compose the shell command
// against the would-be dir without littering the runs directory with a dir that
// never launches (and would later list as "crashed").
export function computeRunDir(name: string): string {
  return join(runsBaseDir(), `${timestampSlug(new Date())}-${slugify(name)}`);
}

export interface CreateRunOptions {
  skipPermissions?: boolean;
  maxBudgetUsd?: number | null;
}

export function createRun(
  name: string,
  mode: Mode,
  cwd: string,
  composedPrompt: string,
  opts?: CreateRunOptions,
): { dir: string; meta: RunMeta } {
  const dir = computeRunDir(name);
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
    skipPermissions: opts?.skipPermissions ?? false,
    maxBudgetUsd: opts?.maxBudgetUsd ?? null,
  };
  writeMeta(dir, meta);
  return { dir, meta };
}

export function readMeta(dir: string): RunMeta {
  const raw = JSON.parse(readFileSync(join(dir, "meta.json"), "utf-8")) as Partial<RunMeta>;
  return {
    ...raw,
    skipPermissions: raw.skipPermissions ?? false,
    maxBudgetUsd: raw.maxBudgetUsd ?? null,
  } as RunMeta;
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
  // pid <= 1 is never a spawned run: 0/negative are signal-broadcast sentinels
  // (kill(0, sig) hits the whole process group, kill(-1, sig) hits every process
  // the caller can signal) and 1 is init, which we never own. Treat all of them
  // as dead rather than letting a corrupt/-1 pid look "alive" forever.
  if (pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Reads the current generation's log (generation 0 = log.jsonl/result.md, resumes
// use -<n> suffixes), extracts whatever result/session-id is available, writes the
// result file and session-id file, and persists the given final state. Shared by
// finalizeIfNeeded (natural completion/crash) and finalizeStopped (caller-initiated).
function finalizeFromLog(
  dir: string,
  meta: RunMeta,
  fallbackText: string,
  computeState: (result: ReturnType<typeof extractResult>) => RunMeta["state"],
): RunMeta {
  const suffix = meta.resumeCount > 0 ? `-${meta.resumeCount}` : "";
  const logPath = join(dir, `log${suffix}.jsonl`);
  const log = existsSync(logPath) ? readFileSync(logPath, "utf-8") : "";
  const result = extractResult(log);

  if (result.sessionId) writeFileSync(join(dir, "session-id"), `${result.sessionId}\n`);
  writeFileSync(join(dir, `result${suffix}.md`), result.found ? result.text : fallbackText);
  meta.state = computeState(result);
  writeMeta(dir, meta);
  return meta;
}

export function finalizeIfNeeded(dir: string): RunMeta {
  const meta = readMeta(dir);
  if (meta.state !== "running") return meta;
  if (meta.pid !== null && isPidAlive(meta.pid)) return meta;

  return finalizeFromLog(
    dir,
    meta,
    "Run crashed before producing a result. See the log and stderr files.",
    (result) => (result.found && !result.isError ? "completed" : "failed"),
  );
}

// Finalizes a run that the caller explicitly stopped: unlike finalizeIfNeeded, this
// does not check pid liveness (the caller just sent SIGTERM and may race the OS) and
// always lands in "failed" state. If the log already captured a real result (the
// process finished right as stop was issued), that result is preserved; otherwise a
// stopped-message placeholder is written so `result` never throws on a missing file.
export function finalizeStopped(dir: string): RunMeta {
  const meta = readMeta(dir);
  return finalizeFromLog(dir, meta, "Run stopped by caller.", () => "failed");
}
