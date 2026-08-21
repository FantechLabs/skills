import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  fileToPackage,
  getAllPackages,
  getPackageScopes,
} from "../../skills/changeset/scripts/lib/packages";
import { cleanupTempProject, createTempProject } from "../utils/fs";

const tempProjects: string[] = [];

afterEach(() => {
  while (tempProjects.length > 0) {
    const tempProject = tempProjects.pop();
    if (tempProject) {
      cleanupTempProject(tempProject);
    }
  }
});

function setupTempProject(prefix: string): string {
  const tempProject = createTempProject(prefix);
  tempProjects.push(tempProject);
  return tempProject;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

describe("changeset package discovery", () => {
  it("discovers workspace packages from package.json and keeps root package mapping", () => {
    const project = setupTempProject("changeset-package-json-");

    writeJson(join(project, "package.json"), {
      name: "@acme/repo",
      version: "1.0.0",
      private: true,
      workspaces: ["apps/*", "packages/*"],
    });

    mkdirSync(join(project, "apps", "web"), { recursive: true });
    writeJson(join(project, "apps", "web", "package.json"), {
      name: "@acme/web",
      version: "0.1.0",
    });

    mkdirSync(join(project, "packages", "ui"), { recursive: true });
    writeJson(join(project, "packages", "ui", "package.json"), {
      name: "@acme/ui",
      version: "0.2.0",
    });

    const packages = getAllPackages(project);
    const names = packages.map((pkg) => pkg.name);

    expect(names).toContain("@acme/repo");
    expect(names).toContain("@acme/web");
    expect(names).toContain("@acme/ui");

    expect(fileToPackage("README.md", packages)?.name).toBe("@acme/repo");
    expect(fileToPackage("apps/web/src/main.ts", packages)?.name).toBe("@acme/web");
    expect(fileToPackage("packages/ui/src/index.ts", packages)?.name).toBe("@acme/ui");

    const rootPackage = packages.find((pkg) => pkg.isRoot);
    expect(rootPackage).toBeDefined();
    expect(rootPackage?.relativePath).toBe(".");
    expect(getPackageScopes(rootPackage!)).toContain("repo");
  });

  it("discovers workspace packages from pnpm-workspace.yaml and respects excludes", () => {
    const project = setupTempProject("changeset-pnpm-workspace-");

    writeJson(join(project, "package.json"), {
      name: "repo",
      version: "1.0.0",
      private: true,
    });

    writeFileSync(
      join(project, "pnpm-workspace.yaml"),
      `packages:\n  - "packages/*"\n  - "!packages/ignored"\n`,
    );

    mkdirSync(join(project, "packages", "core"), { recursive: true });
    writeJson(join(project, "packages", "core", "package.json"), {
      name: "@acme/core",
      version: "1.2.3",
    });

    mkdirSync(join(project, "packages", "ignored"), { recursive: true });
    writeJson(join(project, "packages", "ignored", "package.json"), {
      name: "@acme/ignored",
      version: "1.2.3",
    });

    const packages = getAllPackages(project);
    const names = packages.map((pkg) => pkg.name);

    expect(names).toContain("repo");
    expect(names).toContain("@acme/core");
    expect(names).not.toContain("@acme/ignored");

    expect(fileToPackage("packages/core/src/index.ts", packages)?.name).toBe("@acme/core");
    expect(fileToPackage("packages/ignored/src/index.ts", packages)?.name).toBe("repo");
  });

  it("falls back to legacy monorepo directories when no workspace config exists", () => {
    const project = setupTempProject("changeset-legacy-layout-");

    writeJson(join(project, "package.json"), {
      name: "repo",
      version: "1.0.0",
      private: true,
    });

    mkdirSync(join(project, "packages", "utils"), { recursive: true });
    writeJson(join(project, "packages", "utils", "package.json"), {
      name: "@acme/utils",
      version: "0.3.0",
    });

    const packages = getAllPackages(project);
    const names = packages.map((pkg) => pkg.name);

    expect(names).toContain("repo");
    expect(names).toContain("@acme/utils");
  });
});
