import { describe, expect, it } from "vitest";
import {
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
  });
});
