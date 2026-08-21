import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { installPackageDependencies } from "../../src/lib/package-manager";
import { cleanupTempProject, createTempProject } from "../utils/fs";

describe("package dependency installation", () => {
  it("reports a missing package directory before spawning the package manager", () => {
    const tempDir = createTempProject();
    const missingPackageDir = join(tempDir, "missing", "scripts");

    try {
      expect(() => installPackageDependencies("npm", missingPackageDir)).toThrow(
        `Cannot install dependencies: package directory does not exist: ${missingPackageDir}`,
      );
    } finally {
      cleanupTempProject(tempDir);
    }
  });
});
