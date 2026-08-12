import { describe, expect, it } from "vitest";
import {
  canDetectTargetVersion,
  explainUnavailability,
  externalValidationUnavailable,
  type ValidationContext,
} from "../src/external-validation-policy.js";

const available: ValidationContext = {
  isDesktop: true,
  isTrusted: true,
  scheme: "file",
  isSaved: true,
  languageId: "logrotate",
};

describe("external validation policy", () => {
  it("allows only a saved local logrotate file in a trusted desktop host", () => {
    expect(externalValidationUnavailable(available)).toBeUndefined();
  });

  it.each([
    ["browser", { isDesktop: false }],
    ["untrusted", { isTrusted: false }],
    ["virtual", { scheme: "memfs" }],
    ["unsaved", { isSaved: false }],
    ["wrong-language", { languageId: "plaintext" }],
  ] as const)("reports %s deterministically", (expected, replacement) => {
    expect(externalValidationUnavailable({ ...available, ...replacement })).toBe(expected);
    expect(explainUnavailability(expected)).toBeTypeOf("string");
    expect(explainUnavailability(expected).length).toBeGreaterThan(20);
  });
});

describe("automatic target-version policy", () => {
  it("allows only an explicit auto target in a trusted local desktop host", () => {
    expect(
      canDetectTargetVersion({
        isDesktop: true,
        isTrusted: true,
        scheme: "file",
        targetVersion: "auto",
      }),
    ).toBe(true);
  });

  it.each([
    ["latest target", { targetVersion: "latest" }],
    ["browser host", { isDesktop: false }],
    ["untrusted workspace", { isTrusted: false }],
    ["virtual resource", { scheme: "memfs" }],
    ["missing resource", { scheme: undefined }],
  ] as const)("denies detection for a %s", (_name, replacement) => {
    expect(
      canDetectTargetVersion({
        isDesktop: true,
        isTrusted: true,
        scheme: "file",
        targetVersion: "auto",
        ...replacement,
      }),
    ).toBe(false);
  });
});
