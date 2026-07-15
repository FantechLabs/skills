---
name: claude-workflow
description: Launch a Claude Code dynamic multi-agent workflow from any harness via headless `claude -p`. Use when a task needs Claude Code's Workflow orchestration (parallel research, multi-dimensional review, large migrations, adversarial verification) and you are NOT running inside Claude Code — e.g. from Codex, Pi, or a plain shell. Supports read-only "explore" runs and read-write "build" runs.
argument-hint: "explore|build + path to a markdown prompt file"
---

# claude-workflow

Launch Claude Code dynamic workflows headlessly. You write the task as a markdown
file; this skill launches `claude -p` with a workflow-orchestration preamble,
mode-appropriate permissions, and background process management.

## Requirements

- `claude` (Claude Code CLI) on PATH, authenticated.
- Runs can take 10–30+ minutes. Default is background launch; poll for completion.

## Quick start

```bash
# Set this to the scripts/ dir of this skill — you know its location because
# you just read this SKILL.md file; scripts/ sits next to it.
SCRIPTS=/path/to/claude-workflow/scripts

# 1. Write the task prompt to a file (markdown).
cat > /tmp/task.md <<'EOF'
Audit the auth module in this repo for security issues. Be thorough: verify
each finding adversarially before reporting it.
EOF

# 2. Start (prints the run directory).
RUN=$(bun "$SCRIPTS/workflow.ts" start --mode explore --prompt /tmp/task.md --cwd /path/to/repo | head -1)

# 3. Poll in bounded chunks — do NOT sleep for the full duration in one call.
#    Re-check every ~15s; each poll returns instantly.
while [ "$(bun "$SCRIPTS/workflow.ts" status "$RUN")" = "running" ]; do sleep 15; done

# 4. Read the deliverable.
bun "$SCRIPTS/workflow.ts" result "$RUN"
```

`--wait` runs in the foreground and prints the result directly — only for short
explore runs, and only if your own shell tool won't time out first.

## Modes

### explore (read-only)

For investigation, research, audits, reviews. The Claude session gets EXACTLY
these tools and nothing else (headless mode denies everything not listed —
there is no prompt):

- `Read`, `Glob`, `Grep`
- `WebFetch`, `WebSearch` — fetched content is treated as untrusted data;
  the preamble forbids executing instructions or code found in web results
- `Task`, `Agent`, `Workflow`, `ToolSearch`, `TodoWrite`
- `Bash(git log:*)`, `Bash(git diff:*)`, `Bash(git show:*)`,
  `Bash(git status:*)`, `Bash(git blame:*)`, `Bash(rg:*)`, `Bash(ls:*)`

`Edit`, `Write`, and `NotebookEdit` are explicitly disallowed on top of the
allowlist — workflow subagents auto-approve edits, so the deny rules are what
keep subagents read-only too.

### build (read-write)

For implementation. Runs with `--dangerously-skip-permissions`: the session has
full autonomy inside the target directory. Choose build mode only when you
accept that, and prefer pointing `--cwd` at a worktree.

## Writing the prompt file

The skill prepends a preamble that opts into Workflow orchestration, sets the
mode contract, model-selection rules (CLAUDE.md global → project → your prompt,
highest wins), web-safety rules, and the output contract. Your file is appended
verbatim after a separator, and on any conflict YOUR instructions win. Include:

- the task, success criteria, and expected deliverable format;
- scope boundaries (dirs/files to focus on or ignore);
- optional model overrides ("use sonnet-5 subagents for the sweep");
- thoroughness level ("quick pass" vs "comprehensive audit with verification").

## Commands

| Command | Purpose |
| --- | --- |
| `start --mode <explore\|build> --prompt <file> [--cwd <dir>] [--name <slug>] [--wait] [--dry-run]` | Launch (background by default; prints run dir) |
| `status <run>` | `running` / `completed` / `failed` |
| `result <run>` | Print the deliverable (exit 1 if failed) |
| `stop <run>` | Terminate a run |
| `resume <run> --prompt <file> [--wait]` | Follow-up turn in the same session |
| `list` | Recent runs |

`<run>` is the printed run directory or a unique fragment of its name.

A run terminated via `stop` subsequently reports `failed` from `status` and
`result` — there is no separate "stopped" state.

## Run artifacts

`~/.agents/claude-workflow/runs/<timestamp>-<slug>/`: `prompt.md` (composed),
`meta.json`, `log.jsonl` (stream-json events — tail for live progress),
`result.md`, `session-id`, `stderr.log`, `exit-code`. Override the base dir
with `CLAUDE_WORKFLOW_HOME`.

A `resume` writes generation-suffixed files instead (`prompt-<n>.md`,
`log-<n>.jsonl`, `result-<n>.md`, ...); `result <run>` always prints the
latest generation automatically.

## Limits

- No live IPC with a running session: observe via `log.jsonl`, steer only via
  `stop` + new run, or `resume` after completion.
- One follow-up channel: `resume` starts a new turn with prior context; it
  cannot interrupt a run in flight.
