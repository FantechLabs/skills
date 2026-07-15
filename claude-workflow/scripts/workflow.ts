#!/usr/bin/env node
// claude-workflow/scripts/workflow.ts
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import { buildClaudeArgs } from "./lib/modes.js";
import { composePrompt, type Mode } from "./lib/prompt.js";
import {
  computeRunDir,
  createRun,
  finalizeIfNeeded,
  finalizeStopped,
  isPidAlive,
  listRuns,
  readMeta,
  resolveRun,
  writeMeta,
  type RunMeta,
} from "./lib/runs.js";

export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export function buildShellCommand(claudeArgs: string[], dir: string, cwd: string): string {
  const q = shellQuote;
  const claude = `claude ${claudeArgs.map(q).join(" ")}`;
  return [
    `cd ${q(cwd)}`,
    `&& CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 ${claude}`,
    `< ${q(join(dir, "prompt.md"))}`,
    `> ${q(join(dir, "log.jsonl"))}`,
    `2> ${q(join(dir, "stderr.log"))};`,
    `echo $? > ${q(join(dir, "exit-code"))}`,
  ].join(" ");
}

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function requireMode(value: string | undefined): Mode {
  if (value === "explore" || value === "build") return value;
  return fail(`--mode must be "explore" or "build", got "${value ?? "(missing)"}"`);
}

function readPromptFile(path: string | undefined): string {
  if (!path) fail("--prompt <file> is required");
  const abs = resolve(path);
  if (!existsSync(abs)) fail(`prompt file not found: ${abs}`);
  const text = readFileSync(abs, "utf-8");
  if (!text.trim()) fail(`prompt file is empty: ${abs}`);
  return text;
}

function ensureClaudeOnPath(): void {
  const check = spawnSync("claude", ["--version"], { encoding: "utf-8" });
  if (check.error) fail("`claude` binary not found on PATH");
}

function launch(shellCmd: string, wait: boolean): number {
  const child = spawn("/bin/sh", ["-c", shellCmd], {
    detached: !wait,
    stdio: wait ? "inherit" : "ignore",
  });
  if (!wait) child.unref();
  if (child.pid === undefined) fail("failed to spawn /bin/sh");
  return child.pid;
}

function parseMaxBudgetUsd(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fail(`--max-budget-usd must be a positive number, got "${value}"`);
  }
  return parsed;
}

async function cmdStart(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      mode: { type: "string" },
      prompt: { type: "string" },
      cwd: { type: "string" },
      name: { type: "string" },
      wait: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      "dangerously-skip-permissions": { type: "boolean", default: false },
      "max-budget-usd": { type: "string" },
    },
  });
  const mode = requireMode(values.mode);
  const callerPrompt = readPromptFile(values.prompt);
  const cwd = resolve(values.cwd ?? process.cwd());
  const name = values.name ?? (values.prompt ?? "run").split("/").pop()!.replace(/\.md$/, "");
  const skipPermissions = values["dangerously-skip-permissions"] ?? false;
  const maxBudgetUsd = parseMaxBudgetUsd(values["max-budget-usd"]);

  const composed = composePrompt(callerPrompt, mode);
  let claudeArgs: string[];
  try {
    claudeArgs = buildClaudeArgs(mode, { skipPermissions, maxBudgetUsd });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }

  if (values["dry-run"]) {
    // Compose against the would-be dir without creating it — a dry-run must not
    // leave a run dir behind (it would later list as a crashed run).
    const dir = computeRunDir(name);
    console.log(buildShellCommand(claudeArgs, dir, cwd));
    return;
  }

  ensureClaudeOnPath();
  const { dir, meta } = createRun(name, mode, cwd, composed, {
    skipPermissions,
    maxBudgetUsd: maxBudgetUsd ?? null,
  });
  const shellCmd = buildShellCommand(claudeArgs, dir, cwd);

  if (values.wait) {
    console.log(`run: ${dir} (foreground)`);
    await launchAndWait(shellCmd, dir, meta);
    return;
  }
  meta.pid = launch(shellCmd, false);
  writeMeta(dir, meta);
  console.log(dir);
  console.log(`started pid ${meta.pid} — poll with: workflow.ts status ${dir}`);
}

export function resultFileName(resumeCount: number): string {
  return resumeCount > 0 ? `result-${resumeCount}.md` : "result.md";
}

// Runs the given shell command in the foreground (--wait), persisting the real child
// pid to meta.json BEFORE awaiting exit — a stop/status/list call from another shell
// during the run must see a live pid, not the spawnSync-era gap where no pid was ever
// recorded. detached: true keeps the process group killable the same way background
// runs are (see cmdStop's process.kill(-pid, …)).
export async function launchAndWait(shellCmd: string, dir: string, meta: RunMeta): Promise<void> {
  const child = spawn("/bin/sh", ["-c", shellCmd], {
    detached: true,
    stdio: ["ignore", "ignore", "inherit"],
  });
  if (child.pid === undefined) fail("failed to spawn /bin/sh");
  meta.pid = child.pid;
  writeMeta(dir, meta);

  const exitCode = await new Promise<number>((resolveExit) => {
    child.on("exit", (code) => resolveExit(code ?? 1));
  });

  meta.pid = null;
  writeMeta(dir, meta);
  const finalized = finalizeIfNeeded(dir);
  const result = readFileSync(join(dir, resultFileName(finalized.resumeCount)), "utf-8");
  if (exitCode !== 0 || finalized.state === "failed") {
    console.error(result);
    process.exit(1);
  }
  console.log(result);
}

