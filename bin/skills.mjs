#!/usr/bin/env node

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, "..");
const cliPath = join(packageRoot, "src", "cli.ts");

async function bootstrap() {
  const cliUrl = pathToFileURL(cliPath).href;

  if (process.versions.bun) {
    await import(cliUrl);
    return;
  }

  await import("tsx");
  await import(cliUrl);
}

bootstrap().catch((error) => {
  console.error(
    "Failed to start @fantech/skills CLI:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
