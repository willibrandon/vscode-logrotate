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

  it("tests the declared editor matrix, browser and remote hosts, pinned oracle, and Insiders warning", async () => {
    const ci = workflow("ci.yml");
    const remoteDockerfile = await readFile(resolve(root, "test/remote/Dockerfile"), "utf8");
    const remoteRunner = await readFile(resolve(root, "scripts/run-remote-ssh-smoke.mjs"), "utf8");
    expect(ci).toContain("os: [ubuntu-latest, macos-latest, windows-latest]");
    expect(ci).toContain("vscode: [1.102.0, stable]");
    expect(ci).toContain("npm run test:web");
    expect(ci).toContain("npm run test:vsix");
    expect(ci).toContain("dist/test/desktop/extension.test.cjs");
    expect(ci).toContain("dist/test/web/index.cjs");
    expect(ci).toMatch(/remote_ssh:[\s\S]*name: Remote SSH host[\s\S]*needs: package/u);
    expect(ci).toContain("npm run test:remote");
    expect(ci).toContain("name: remote-ssh-smoke");
    expect(ci).toMatch(/Upload remote extension-host evidence\n\s+if: always\(\)/u);
    expect(ci).toContain("ref: 3be1e9ccffe0c2245ed596183c74913d553f9f18");
    expect(ci).toMatch(/insiders:[\s\S]*continue-on-error: true/u);
    expect(remoteDockerfile).toMatch(/^FROM debian:trixie-slim@sha256:[0-9a-f]{64}$/mu);
    expect(remoteRunner).toContain('"ssh-remote"');
    expect(remoteRunner).toContain("expectedRemoteExtensionPath");
    expect(remoteRunner).toContain("findRemoteCodeServer");
    expect(remoteRunner).toContain("bootstrapUserDataDirectory");
    expect(remoteRunner).toContain('"BatchMode=yes"');
    expect(remoteRunner).toContain("300_000");
    expect(remoteRunner).toMatch(/launchRemoteCode\(\s+vscodeExecutable,/u);
    expect(remoteRunner).toContain('"--disable-gpu-sandbox"');
    expect(remoteRunner).toContain("/dist/nodeServer.cjs");
    expect(remoteRunner).toContain("[logrotate 3.22.0 on this host]");
    expect(remoteRunner).not.toContain("secrets.");
  });

  it("builds the pinned stable validation oracle with its signed version tag available", () => {
    const release = workflow("release.yml");
    const checkout =
      /- name: Check out supported logrotate 3\.22\.0 validation oracle[\s\S]*?(?=\n {6}- name:)/u.exec(
        release,
      )?.[0];

    expect(checkout).toBeDefined();
    expect(checkout).toContain("repository: logrotate/logrotate");
    expect(checkout).toContain("ref: 41efb71b765b08e53e2c411e0a2897d30f44eefc");
    expect(checkout).toContain("path: .logrotate-3.22");
    expect(checkout).toContain("fetch-depth: 0");
    expect(checkout).toContain("persist-credentials: false");
    expect(release).toContain("working-directory: .logrotate-3.22");
    expect(release).toContain(
      "LOGROTATE_EXECUTABLE: ${{ github.workspace }}/.logrotate-3.22/logrotate",
    );
    expect(release).toContain("LOGROTATE_SOURCE: ${{ github.workspace }}/.upstream");
  });

  it("publishes one checked and attested VSIX through narrowly scoped credentials", async () => {
    const release = workflow("release.yml");
    const installedValidation = await readFile(
      resolve(root, "scripts/check-installed-logrotate.mjs"),
      "utf8",
    );
    const marketplaceVerifier = await readFile(
      resolve(root, "scripts/verify-marketplace-release.mjs"),
      "utf8",
    );
    expect(release).toContain("node ./scripts/check-release.mjs");
    expect(release).toContain("npm run test:installed-logrotate");
    expect(release).toContain('LOGROTATE_EXPECTED_VERSION: "3.22"');
    expect(installedValidation).toContain('["--debug", "--state", "/dev/null", configPath]');
    expect(installedValidation).not.toMatch(/shell\s*:/u);
    expect(release).toContain("subject-path: ${{ env.VSIX_PATH }}");
    expect(release).toContain("sbom-path: ${{ env.SBOM_PATH }}");
    expect(release).toContain("npx vsce verify-pat willibrandon");
    expect(release).toContain('npx vsce publish --packagePath "$VSIX_PATH" --no-dependencies');
    expect(release).toContain("npm run verify:marketplace");
    expect(marketplaceVerifier).toContain("Microsoft.VisualStudio.Services.VsixSha256");
    expect(marketplaceVerifier).toContain('createHash("sha256")');
    expect(release).toContain("Number(require('./package.json').version.split('.')[1]) % 2 === 1");
    expect(release.match(/PRERELEASE_FLAG\+?=\(\)|PRERELEASE_FLAG=\(\)/gu)).toHaveLength(2);
    expect(release.match(/PRERELEASE_FLAG\+?=\(--pre-release\)/gu)).toHaveLength(1);
    expect(release).toContain("PRERELEASE_FLAG+=(--prerelease)");
    expect(release).toContain('"$VSIX_PATH" "$CHECKSUM_PATH" "$SBOM_PATH"');
    expect(release).toContain("VSCE_PAT: ${{ secrets.VSCE_PAT }}");
    expect(release).not.toMatch(/OVSX|--oidc/u);
    const marketplacePublish = release.indexOf("npx vsce publish");
    const marketplaceVerification = release.indexOf("npm run verify:marketplace");
    const githubPublication = release.indexOf('gh release edit "$GITHUB_REF_NAME" --draft=false');
    expect(marketplacePublish).toBeGreaterThan(-1);
    expect(marketplaceVerification).toBeGreaterThan(marketplacePublish);
    expect(githubPublication).toBeGreaterThan(marketplaceVerification);
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
