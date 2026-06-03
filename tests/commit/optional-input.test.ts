import { describe, expect, it } from "vitest";

import { normalizeOptionalText } from "../../commit/scripts/lib/optional";

describe("normalizeOptionalText", () => {
  it("returns null for empty values", () => {
    expect(normalizeOptionalText("")).toBeNull();
    expect(normalizeOptionalText("   ")).toBeNull();
  });

  it("returns null when value matches a sentinel placeholder", () => {
    expect(normalizeOptionalText("e.g. web, ui, repo", ["e.g. web, ui, repo"])).toBeNull();
    expect(
      normalizeOptionalText("Explain why, not what. Press enter to skip.", [
        "Explain why, not what. Press enter to skip.",
      ]),
    ).toBeNull();
  });

  it("returns trimmed value for real input", () => {
    expect(normalizeOptionalText("  repo  ", ["e.g. web, ui, repo"])).toBe("repo");
    expect(normalizeOptionalText("  Some useful context  ")).toBe("Some useful context");
  });
});
