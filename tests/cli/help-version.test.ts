import { describe, expect, it } from "vitest";

import { runNodeCli } from "../utils/exec";

describe("cli help and version", () => {
  it("shows help output", () => {
    const result = runNodeCli(["--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("skills <command>");
  });

  it("shows semantic version", () => {
    const result = runNodeCli(["--version"]);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("errors on unknown command", () => {
    const result = runNodeCli(["unknown-command"]);

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("Unknown command");
  });
});
