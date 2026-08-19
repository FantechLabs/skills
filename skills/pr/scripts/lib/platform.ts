import { execSync } from "node:child_process";
import type { Platform } from "./types";

export function getRemoteUrl(cwd: string): string | null {
  try {
    return execSync("git remote get-url origin", { cwd, encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

/**
 * Detect platform from origin remote URL.
 */
export function detectPlatform(cwd: string): Platform {
  const url = getRemoteUrl(cwd);
  if (!url) return "unknown";

  if (url.includes("github.com") || url.includes("github:")) return "github";
  if (url.includes("gitlab.com") || url.includes("gitlab:")) return "gitlab";

  return "unknown";
}

/**
 * Whether gh CLI is available and authenticated.
 */
export function isGhAvailable(cwd: string): boolean {
  try {
    execSync("gh auth status", { cwd, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether glab CLI is available and authenticated.
 */
export function isGlabAvailable(cwd: string): boolean {
  try {
    execSync("glab auth status", { cwd, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Human-friendly platform/CLI readiness error.
 */
export function getPlatformReadinessError(platform: Platform, cwd: string): string | null {
  if (platform === "unknown") {
    return "Unsupported or undetected git host. Supported hosts: GitHub and GitLab.";
  }

  if (platform === "github" && !isGhAvailable(cwd)) {
    return "gh CLI not available or not authenticated. Run: gh auth login";
  }

  if (platform === "gitlab" && !isGlabAvailable(cwd)) {
    return "glab CLI not available or not authenticated. Run: glab auth login";
  }

  return null;
}
