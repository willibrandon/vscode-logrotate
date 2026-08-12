import { describe, expect, it } from "vitest";
import { latestVersion, resolveTargetVersion, supportedVersions } from "../src/index.js";

describe("target version model", () => {
  it("uses the latest reviewed version by default", () => {
    expect(latestVersion).toBe("3.22");
    expect(supportedVersions.map(({ version }) => version)).toEqual(["3.22"]);
    expect(resolveTargetVersion()).toMatchObject({
      requested: "latest",
      version: "3.22",
      source: "latest",
      known: true,
    });
  });

  it("uses an allowed supported detected version for auto and otherwise falls back", () => {
    expect(resolveTargetVersion("auto", { allowed: true, version: "3.22.0" })).toMatchObject({
      version: "3.22",
      source: "detected",
      known: true,
    });
    for (const detection of [
      { allowed: false, version: "3.22.0" },
      { allowed: true, version: "2.0.0" },
      { allowed: true },
    ]) {
      expect(resolveTargetVersion("auto", detection)).toMatchObject({
        version: "3.22",
        source: "latest",
      });
    }
  });

  it("marks unknown explicit versions conservative instead of inventing incompatibilities", () => {
    expect(resolveTargetVersion("3.22")).toMatchObject({
      version: "3.22",
      source: "explicit",
      known: true,
    });
    expect(resolveTargetVersion("3.10")).toEqual({
      requested: "3.10",
      version: "3.10",
      source: "explicit",
      known: false,
    });
  });
});
