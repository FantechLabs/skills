import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { create as createTar } from "tar";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadLatestSkillPackage } from "../../src/lib/npm-skills";
import { createTempProject } from "../utils/fs";

const PACKAGE_NAME = "@fantechlabs/skills";
const REGISTRY_URL = "https://registry.test";
const TARBALL_URL = `${REGISTRY_URL}/skills.tgz`;
const fixtureDirectories: string[] = [];

interface TarballFixture {
  bytes: Buffer;
  integrity: string;
}

afterEach(() => {
  while (fixtureDirectories.length > 0) {
    rmSync(fixtureDirectories.pop()!, { recursive: true, force: true });
  }
});

async function makeTarballFixture(
  skillVersion = "2.0.0",
  algorithm: "sha256" | "sha384" | "sha512" = "sha512",
): Promise<TarballFixture> {
  const fixtureRoot = createTempProject("npm-skills-fixture-");
  fixtureDirectories.push(fixtureRoot);
  const packageRoot = join(fixtureRoot, "package");
  const skillRoot = join(packageRoot, "commit");
  const tarballPath = join(fixtureRoot, "skills.tgz");

  mkdirSync(skillRoot, { recursive: true });
  writeFileSync(
    join(skillRoot, "SKILL.md"),
    [
      "---",
      "name: commit",
      `version: ${skillVersion}`,
      "description: Create a conventional commit",
      "---",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(packageRoot, "package.json"),
    JSON.stringify({ name: PACKAGE_NAME, version: "9.9.9" }),
  );

  await createTar({ cwd: fixtureRoot, file: tarballPath, gzip: true }, ["package"]);
  const bytes = readFileSync(tarballPath);

  return {
    bytes,
    integrity: `${algorithm}-${createHash(algorithm).update(bytes).digest("base64")}`,
  };
}

function metadata(integrity: string): Record<string, unknown> {
  return {
    name: PACKAGE_NAME,
    version: "9.9.9",
    dist: { tarball: TARBALL_URL, integrity },
  };
}

function fetchFor(metadataBody: unknown, tarballBytes: Buffer): typeof fetch {
  return vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify(metadataBody), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    )
    .mockResolvedValueOnce(new Response(tarballBytes, { status: 200 }));
}

function stagingDirectories(): string[] {
  return readdirSync(tmpdir())
    .filter((entry) => entry.startsWith("fantech-skills-"))
    .sort();
}

