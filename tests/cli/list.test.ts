import { describe, expect, it } from "vitest";

import { runNodeCli } from "../utils/exec";

describe("list command", () => {
  it("prints bundled skills", () => {
    const result = runNodeCli(["list"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Available skills:");
    expect(result.stdout).toContain("commit");
    expect(result.stdout).toContain("changeset");
    expect(result.stdout).toContain("release");
  });
});
