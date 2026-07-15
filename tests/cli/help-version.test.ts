import { describe, expect, it } from "vitest";

import { runNodeCli } from "../utils/exec";

describe("cli help and version", () => {
  it("shows help output", () => {
    const result = runNodeCli(["--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("@fantechlabs/skills");
    expect(result.stdout).not.toContain("@fantech/skills");
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("skills <command>");
    expect(result.stdout).toContain("update [skills...]");
    expect(result.stdout).toContain("remove [skills...]");
    expect(result.stdout).not.toContain("coming soon");
  });

  it("shows semantic version", () => {
    const result = runNodeCli(["--version"]);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+(-[\w.-]+)?(\+[\w.-]+)?$/);
  });

  it("shows complete update command help", () => {
    const result = runNodeCli(["update", "--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("skills update [skills...]");
    expect(result.stdout).toContain("--agent <agent>");
    expect(result.stdout).toContain("--global");
    expect(result.stdout).toContain("--ruler");
    expect(result.stdout).toContain("--yes");
    expect(result.stdout).toContain("--skip-deps");
    expect(result.stdout).toMatch(/npm.*latest/i);
    expect(result.stdout).toMatch(/never downgrades/i);
  });

  it("shows complete remove command help", () => {
    const result = runNodeCli(["remove", "--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("skills remove [skills...]");
    expect(result.stdout).toContain("--agent <agent>");
    expect(result.stdout).toContain("--global");
    expect(result.stdout).toContain("--ruler");
    expect(result.stdout).toContain("--yes");
    expect(result.stdout).toMatch(/requires explicit skill names/i);
    expect(result.stdout).toMatch(/shared source/i);
  });

  it("errors on unknown command", () => {
    const result = runNodeCli(["unknown-command"]);

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("Unknown command");
  });
});