describe("loadLatestSkillPackage", () => {
  it("uses independent 15-second metadata and 60-second tarball request signals", async () => {
    const fixture = await makeTarballFixture();
    const metadataSignal = new AbortController().signal;
    const tarballSignal = new AbortController().signal;
    const timeoutSignal = vi
      .fn<(milliseconds: number) => AbortSignal>()
      .mockReturnValueOnce(metadataSignal)
      .mockReturnValueOnce(tarballSignal);
    const fetchImpl = fetchFor(metadata(fixture.integrity), fixture.bytes);

    const loaded = await loadLatestSkillPackage({
      fetchImpl,
      registryUrl: REGISTRY_URL,
      timeoutSignal,
    });

    try {
      expect(timeoutSignal).toHaveBeenNthCalledWith(1, 15_000);
      expect(timeoutSignal).toHaveBeenNthCalledWith(2, 60_000);
      expect(fetchImpl).toHaveBeenNthCalledWith(
        1,
        "https://registry.test/%40fantechlabs%2Fskills/latest",
        { signal: metadataSignal },
      );
      expect(fetchImpl).toHaveBeenNthCalledWith(2, TARBALL_URL, { signal: tarballSignal });
      expect(metadataSignal).not.toBe(tarballSignal);
    } finally {
      loaded.cleanup();
    }
  });

  it("reports metadata timeouts without leaving staged temporary state", async () => {
    const before = stagingDirectories();
    const fetchImpl = vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError"));

    await expect(loadLatestSkillPackage({ fetchImpl, registryUrl: REGISTRY_URL })).rejects.toThrow(
      /failed to load latest npm skill package.*timed out/i,
    );

    expect(stagingDirectories()).toEqual(before);
  });

  it("reports tarball timeouts without leaving staged temporary state", async () => {
    const fixture = await makeTarballFixture();
    const before = stagingDirectories();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(metadata(fixture.integrity))))
      .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));

    await expect(loadLatestSkillPackage({ fetchImpl, registryUrl: REGISTRY_URL })).rejects.toThrow(
      /failed to load latest npm skill package.*timed out/i,
    );

    expect(stagingDirectories()).toEqual(before);
  });

  it.each(["sha512", "sha384", "sha256"] as const)(
    "downloads, verifies, and extracts a package using %s integrity",
    async (algorithm) => {
      const fixture = await makeTarballFixture("2.0.0", algorithm);
      const fetchImpl = fetchFor(metadata(fixture.integrity), fixture.bytes);

      const loaded = await loadLatestSkillPackage({ fetchImpl, registryUrl: REGISTRY_URL });

      try {
        expect(fetchImpl).toHaveBeenNthCalledWith(
          1,
          "https://registry.test/%40fantechlabs%2Fskills/latest",
          { signal: expect.any(AbortSignal) },
        );
        expect(fetchImpl).toHaveBeenNthCalledWith(2, TARBALL_URL, {
          signal: expect.any(AbortSignal),
        });
        expect(loaded.packageVersion).toBe("9.9.9");
        expect(loaded.skills.map((skill) => [skill.name, skill.version])).toEqual([
          ["commit", "2.0.0"],
        ]);
        expect(existsSync(loaded.packageRoot)).toBe(true);
      } finally {
        loaded.cleanup();
      }

      expect(existsSync(loaded.packageRoot)).toBe(false);
    },
  );

  it("uses npm_config_registry when no registry URL is provided", async () => {
    const fixture = await makeTarballFixture();
    const fetchImpl = fetchFor(metadata(fixture.integrity), fixture.bytes);
    const previousRegistry = process.env.npm_config_registry;
    process.env.npm_config_registry = "https://env-registry.test/";

    try {
      const loaded = await loadLatestSkillPackage({ fetchImpl });
      loaded.cleanup();
      expect(fetchImpl).toHaveBeenNthCalledWith(
        1,
        "https://env-registry.test/%40fantechlabs%2Fskills/latest",
        { signal: expect.any(AbortSignal) },
      );
    } finally {
      if (previousRegistry === undefined) {
        delete process.env.npm_config_registry;
      } else {
        process.env.npm_config_registry = previousRegistry;
      }
    }
  });

  it("reports a metadata HTTP failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));

    await expect(loadLatestSkillPackage({ fetchImpl, registryUrl: REGISTRY_URL })).rejects.toThrow(
      /npm metadata.*503/i,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports a tarball HTTP failure", async () => {
    const fixture = await makeTarballFixture();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(metadata(fixture.integrity))))
      .mockResolvedValueOnce(new Response("unavailable", { status: 502 }));

    await expect(loadLatestSkillPackage({ fetchImpl, registryUrl: REGISTRY_URL })).rejects.toThrow(
      /npm tarball.*502/i,
    );
  });

  it.each([
    ["wrong package name", { name: "wrong-package" }, /package name/i],
    ["missing package version", { version: undefined }, /package version/i],
    ["invalid package version", { version: 99 }, /package version/i],
    ["missing tarball URL", { dist: { tarball: undefined } }, /tarball/i],
    ["invalid tarball URL", { dist: { tarball: 99 } }, /tarball/i],
  ])("rejects malformed metadata: %s", async (_caseName, replacement, expectedError) => {
    const fixture = await makeTarballFixture();
    const body = { ...metadata(fixture.integrity), ...replacement };

    await expect(
      loadLatestSkillPackage({
        fetchImpl: fetchFor(body, fixture.bytes),
        registryUrl: REGISTRY_URL,
      }),
    ).rejects.toThrow(expectedError);
  });

  it("rejects metadata that is not valid JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("not-json", { status: 200 }));

    await expect(loadLatestSkillPackage({ fetchImpl, registryUrl: REGISTRY_URL })).rejects.toThrow(
      /npm metadata/i,
    );
  });

  it("rejects a tarball with the wrong integrity", async () => {
    const fixture = await makeTarballFixture();
    const wrongIntegrity = `sha512-${Buffer.alloc(64).toString("base64")}`;

    await expect(
      loadLatestSkillPackage({
        fetchImpl: fetchFor(metadata(wrongIntegrity), fixture.bytes),
        registryUrl: REGISTRY_URL,
      }),
    ).rejects.toThrow(/integrity mismatch/i);
  });

  it("rejects metadata with missing integrity", async () => {
    const fixture = await makeTarballFixture();
    const body = metadata(fixture.integrity) as {
      dist: { integrity?: string; tarball: string };
    };
    delete body.dist.integrity;

    await expect(
      loadLatestSkillPackage({
        fetchImpl: fetchFor(body, fixture.bytes),
        registryUrl: REGISTRY_URL,
      }),
    ).rejects.toThrow(/integrity/i);
  });

  it.each(["md5-deadbeef", "sha512-not-base64!"])(
    "rejects unsupported or malformed integrity: %s",
    async (integrity) => {
      const fixture = await makeTarballFixture();

      await expect(
        loadLatestSkillPackage({
          fetchImpl: fetchFor(metadata(integrity), fixture.bytes),
          registryUrl: REGISTRY_URL,
        }),
      ).rejects.toThrow(/integrity/i);
    },
  );

  it("rejects an invalid latest skill version and removes failed staging", async () => {
    const fixture = await makeTarballFixture("latest");
    const before = stagingDirectories();

    await expect(
      loadLatestSkillPackage({
        fetchImpl: fetchFor(metadata(fixture.integrity), fixture.bytes),
        registryUrl: REGISTRY_URL,
      }),
    ).rejects.toThrow(/invalid skill version/i);

    expect(stagingDirectories()).toEqual(before);
  });

  it("provides idempotent cleanup", async () => {
    const fixture = await makeTarballFixture();
    const loaded = await loadLatestSkillPackage({
      fetchImpl: fetchFor(metadata(fixture.integrity), fixture.bytes),
      registryUrl: REGISTRY_URL,
    });

    loaded.cleanup();
    expect(() => loaded.cleanup()).not.toThrow();
    expect(existsSync(loaded.packageRoot)).toBe(false);
  });
});
