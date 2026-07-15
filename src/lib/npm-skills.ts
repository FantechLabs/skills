import { createHash, timingSafeEqual } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extract as extractTar } from "tar";

import { discoverBundledSkills, type SkillInfo } from "./skills.js";

const PACKAGE_NAME = "@fantechlabs/skills";
const DEFAULT_REGISTRY_URL = "https://registry.npmjs.org";
const SUPPORTED_INTEGRITY_ALGORITHMS = new Set(["sha512", "sha384", "sha256"]);

interface PackageMetadata {
  dist: {
    integrity: string;
    tarball: string;
  };
  name: string;
  version: string;
}

export interface LatestSkillPackage {
  cleanup(): void;
  packageRoot: string;
  packageVersion: string;
  skills: SkillInfo[];
}

export interface LoadLatestSkillPackageOptions {
  fetchImpl?: typeof fetch;
  registryUrl?: string;
}

export async function loadLatestSkillPackage(
  options: LoadLatestSkillPackageOptions = {},
): Promise<LatestSkillPackage> {
  let packageRoot: string | undefined;

  try {
    const fetchImpl = options.fetchImpl ?? fetch;
    const registryUrl = (
      options.registryUrl ??
      process.env.npm_config_registry ??
      DEFAULT_REGISTRY_URL
    ).replace(/\/+$/, "");
    const metadataUrl = `${registryUrl}/${encodeURIComponent(PACKAGE_NAME)}/latest`;
    const metadataResponse = await fetchImpl(metadataUrl);

    if (!metadataResponse.ok) {
      throw new Error(`npm metadata request failed with HTTP ${metadataResponse.status}`);
    }

    let metadataBody: unknown;
    try {
      metadataBody = await metadataResponse.json();
    } catch (error) {
      throw new Error("npm metadata response was not valid JSON", { cause: error });
    }

    const metadata = validatePackageMetadata(metadataBody);
    const tarballResponse = await fetchImpl(metadata.dist.tarball);
    if (!tarballResponse.ok) {
      throw new Error(`npm tarball request failed with HTTP ${tarballResponse.status}`);
    }

    const tarballBytes = Buffer.from(await tarballResponse.arrayBuffer());
    verifyIntegrity(tarballBytes, metadata.dist.integrity);

    packageRoot = mkdtempSync(join(tmpdir(), "fantech-skills-"));
    const tarballPath = join(packageRoot, "package.tgz");
    writeFileSync(tarballPath, tarballBytes);

    await extractTar({
      cwd: packageRoot,
      file: tarballPath,
      preservePaths: false,
      strip: 1,
    });

    const skills = discoverBundledSkills(packageRoot);
    const loadedPackageRoot = packageRoot;
    let cleanedUp = false;

    return {
      cleanup() {
        if (cleanedUp) {
          return;
        }
        cleanedUp = true;
        rmSync(loadedPackageRoot, { recursive: true, force: true });
      },
      packageRoot: loadedPackageRoot,
      packageVersion: metadata.version,
      skills,
    };
  } catch (error) {
    if (packageRoot) {
      rmSync(packageRoot, { recursive: true, force: true });
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load latest npm skill package: ${message}`, { cause: error });
  }
}

function validatePackageMetadata(value: unknown): PackageMetadata {
  if (!isRecord(value)) {
    throw new Error("npm metadata must be an object");
  }
  if (value.name !== PACKAGE_NAME) {
    throw new Error(`npm metadata package name must be ${PACKAGE_NAME}`);
  }
  if (typeof value.version !== "string" || value.version.length === 0) {
    throw new Error("npm metadata package version must be a non-empty string");
  }
  if (!isRecord(value.dist)) {
    throw new Error("npm metadata dist must be an object");
  }
  if (typeof value.dist.tarball !== "string" || value.dist.tarball.length === 0) {
    throw new Error("npm metadata tarball URL must be a non-empty string");
  }
  if (typeof value.dist.integrity !== "string" || value.dist.integrity.length === 0) {
    throw new Error("npm metadata integrity must be a non-empty string");
  }

  return {
    name: value.name,
    version: value.version,
    dist: {
      tarball: value.dist.tarball,
      integrity: value.dist.integrity,
    },
  };
}

function verifyIntegrity(bytes: Buffer, integrity: string): void {
  const separator = integrity.indexOf("-");
  const algorithm = integrity.slice(0, separator);
  const encodedDigest = integrity.slice(separator + 1);

  if (
    separator <= 0 ||
    !SUPPORTED_INTEGRITY_ALGORITHMS.has(algorithm) ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encodedDigest)
  ) {
    throw new Error("npm tarball integrity is malformed or uses an unsupported algorithm");
  }

  const expectedDigest = Buffer.from(encodedDigest, "base64");
  const actualDigest = createHash(algorithm).update(bytes).digest();
  if (
    expectedDigest.length !== actualDigest.length ||
    !timingSafeEqual(actualDigest, expectedDigest)
  ) {
    throw new Error("npm tarball integrity mismatch");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
