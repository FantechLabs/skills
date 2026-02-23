import { describe, expect, it } from "vitest";

import { runNodeCli } from "../utils/exec";

describe("run command routing", () => {
  it("requires a skill name", () => {
    const result = runNodeCli(["run"]);

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("Usage: skills run <skill>");
  });

  it("fails for unknown skills", () => {
    const result = runNodeCli(["run", "not-a-skill"]);

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("Unknown skill");
  });

  it("fails for docs-only skills without scripts", () => {
    // `review` is intentionally docs-only and should not be executable.
    const result = runNodeCli(["run", "review"]);

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("has no executable scripts");
  });

  it("routes known changeset subcommand", () => {
    const result = runNodeCli(["run", "changeset", "validate", "--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: validate-changeset");
  });

  it("supports shorthand skill invocation", () => {
    const result = runNodeCli(["changeset", "validate", "--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: validate-changeset");
  });

  it("fails for unknown changeset subcommand", () => {
    const result = runNodeCli(["run", "changeset", "unknown-subcommand"]);

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("Unknown subcommand for changeset");
  });
});
