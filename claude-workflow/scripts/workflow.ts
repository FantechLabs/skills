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
  finalizeExited,
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

// suffix distinguishes resumed generations (cmdResume passes `-${n}`) so
// prompt/log/stderr/exit-code filenames line up with resultFileName's
// `result-<n>.md` convention; the default "" keeps the original run's
// unsuffixed prompt.md/log.jsonl/stderr.log/exit-code.
export function buildShellCommand(
  claudeArgs: string[],
  dir: string,
  cwd: string,
  suffix = "",
): string {
  const q = shellQuote;
  const claude = `claude ${claudeArgs.map(q).join(" ")}`;
  return [
    `cd ${q(cwd)}`,
    `&& CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 ${claude}`,
    `< ${q(join(dir, `prompt${suffix}.md`))}`,
    `> ${q(join(dir, `log${suffix}.jsonl`))}`,
    `2> ${q(join(dir, `stderr${suffix}.log`))};`,
    `echo $? > ${q(join(dir, `exit-code${suffix}`))}`,
  ].join(" ");
}

const SUBCOMMANDS = ["start", "status", "result", "stop", "resume", "list"] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

const SUBCOMMAND_SUMMARY: Record<Subcommand, string> = {
  start: "Launch a run (background by default; prints run dir)",
  status: "Print a run's state: running / completed / failed",
  result: "Print the deliverable (exit 1 if failed)",
  stop: "Terminate a run",
  resume: "Follow-up turn in the same session",
  list: "List recent runs",
};

const SUBCOMMAND_USAGE: Record<Subcommand, string> = {
  start: [
    "usage: workflow.ts start --mode <explore|build> --prompt <file> [options]",
    "",
    SUBCOMMAND_SUMMARY.start + ".",
    "",
    "Options:",
    "  --mode <explore|build>           Required. Run mode.",
    "  --prompt <file>                  Required. Prompt file to send.",
    "  --cwd <dir>                      Working directory (default: current dir)",
    "  --name <slug>                    Run name (default: derived from prompt filename)",
    "  --wait                           Run in the foreground and print the result",
    "  --dry-run                        Print the shell command without launching",
    "  --dangerously-skip-permissions   Skip permission prompts (use with caution)",
    "  --max-budget-usd <amount>        Stop the session once this USD budget is spent",
  ].join("\n"),
  status: ["usage: workflow.ts status <run>", "", SUBCOMMAND_SUMMARY.status + "."].join("\n"),
  result: ["usage: workflow.ts result <run>", "", SUBCOMMAND_SUMMARY.result + "."].join("\n"),
  stop: ["usage: workflow.ts stop <run>", "", SUBCOMMAND_SUMMARY.stop + "."].join("\n"),
  resume: [
    "usage: workflow.ts resume <run> --prompt <file> [--wait]",
    "",
    SUBCOMMAND_SUMMARY.resume + ".",
    "",
    "Options:",
    "  --prompt <file>   Required. Follow-up prompt file.",
    "  --wait            Run in the foreground and print the result",
  ].join("\n"),
  list: ["usage: workflow.ts list", "", SUBCOMMAND_SUMMARY.list + "."].join("\n"),
};

function isSubcommand(command: string): command is Subcommand {
  return (SUBCOMMANDS as readonly string[]).includes(command);
}

export function usageText(command?: string): string {
  if (command && isSubcommand(command)) return SUBCOMMAND_USAGE[command];
  return [
    "usage: workflow.ts <command> [options]",
    "",
    "Commands:",
    ...SUBCOMMANDS.map((c) => `  ${c.padEnd(8)} ${SUBCOMMAND_SUMMARY[c]}`),
    "",
    "Run 'workflow.ts <command> --help' for command-specific options.",
  ].join("\n");
}

// Subcommand argv may include --help/-h before we've validated anything else
// (e.g. `start --help` with no --mode/--prompt) — check for it up front so
// help always short-circuits to usage + exit 0 instead of tripping a
// "required flag missing" or parseArgs error first.
function checkHelp(command: Subcommand, argv: string[]): void {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usageText(command));
    process.exit(0);
  }
}

