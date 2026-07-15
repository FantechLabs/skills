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
  createRun,
  finalizeIfNeeded,
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
  return child.pid ?? -1;
}

function cmdStart(argv: string[]): void {
  const { values } = parseArgs({
    args: argv,
    options: {
      mode: { type: "string" },
      prompt: { type: "string" },
      cwd: { type: "string" },
      name: { type: "string" },
      wait: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const mode = requireMode(values.mode);
  const callerPrompt = readPromptFile(values.prompt);
  const cwd = resolve(values.cwd ?? process.cwd());
  const name = values.name ?? (values.prompt ?? "run").split("/").pop()!.replace(/\.md$/, "");

  const composed = composePrompt(callerPrompt, mode);
  const { dir, meta } = createRun(name, mode, cwd, composed);
  const shellCmd = buildShellCommand(buildClaudeArgs(mode), dir, cwd);

  if (values["dry-run"]) {
    console.log(shellCmd);
    return;
  }
  ensureClaudeOnPath();

  if (values.wait) {
    console.log(`run: ${dir} (foreground)`);
    launchAndWait(shellCmd, dir, meta);
    return;
  }
  meta.pid = launch(shellCmd, false);
  writeMeta(dir, meta);
  console.log(dir);
  console.log(`started pid ${meta.pid} — poll with: workflow.ts status ${dir}`);
}

function launchAndWait(shellCmd: string, dir: string, meta: RunMeta): void {
  const res = spawnSync("/bin/sh", ["-c", shellCmd], { stdio: ["ignore", "ignore", "inherit"] });
  meta.pid = null;
  writeMeta(dir, meta);
  const finalized = finalizeIfNeeded(dir);
  if (res.status !== 0 || finalized.state === "failed") {
    console.error(readFileSync(join(dir, "result.md"), "utf-8"));
    process.exit(1);
  }
  console.log(readFileSync(join(dir, "result.md"), "utf-8"));
}

function cmdStatus(argv: string[]): void {
  const dir = resolveRun(argv[0] ?? fail("usage: status <run>"));
  console.log(finalizeIfNeeded(dir).state);
}

function cmdResult(argv: string[]): void {
  const dir = resolveRun(argv[0] ?? fail("usage: result <run>"));
  const meta = finalizeIfNeeded(dir);
  if (meta.state === "running") fail("run is still in progress");
  const resultFile = meta.resumeCount > 0 ? `result-${meta.resumeCount}.md` : "result.md";
  console.log(readFileSync(join(dir, resultFile), "utf-8"));
  if (meta.state === "failed") process.exit(1);
}

function cmdStop(argv: string[]): void {
  const dir = resolveRun(argv[0] ?? fail("usage: stop <run>"));
  const meta = readMeta(dir);
  if (meta.pid !== null && isPidAlive(meta.pid)) {
    try {
      process.kill(-meta.pid, "SIGTERM");
    } catch {
      process.kill(meta.pid, "SIGTERM");
    }
  }
  meta.state = "failed";
  writeMeta(dir, meta);
  console.log(`stopped ${dir}`);
}

function cmdResume(argv: string[]): void {
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
  const claudeArgs = ["--resume", sessionId, ...buildClaudeArgs(meta.mode)];
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
  meta.pid = launch(shellCmd, values.wait ?? false);
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
      cmdStart(rest);
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
      cmdResume(rest);
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
