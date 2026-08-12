import { describe, expect, it } from "vitest";
import { detectLogrotateLanguage } from "../src/language-detection.js";

describe("logrotate content detection", () => {
  it.each([
    ["/var/log/application.log {", "logrotate"],
    ['"/var/log/application output.log" /var/log/second.log {', "logrotate"],
    ["~/logs/application.log { # project policy", "logrotate"],
    ["logrotate state -- version 1", "logrotate-state"],
    ["logrotate state -- version 2", "logrotate-state"],
  ] as const)("recognizes %j as %s", (firstLine, language) => {
    expect(detectLogrotateLanguage(firstLine)).toBe(language);
  });

  it.each([
    "included.conf",
    "function deploy() {",
    "#!/usr/bin/env bash",
    "relative/path.log {",
    "logrotate state -- version 3",
    `${"/var/log/a".padEnd(8193, "a")} {`,
  ])("leaves unrelated or unbounded content unchanged: %j", (firstLine) => {
    expect(detectLogrotateLanguage(firstLine)).toBeUndefined();
  });
});
