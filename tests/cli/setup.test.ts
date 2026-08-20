import { execFileSync } from "node:child_process";
import { mkdirSync, readlinkSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { cleanupTempProject, createTempProject } from "../utils/fs";

describe("setup script", () => {
  it("links bundled skills from the repository skills directory", () => {
    const home = createTempProject();
    const repositoryRoot = resolve(import.meta.dirname, "../..");

    try {
      mkdirSync(join(home, ".agents"), { recursive: true });

      execFileSync("bash", [join(repositoryRoot, "setup.sh")], {
        cwd: repositoryRoot,
        env: { ...process.env, HOME: home },
        stdio: "pipe",
      });

      expect(readlinkSync(join(home, ".agents", "skills", "commit"))).toBe(
        join(repositoryRoot, "skills", "commit"),
      );
    } finally {
      cleanupTempProject(home);
    }
  });
});
