import { existsSync } from "node:fs";
import { join } from "node:path";

import type { ReviewBotInfo } from "./types";

/**
 * Detect CodeRabbit configuration in the repository.
 */
export function detectReviewBot(cwd: string): ReviewBotInfo | null {
  const coderabbitPaths = [
    ".coderabbitai.yaml",
    "coderabbit.yaml",
    ".github/coderabbit.yml",
    ".github/coderabbit.yaml",
  ];

  for (const path of coderabbitPaths) {
    if (existsSync(join(cwd, path))) {
      return { name: "coderabbitai", summaryEnabled: true };
    }
  }

  return null;
}
