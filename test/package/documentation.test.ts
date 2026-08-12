import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const requiredDocuments = [
  "README.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "SUPPORT.md",
  "LICENSE",
  "THIRD-PARTY-NOTICES.md",
  "docs/architecture.md",
  "docs/directives.md",
  "docs/grammar.md",
  "docs/performance.md",
  "docs/remote-smoke.md",
  "docs/release-checklist.md",
  "docs/security.md",
  "docs/theme-smoke.md",
  "package.nls.json",
] as const;
const themeImages = [
  "dark-plus.png",
  "light-plus.png",
  "high-contrast.png",
  "github-dark.png",
  "dracula.png",
  "one-dark-pro.png",
] as const;
const docsSiteDocuments = [
  "docs-site/src/content/docs/index.md",
  "docs-site/src/content/docs/getting-started.md",
  "docs-site/src/content/docs/recognized-files.md",
  "docs-site/src/content/docs/editing.md",
  "docs-site/src/content/docs/validation.md",
  "docs-site/src/content/docs/settings.md",
  "docs-site/src/content/docs/commands.md",
  "docs-site/src/content/docs/privacy-and-trust.md",
  "docs-site/src/content/docs/troubleshooting.md",
] as const;

describe("documentation contract", () => {
  it("ships every required user, contributor, maintenance, legal, and localization document", async () => {
    for (const path of requiredDocuments) {
      expect((await stat(resolve(root, path))).isFile(), path).toBe(true);
    }
  });

  it("documents associations, capabilities, validation boundaries, versions, commands, and troubleshooting", async () => {
    const readme = await readFile(resolve(root, "README.md"), "utf8");

    for (const association of [
      "logrotate.conf",
      "logrotate.d",
      "*.logrotate",
      "*.logrotate.conf",
      "logrotate.status",
      "logrotate/status",
      "files.associations",
    ]) {
      expect(readme, association).toContain(association);
    }
    for (const setting of [
      "logrotate.validation.enable",
      "logrotate.validation.maxProblems",
      "logrotate.targetVersion",
      "logrotate.externalValidation.mode",
      "logrotate.executablePath",
      "logrotate.trace.server",
    ]) {
      expect(readme, setting).toContain(setting);
    }
    for (const command of [
      "Validate Current File with Installed Logrotate",
      "Restart Language Server",
      "Show Language Server Output",
      "Open Directive Documentation",
    ]) {
      expect(readme, command).toContain(command);
    }
    expect(readme).toContain("## Supported logrotate versions");
    expect(readme).toMatch(/\| `3\.22`\s+\|/u);
    expect(readme).toContain("## Troubleshooting");
    expect(readme).toContain("Restricted Mode");
    expect(readme).toContain("Browser and virtual workspaces");
    expect(readme).toContain("secondary opinion, not the extension parser or formatter");
    expect(readme).toContain("no telemetry and makes no runtime network requests");
    expect(readme).toContain(
      "https://marketplace.visualstudio.com/items?itemName=willibrandon.logrotate",
    );
  });

  it("keeps the user site complete, concise, and independent from maintainer identity", async () => {
    const documents = await Promise.all(
      docsSiteDocuments.map(
        async (path) => [path, await readFile(resolve(root, path), "utf8")] as const,
      ),
    );
    const combined = documents.map(([, source]) => source).join("\n");

    for (const setting of [
      "logrotate.validation.enable",
      "logrotate.validation.maxProblems",
      "logrotate.targetVersion",
      "logrotate.externalValidation.mode",
      "logrotate.executablePath",
      "logrotate.trace.server",
    ]) {
      expect(combined, setting).toContain(setting);
    }
    for (const command of [
      "Validate Current File with Installed Logrotate",
      "Restart Language Server",
      "Show Language Server Output",
      "Open Directive Documentation",
    ]) {
      expect(combined, command).toContain(command);
    }

    for (const [path, source] of documents) {
      const body = source.replace(/^---\n[\s\S]*?\n---\n/u, "");
      expect(body, `${path} has no section headings`).toMatch(/^##\s/mu);
      expect(body, `${path} contains an extra top-level heading`).not.toMatch(/^#\s/mu);
      expect(body, `${path} contains an overly nested heading`).not.toMatch(/^#{3,6}\s/mu);
      expect(body, `${path} contains a Markdown list`).not.toMatch(/^\s*[-*+]\s/mu);
      expect(source, `${path} contains a dash character outside plain punctuation`).not.toMatch(
        /[–—]/u,
      );
      expect(source, `${path} contains the maintainer's full name`).not.toContain(
        "Brandon Williams",
      );
    }
  });

  it("configures the user site for its GitHub Pages subpath", async () => {
    const config = await readFile(resolve(root, "docs-site/astro.config.mjs"), "utf8");
    const gettingStarted = await readFile(
      resolve(root, "docs-site/src/content/docs/getting-started.md"),
      "utf8",
    );
    const manifest = JSON.parse(
      await readFile(resolve(root, "docs-site/package.json"), "utf8"),
    ) as Readonly<Record<string, unknown>>;

    expect(config).toContain('site: "https://willibrandon.github.io"');
    expect(config).toContain('base: "/vscode-logrotate"');
    expect(config).toContain('trailingSlash: "always"');
    expect(config).toContain('layout: "constrained"');
    expect(config).toContain("responsiveStyles: true");
    expect(config).toContain('"../syntaxes/logrotate.tmLanguage.json"');
    expect(config).toContain("langs: [logrotateLanguage]");
    expect(gettingStarted).toContain("```logrotate");
    expect(manifest).toMatchObject({ private: true, packageManager: "npm@11.17.0" });
  });

  it("keeps committed visual-smoke evidence complete, bounded, and linked from the README", async () => {
    const readme = await readFile(resolve(root, "README.md"), "utf8");
    const evidence = await readFile(resolve(root, "docs/theme-smoke.md"), "utf8");

    expect(readme).toContain("docs/images/dracula.png");
    expect(readme).toContain("docs/theme-smoke.md");
    for (const image of themeImages) {
      const bytes = await readFile(resolve(root, "docs/images", image));
      expect(bytes.subarray(0, 8).toString("hex"), image).toBe("89504e470d0a1a0a");
      expect(bytes.readUInt32BE(16), image).toBe(2_000);
      expect(bytes.readUInt32BE(20), image).toBe(620);
      expect(bytes.byteLength, image).toBeLessThan(100_000);
      expect(evidence, image).toContain(`images/${image}`);
    }
    const packagedFiles = JSON.parse(
      await readFile(resolve(root, "scripts/package-files.json"), "utf8"),
    ) as string[];
    expect(packagedFiles).not.toContain("docs/images/dark-plus.png");
  });

  it("resolves every relative Markdown link in maintained prose", async () => {
    for (const path of requiredDocuments.filter((path) => path.endsWith(".md"))) {
      const source = await readFile(resolve(root, path), "utf8");
      for (const [, target] of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
        if (target === undefined || /^(?:https?:|mailto:|#)/u.test(target)) continue;
        const localPath = target.split("#", 1)[0];
        if (localPath === undefined || localPath === "") continue;
        expect(
          (await stat(resolve(root, dirname(path), localPath))).isFile(),
          `${path}: ${target}`,
        ).toBe(true);
      }
    }
  });

  it("provides a localized value for every manifest placeholder", async () => {
    const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as unknown;
    const localization = JSON.parse(
      await readFile(resolve(root, "package.nls.json"), "utf8"),
    ) as Readonly<Record<string, unknown>>;
    const placeholders = [...JSON.stringify(manifest).matchAll(/%([^%]+)%/gu)].map(
      ([, key]) => key,
    );

    expect(placeholders.length).toBeGreaterThan(0);
    for (const key of placeholders) {
      expect(localization, key).toHaveProperty(key ?? "");
      expect(localization[key ?? ""], key).toEqual(expect.any(String));
    }
  });
});