function isParseArgsError(err: unknown): err is NodeJS.ErrnoException {
  if (!(err instanceof Error) || !("code" in err)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  return code === "ERR_PARSE_ARGS_UNKNOWN_OPTION" || code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE";
}

// Wraps a subcommand's parseArgs call so a bad flag (unknown option, invalid
// value) prints `error: <message>` + that subcommand's usage and exits 1 —
// never an uncaught ERR_PARSE_ARGS_* stack trace.
function parseArgsOrFail<T>(command: Subcommand, run: () => T): T {
  try {
    return run();
  } catch (err) {
    if (isParseArgsError(err)) {
      console.error(`error: ${err.message}`);
      console.error(usageText(command));
      process.exit(1);
    }
    throw err;
  }
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
  checkHelp("start", argv);
  const { values } = parseArgsOrFail("start", () =>
    parseArgs({
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
    }),
  );
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
//
// After the exit we OWN the fact that the child is gone, so finalization goes through
// finalizeExited (unconditional, re-reads meta so a concurrent `stop`'s finalization
// isn't clobbered) rather than finalizeIfNeeded, whose pid-liveness/starting-grace
// hedges exist for concurrent observers only — routing through it here would leave a
// child killed before its `echo $? > exit-code` tail (SIGKILL/OOM) stuck "running"
// with no result file for the whole grace period.
export async function launchAndWait(shellCmd: string, dir: string, meta: RunMeta): Promise<void> {
  const child = spawn("/bin/sh", ["-c", shellCmd], {
    detached: true,
    stdio: ["ignore", "ignore", "inherit"],
  });
  if (child.pid === undefined) fail("failed to spawn /bin/sh");
  meta.pid = child.pid;
  writeMeta(dir, meta);

  let exitCode: number;
  try {
    exitCode = await new Promise<number>((resolveExit, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolveExit(code ?? 1));
    });
  } catch (err) {
    finalizeExited(dir);
    fail(`child process error: ${err instanceof Error ? err.message : String(err)}`);
  }

  const finalized = finalizeExited(dir);
  const result = readFileSync(join(dir, resultFileName(finalized.resumeCount)), "utf-8");
  if (exitCode !== 0 || finalized.state === "failed") {
    console.error(result);
    process.exit(1);
  }
  console.log(result);
}

function cmdStatus(argv: string[]): void {
  checkHelp("status", argv);
  const dir = resolveRun(argv[0] ?? fail("usage: status <run>"));
  console.log(finalizeIfNeeded(dir).state);
}

function cmdResult(argv: string[]): void {
  checkHelp("result", argv);
  const dir = resolveRun(argv[0] ?? fail("usage: result <run>"));
  const meta = finalizeIfNeeded(dir);
  if (meta.state === "running") fail("run is still in progress");
  console.log(readFileSync(join(dir, resultFileName(meta.resumeCount)), "utf-8"));
  if (meta.state === "failed") process.exit(1);
}

function cmdStop(argv: string[]): void {
  checkHelp("stop", argv);
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
  checkHelp("resume", argv);
  const runRef = argv[0] ?? fail("usage: resume <run> --prompt <file> [--wait]");
  const { values } = parseArgsOrFail("resume", () =>
    parseArgs({
      args: argv.slice(1),
      options: { prompt: { type: "string" }, wait: { type: "boolean", default: false } },
    }),
  );
  const dir = resolveRun(runRef);
  const meta = finalizeIfNeeded(dir);
  if (meta.state === "running") fail("run is still in progress; wait or stop it first");
  const sessionPath = join(dir, "session-id");
  if (!existsSync(sessionPath)) fail("no session-id recorded; cannot resume");
  const sessionId = readFileSync(sessionPath, "utf-8").trim();

  const n = meta.resumeCount + 1;
  const promptText = readPromptFile(values.prompt);
  const claudeArgs = [
    "--resume",
    sessionId,
    ...buildClaudeArgs(meta.mode, {
      skipPermissions: meta.skipPermissions,
      maxBudgetUsd: meta.maxBudgetUsd ?? undefined,
    }),
  ];
  const shellCmd = buildShellCommand(claudeArgs, dir, meta.cwd, `-${n}`);

  // ensureClaudeOnPath() must run before any of prompt-<n>.md / meta.resumeCount /
  // meta.state are written — otherwise a missing `claude` binary leaves an orphaned
  // prompt-<n>.md and a resumeCount bump behind with no run ever launched.
  ensureClaudeOnPath();

  writeFileSync(join(dir, `prompt-${n}.md`), promptText);
  meta.resumeCount = n;
  meta.state = "running";

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

function cmdList(argv: string[]): void {
  checkHelp("list", argv);
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
    case "--help":
    case "-h":
    case "help":
      console.log(usageText());
      process.exit(0);
      break;
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
      cmdList(rest);
      break;
    case undefined:
      console.error(usageText());
      process.exit(1);
      break;
    default:
      console.error(`error: unknown command "${command}"`);
      console.error(usageText());
      process.exit(1);
  }
}
