import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

interface ExtensionManifest {
  readonly activationEvents?: unknown;
  readonly icon: string;
  readonly contributes: {
    readonly languages: readonly {
      readonly id: string;
      readonly filenames?: readonly string[];
      readonly filenamePatterns?: readonly string[];
      readonly firstLine?: string;
    }[];
    readonly configuration: {
      readonly properties: Readonly<Record<string, unknown>>;
    };
    readonly commands: readonly { readonly command: string }[];
  };
  readonly files: readonly string[];
}

const manifest = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
) as unknown as ExtensionManifest;

describe("extension manifest", () => {
  it("ships the reviewed square PNG icon", async () => {
    expect(manifest.icon).toBe("media/icon.png");
    const icon = await readFile(resolve(root, manifest.icon));
    expect(icon.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(icon.readUInt32BE(16)).toBe(256);
    expect(icon.readUInt32BE(20)).toBe(256);
    expect(icon.byteLength).toBeLessThan(100_000);
  });

  it("declares narrow associations with delayed startup content detection", () => {
    expect(manifest.activationEvents).toEqual(["onStartupFinished"]);
    expect(manifest.activationEvents).not.toContain("*");
    expect(manifest.contributes.languages).toEqual([
      expect.objectContaining({
        id: "logrotate",
        filenames: ["logrotate.conf"],
        filenamePatterns: ["**/logrotate.d/*", "**/*.logrotate", "**/*.logrotate.conf"],
      }),
      expect.objectContaining({
        id: "logrotate-state",
        filenames: ["logrotate.status"],
        filenamePatterns: ["**/logrotate/status"],
        firstLine: "^logrotate state -- version [12]$",
      }),
    ]);
    expect(JSON.stringify(manifest.contributes.languages)).not.toMatch(
      /\*\.conf|\*\.status|"status"/u,
    );

    const configurationLanguage = manifest.contributes.languages.find(
      ({ id }) => id === "logrotate",
    );
    expect(typeof configurationLanguage?.firstLine).toBe("string");
    const firstLine = new RegExp(configurationLanguage?.firstLine ?? "", "u");
    expect(firstLine.test("/var/log/caddy-metrics.log {")).toBe(true);
    expect(firstLine.test('"/var/log/application output.log" /var/log/second.log {')).toBe(true);
    expect(firstLine.test("~/logs/application.log { # project policy")).toBe(true);
    expect(firstLine.test("caddy-metrics-logrotate")).toBe(false);
    expect(firstLine.test("function deploy() {")).toBe(false);
    expect(firstLine.test("/usr/bin/env bash")).toBe(false);
  });

  it("declares four runtime artifacts and honest workspace capabilities", () => {
    expect(manifest).toMatchObject({
      main: "./dist/extension.cjs",
      browser: "./dist/browser.js",
      extensionKind: ["workspace", "ui"],
      engines: { vscode: "^1.102.0" },
      capabilities: {
        virtualWorkspaces: { supported: true },
        untrustedWorkspaces: { supported: "limited" },
      },
    });
    expect(manifest.files).toEqual(
      expect.arrayContaining(["dist/nodeServer.cjs", "dist/browserServer.js"]),
    );
  });

  it("contributes exactly the designed public settings and commands", () => {
    expect(Object.keys(manifest.contributes.configuration.properties).sort()).toEqual(
      [
        "logrotate.validation.enable",
        "logrotate.validation.maxProblems",
        "logrotate.targetVersion",
        "logrotate.externalValidation.mode",
        "logrotate.executablePath",
        "logrotate.trace.server",
      ].sort(),
    );
    expect(manifest.contributes.commands.map(({ command }) => command).sort()).toEqual(
      [
        "logrotate.validateWithInstalledLogrotate",
        "logrotate.restartLanguageServer",
        "logrotate.showLanguageServerOutput",
        "logrotate.openDirectiveDocumentation",
      ].sort(),
    );
  });

  it("keeps language editing rules conservative and theme-neutral", async () => {
    const configuration = JSON.parse(
      await readFile(resolve(root, "language-configuration.json"), "utf8"),
    ) as unknown;

    expect(configuration).toEqual({
      comments: { lineComment: { comment: "#", noIndent: false } },
      brackets: [["{", "}"]],
      autoClosingPairs: [
        { open: "{", close: "}" },
        { open: '"', close: '"', notIn: ["string", "comment"] },
        { open: "'", close: "'", notIn: ["string", "comment"] },
      ],
      surroundingPairs: [
        ["{", "}"],
        ['"', '"'],
        ["'", "'"],
      ],
      indentationRules: {
        increaseIndentPattern: "^.*\\{\\s*(?:#.*)?$",
        decreaseIndentPattern: "^\\s*\\}",
      },
    });
    expect(JSON.stringify(configuration)).not.toMatch(/foreground|background|color/iu);
  });
});
