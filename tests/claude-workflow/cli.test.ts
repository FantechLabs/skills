import { describe, expect, it } from "vitest";

import {
  buildShellCommand,
  resultFileName,
  shellQuote,
} from "../../claude-workflow/scripts/workflow";

describe("shellQuote", () => {
  it("single-quotes and escapes embedded quotes", () => {
    expect(shellQuote("plain")).toBe("'plain'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
});

describe("buildShellCommand", () => {
  it("cds into cwd, sets the wait-ceiling env var, redirects streams, records exit code", () => {
    const cmd = buildShellCommand(["-p", "--verbose"], "/runs/r1", "/proj");
    expect(cmd).toContain("cd '/proj'");
    expect(cmd).toContain("CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0");
    expect(cmd).toContain("claude '-p' '--verbose'");
    expect(cmd).toContain("< '/runs/r1/prompt.md'");
    expect(cmd).toContain("> '/runs/r1/log.jsonl'");
    expect(cmd).toContain("2> '/runs/r1/stderr.log'");
    expect(cmd).toContain("echo $? > '/runs/r1/exit-code'");
  });

  it("quotes args containing parens (Bash tool patterns)", () => {
    const cmd = buildShellCommand(["--allowedTools", "Bash(git log:*)"], "/runs/r1", "/proj");
    expect(cmd).toContain("'Bash(git log:*)'");
  });
});

describe("resultFileName", () => {
  it("uses result.md for the original run", () => {
    expect(resultFileName(0)).toBe("result.md");
  });

  it("uses the generation suffix for resumed runs", () => {
    expect(resultFileName(1)).toBe("result-1.md");
    expect(resultFileName(3)).toBe("result-3.md");
  });
});
