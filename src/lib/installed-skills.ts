import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";

import { readSkillMetadata } from "./skills.js";

export interface InstalledSkill {
  canonicalPath: string;
  installRoot: string;
  isSymlink: boolean;
  name: string;
  path: string;
  version?: string;
}

export function findInstalledSkills(installRoots: string[]): InstalledSkill[] {
  const installed: InstalledSkill[] = [];

  for (const installRoot of new Set(installRoots)) {
    let entries;
    try {
      entries = readdirSync(installRoot, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        continue;
      }

      const path = join(installRoot, entry.name);

      try {
        const isSymlink = lstatSync(path).isSymbolicLink();
        const canonicalPath = realpathSync(path);
        const metadata = readSkillMetadata(canonicalPath);

        installed.push({
          canonicalPath,
          installRoot,
          isSymlink,
          name: metadata.name,
          path,
          version: metadata.version,
        });
      } catch {
        continue;
      }
    }
  }

  return installed.sort(
    (left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path),
  );
}
