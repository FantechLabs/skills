import { resolve } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import * as runtime from "../../skills/pr/scripts/lib/runtime";

describe("PR skill runtime", () => {
  it("resolves sibling skill scripts from the PR entrypoint location", () => {
    const resolveSiblingSkillScript = Reflect.get(runtime, "resolveSiblingSkillScript");

    expect(resolveSiblingSkillScript).toBeTypeOf("function");
    expect(
      resolveSiblingSkillScript(
        "file:///opt/agents/skills/pr/scripts/create.ts",
        "changeset",
        "create.ts",
      ),
    ).toBe(resolve("/opt/agents/skills/changeset/scripts/create.ts"));
  });
});
