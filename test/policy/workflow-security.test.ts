import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

const root = resolve(import.meta.dirname, "../..");
const workflowsDirectory = resolve(root, ".github/workflows");
const workflowNames = (await readdir(workflowsDirectory))
  .filter((name) => name.endsWith(".yml"))
  .sort();
const workflows = new Map(
  await Promise.all(
    workflowNames.map(
      async (name) => [name, await readFile(resolve(workflowsDirectory, name), "utf8")] as const,
    ),
  ),
);

function workflow(name: string): string {
  const contents = workflows.get(name);
  if (contents === undefined) throw new Error(`Missing workflow ${name}`);
  return contents;
}

describe("workflow supply-chain policy", () => {
  it("keeps every workflow parseable and every third-party action immutable", () => {
    for (const [name, contents] of workflows) {
      expect(parseDocument(contents).errors, name).toEqual([]);
      const uses = [...contents.matchAll(/^\s*uses:\s*([^\s#]+).*$/gmu)].map(
        ([, action]) => action,
      );
      expect(uses.length, `${name} has no auditable action references`).toBeGreaterThan(0);
      for (const action of uses) {
        expect(action, `${name}: ${action}`).toMatch(/^[^@\s]+@[0-9a-f]{40}$/u);
      }
    }
  });

  it("starts read-only and confines publishing permissions to the protected release job", () => {
    for (const [name, contents] of workflows) {
      expect(contents, name).toMatch(/^permissions:\n {2}contents: read$/mu);
      expect(contents, name).not.toContain("pull_request_target:");
      if (name !== "release.yml") {
        expect(contents, name).not.toContain("contents: write");
        expect(contents, name).not.toContain("id-token: write");
        expect(contents, name).not.toContain("attestations: write");
      }
    }

    const release = workflow("release.yml");
    expect(release).toContain("environment: release");
    expect(release).toContain("attestations: write");
    expect(release).toContain("contents: write");
    expect(release).toContain("id-token: write");
  });

  it("disables persisted checkout credentials everywhere", () => {
    for (const [name, contents] of workflows) {
      const checkoutCount = [...contents.matchAll(/uses: actions\/checkout@/gu)].length;
      const disabledCredentialCount = [...contents.matchAll(/persist-credentials:\s*false/gu)]
        .length;
      expect(disabledCredentialCount, name).toBe(checkoutCount);
    }
  });

  it("tests the declared editor matrix, browser host, pinned oracle, and Insiders warning", () => {
    const ci = workflow("ci.yml");
    expect(ci).toContain("os: [ubuntu-latest, macos-latest, windows-latest]");
    expect(ci).toContain("vscode: [1.100.0, stable]");
    expect(ci).toContain("npm run test:web");
    expect(ci).toContain("npm run test:vsix");
    expect(ci).toContain("ref: 3be1e9ccffe0c2245ed596183c74913d553f9f18");
    expect(ci).toMatch(/insiders:[\s\S]*continue-on-error: true/u);
  });

  it("publishes one checked and attested VSIX through narrowly scoped credentials", () => {
    const release = workflow("release.yml");
    expect(release).toContain("node ./scripts/check-release.mjs");
    expect(release).toContain("subject-path: ${{ env.VSIX_PATH }}");
    expect(release).toContain("sbom-path: ${{ env.SBOM_PATH }}");
    expect(release).toContain('npx vsce publish --packagePath "$VSIX_PATH" --no-dependencies');
    expect(release).toContain("Number(require('./package.json').version.split('.')[1]) % 2 === 1");
    expect(release.match(/PRERELEASE_FLAG\+?=\(\)|PRERELEASE_FLAG=\(\)/gu)).toHaveLength(2);
    expect(release.match(/PRERELEASE_FLAG\+?=\(--pre-release\)/gu)).toHaveLength(1);
    expect(release).toContain("PRERELEASE_FLAG+=(--prerelease)");
    expect(release).toContain('"$VSIX_PATH" "$CHECKSUM_PATH" "$SBOM_PATH"');
    expect(release).toContain("VSCE_PAT: ${{ secrets.VSCE_PAT }}");
    expect(release).not.toMatch(/OVSX|--oidc/u);
    expect(release.indexOf("gh release edit")).toBeGreaterThan(release.indexOf("npx vsce publish"));
  });

  it("keeps scheduled drift detection review-only", () => {
    const drift = workflow("upstream-drift.yml");
    expect(drift).toContain("--report-only");
    expect(drift).toContain("dist/upstream-drift.json");
    expect(drift).not.toMatch(/\b(?:git push|gh issue create)\b/u);
  });

  it("enables dependency review, CodeQL, and reviewed dependency updates", async () => {
    expect(workflow("dependency-review.yml")).toContain("fail-on-severity: moderate");
    expect(workflow("codeql.yml")).toContain("queries: security-and-quality");
    const dependabot = await readFile(resolve(root, ".github/dependabot.yml"), "utf8");
    expect(parseDocument(dependabot).errors).toEqual([]);
    expect(dependabot).toContain("package-ecosystem: npm");
    expect(dependabot).toContain("package-ecosystem: github-actions");
  });
});
