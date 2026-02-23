import { describe, expect, it } from "vitest";

import { runNodeCli } from "../utils/exec";

describe("reserved commands", () => {
  it("prints coming soon for remove", () => {
    const result = runNodeCli(["remove"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("coming soon");
  });

  it("prints coming soon for update", () => {
    const result = runNodeCli(["update"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("coming soon");
  });
});
