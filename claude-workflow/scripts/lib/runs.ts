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

// A freshly created run writes meta.json with pid: null before the child process is
// spawned (createRun -> writeMeta -> spawn). A concurrent `status`/`list` landing in
// that createRun -> spawn window must not mistake "starting" for "dead" just because
// pid is still null. Only treat a null pid as a crashed start once it has been sitting
// there longer than this grace period.
export const STARTING_GRACE_MS = 5 * 60_000;

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

// createRun can be called twice for the same name within the same second
// (timestampSlug is second-resolution), which would make two independent runs
// collide on one dir name. Allocate exclusively (mkdirSync without `recursive`,
// which throws EEXIST on a collision instead of silently reusing the dir) and
// fall back to `-2`, `-3`, ... suffixes so an existing run's prompt.md/meta.json
// is never overwritten.
const MAX_RUN_DIR_ATTEMPTS = 100;

function isEexist(err: unknown): boolean {
  return err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "EEXIST";
}

function allocateRunDir(name: string): string {
  mkdirSync(runsBaseDir(), { recursive: true });
  const base = computeRunDir(name);
  for (let attempt = 1; attempt <= MAX_RUN_DIR_ATTEMPTS; attempt++) {
    const dir = attempt === 1 ? base : `${base}-${attempt}`;
    try {
      mkdirSync(dir);
      return dir;
    } catch (err) {
      if (!isEexist(err)) throw err;
    }
  }
  throw new Error(
    `could not allocate a unique run dir for "${name}" after ${MAX_RUN_DIR_ATTEMPTS} attempts`,
  );
}

export function createRun(
  name: string,
  mode: Mode,
  cwd: string,
  composedPrompt: string,
  opts?: CreateRunOptions,
): { dir: string; meta: RunMeta } {
  const dir = allocateRunDir(name);
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

// For a concurrent observer, a null pid usually means "not spawned yet" (the
// createRun -> writeMeta -> spawn window, or launchAndWait's pre-spawn instant).
// The exit-code file — the very last thing the shell command writes — is the one
// definitive counter-signal: if it's there, the child ran to completion and this is
// not a "starting" run no matter how fresh startedAt is. Only fall back to the
// time-based grace period when there's no such evidence yet, to avoid finalizing a
// run that just hasn't been given a pid yet as "crashed".
function isStillStarting(dir: string, meta: RunMeta): boolean {
  const suffix = meta.resumeCount > 0 ? `-${meta.resumeCount}` : "";
  if (existsSync(join(dir, `exit-code${suffix}`))) return false;
  return Date.now() - new Date(meta.startedAt).getTime() < STARTING_GRACE_MS;
}

// Reads the given generation's exit-code file (exit-code / exit-code-<n>, written by
// the launcher's `echo $? >` tail), trims and parses it as an integer. Missing or
// unparseable exit code files (not yet written, or corrupt) return null, which never
// equals 0, so callers that require exit code 0 for success treat that as a failure
// rather than trusting the log alone.
function readExitCode(dir: string, suffix: string): number | null {
  const path = join(dir, `exit-code${suffix}`);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf-8").trim();
  if (!/^-?\d+$/.test(raw)) return null;
  return Number.parseInt(raw, 10);
}

// Reads the current generation's log (generation 0 = log.jsonl/result.md, resumes
// use -<n> suffixes), extracts whatever result/session-id is available, writes the
// result file and session-id file, and persists the given final state. Shared by
// finalizeIfNeeded (natural completion/crash) and finalizeStopped (caller-initiated).
function finalizeFromLog(
  dir: string,
  meta: RunMeta,
  fallbackText: string,
  computeState: (
    result: ReturnType<typeof extractResult>,
    exitCode: number | null,
  ) => RunMeta["state"],
): RunMeta {
  const suffix = meta.resumeCount > 0 ? `-${meta.resumeCount}` : "";
  const logPath = join(dir, `log${suffix}.jsonl`);
  const log = existsSync(logPath) ? readFileSync(logPath, "utf-8") : "";
  const result = extractResult(log);
  const exitCode = readExitCode(dir, suffix);

  if (result.sessionId) writeFileSync(join(dir, "session-id"), `${result.sessionId}\n`);
  writeFileSync(join(dir, `result${suffix}.md`), result.found ? result.text : fallbackText);
  meta.state = computeState(result, exitCode);
  writeMeta(dir, meta);
  return meta;
}

// Finalizes from the evidence on disk: completed only when the log has a real,
// non-error result AND the shell recorded exit code 0 (Fix C), failed otherwise —
// including a missing exit-code file (child died before its `echo $? >` tail ran).
function finalizeFromEvidence(dir: string, meta: RunMeta): RunMeta {
  return finalizeFromLog(
    dir,
    meta,
    "Run crashed before producing a result. See the log and stderr files.",
    (result, exitCode) =>
      result.found && !result.isError && exitCode === 0 ? "completed" : "failed",
  );
}

export function finalizeIfNeeded(dir: string): RunMeta {
  const meta = readMeta(dir);
  if (meta.state !== "running") return meta;
  if (meta.pid !== null && isPidAlive(meta.pid)) return meta;
  if (meta.pid === null && isStillStarting(dir, meta)) return meta;

  return finalizeFromEvidence(dir, meta);
}

// Force-finalizes a run whose child the caller has definitively observed exiting
// (launchAndWait's post-exit path). Unlike finalizeIfNeeded — which serves concurrent
// OBSERVERS and must hedge with pid-liveness and starting-grace checks — the caller
// here owns the exit fact, so no gating applies: finalize now, from whatever evidence
// is on disk, and clear the pid in the same meta write. Meta is re-read from disk
// first so a concurrent `stop` that already finalized (state !== "running") is
// respected rather than clobbered by the caller's stale in-memory copy.
export function finalizeExited(dir: string): RunMeta {
  const meta = readMeta(dir);
  if (meta.state !== "running") return meta;
  meta.pid = null;
  return finalizeFromEvidence(dir, meta);
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