function cmdStatus(argv: string[]): void {
  const dir = resolveRun(argv[0] ?? fail("usage: status <run>"));
  console.log(finalizeIfNeeded(dir).state);
}

function cmdResult(argv: string[]): void {
  const dir = resolveRun(argv[0] ?? fail("usage: result <run>"));
  const meta = finalizeIfNeeded(dir);
  if (meta.state === "running") fail("run is still in progress");
  console.log(readFileSync(join(dir, resultFileName(meta.resumeCount)), "utf-8"));
  if (meta.state === "failed") process.exit(1);
}

function cmdStop(argv: string[]): void {
  const dir = resolveRun(argv[0] ?? fail("usage: stop <run>"));
  const meta = readMeta(dir);
  // Defense in depth on top of isPidAlive's own pid<=1 guard: never let a corrupt
  // pid turn into process.kill(-1, …) (broadcast SIGTERM to every signalable
  // process) or process.kill(1, …)/process.kill(-1 * 1, …) (init / same broadcast).
  if (meta.pid !== null && meta.pid > 1 && isPidAlive(meta.pid)) {
    try {
      process.kill(-meta.pid, "SIGTERM");
    } catch {
      process.kill(meta.pid, "SIGTERM");
    }
  }
  finalizeStopped(dir);
  console.log(`stopped ${dir}`);
}

async function cmdResume(argv: string[]): Promise<void> {
  const runRef = argv[0] ?? fail("usage: resume <run> --prompt <file> [--wait]");
  const { values } = parseArgs({
    args: argv.slice(1),
    options: { prompt: { type: "string" }, wait: { type: "boolean", default: false } },
  });
  const dir = resolveRun(runRef);
  const meta = finalizeIfNeeded(dir);
  if (meta.state === "running") fail("run is still in progress; wait or stop it first");
  const sessionPath = join(dir, "session-id");
  if (!existsSync(sessionPath)) fail("no session-id recorded; cannot resume");
  const sessionId = readFileSync(sessionPath, "utf-8").trim();

  const n = meta.resumeCount + 1;
  const promptText = readPromptFile(values.prompt);
  const q = shellQuote;
  const claudeArgs = [
    "--resume",
    sessionId,
    ...buildClaudeArgs(meta.mode, {
      skipPermissions: meta.skipPermissions,
      maxBudgetUsd: meta.maxBudgetUsd ?? undefined,
    }),
  ];
  const shellCmd = [
    `cd ${q(meta.cwd)}`,
    `&& CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 claude ${claudeArgs.map(q).join(" ")}`,
    `< ${q(join(dir, `prompt-${n}.md`))}`,
    `> ${q(join(dir, `log-${n}.jsonl`))}`,
    `2> ${q(join(dir, `stderr-${n}.log`))};`,
    `echo $? > ${q(join(dir, `exit-code-${n}`))}`,
  ].join(" ");

  writeFileSync(join(dir, `prompt-${n}.md`), promptText);
  meta.resumeCount = n;
  meta.state = "running";
  ensureClaudeOnPath();

  if (values.wait) {
    // Clear the stale pid from the previous generation before spawning the new one —
    // finalizeIfNeeded's grace-period logic keys off pid === null meaning "starting",
    // not "still holding a dead pid from the run this is resuming".
    meta.pid = null;
    writeMeta(dir, meta);
    console.log(`resume ${n}: ${dir} (foreground)`);
    await launchAndWait(shellCmd, dir, meta);
    return;
  }
  meta.pid = launch(shellCmd, false);
  writeMeta(dir, meta);
  console.log(`resume ${n} started for ${dir}`);
}

function cmdList(): void {
  for (const { dir, meta } of listRuns()) {
    console.log(`${meta.state.padEnd(9)} ${meta.mode.padEnd(7)} ${meta.name.padEnd(24)} ${dir}`);
  }
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isMain()) {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "start":
      await cmdStart(rest);
      break;
    case "status":
      cmdStatus(rest);
      break;
    case "result":
      cmdResult(rest);
      break;
    case "stop":
      cmdStop(rest);
      break;
    case "resume":
      await cmdResume(rest);
      break;
    case "list":
      cmdList();
      break;
    case undefined:
      fail("usage: workflow.ts <start|status|result|stop|resume|list> …");
      break;
    default:
      fail(`unknown command "${command}"`);
  }
}
