import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import * as p from "@clack/prompts";

export interface RulerDependencies {
  platform?: NodeJS.Platform;
  spawnSync?: typeof spawnSync;
}

export function isRulerProject(cwd: string): boolean {
  return existsSync(join(cwd, ".ruler", "ruler.toml"));
}

export function getRulerSkillsDir(cwd: string): string {
  return join(cwd, ".ruler", "skills");
}

export async function applyRulerAfterChanges(
  options: {
    installPaths: string[];
    interactive: boolean;
    yes: boolean;
  },
  dependencies: RulerDependencies = {},
): Promise<void> {
  const usedRulerInstall = options.installPaths.some((path) =>
    path.replace(/\\/g, "/").includes("/.ruler/skills"),
  );
  if (usedRulerInstall) {
    if (options.interactive && !options.yes) {
      const shouldApply = await p.confirm({
        message: "Run `ruler apply` now to propagate skills to configured agents?",
        initialValue: true,
      });

      if (p.isCancel(shouldApply)) {
        p.cancel("Skipped `ruler apply`.");
      } else if (shouldApply) {
        const spawnSyncImpl = dependencies.spawnSync ?? spawnSync;
        const platform = dependencies.platform ?? process.platform;
        const result = spawnSyncImpl("ruler", ["apply"], {
          shell: platform === "win32",
          stdio: "inherit",
        });
        if (result.error) {
          const code = (result.error as NodeJS.ErrnoException).code;
          if (code === "ENOENT") {
            console.warn("`ruler` command not found. Skipping automatic apply.");
          } else {
            console.warn(`Failed to run \`ruler apply\`: ${result.error.message}`);
          }
        } else if (result.status === null && result.signal) {
          console.warn(`\`ruler apply\` was terminated by signal ${result.signal}.`);
        } else if (typeof result.status === "number" && result.status !== 0) {
          console.warn(`\`ruler apply\` exited with code ${result.status}.`);
        }
      } else {
        console.log("\nRun `ruler apply` to propagate .ruler skills to configured agents.");
      }
    } else {
      console.log("\nRun `ruler apply` to propagate .ruler skills to configured agents.");
    }
  }
}
