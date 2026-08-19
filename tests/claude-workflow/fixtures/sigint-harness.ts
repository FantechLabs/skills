#!/usr/bin/env bun
// Harness for cli.test.ts's SIGINT integration test. Runs launchAndWait as a real
// subprocess (not by directly delivering a signal to the vitest worker, which would
// be unsafe/flaky) so the test can send this process a genuine SIGINT and observe
// launchAndWait's own signal handling end to end: the long-sleeping detached child
// must die, the run must finalize as failed, and this harness must exit 130.
import { createRun } from "../../../skills/claude-workflow/scripts/lib/runs.js";
import { launchAndWait } from "../../../skills/claude-workflow/scripts/workflow.js";

const { dir, meta } = createRun("sigint-harness", "explore", "/tmp", "PROMPT");
process.stdout.write(`${dir}\n`);
await launchAndWait("sleep 30", dir, meta);
