import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

const root = resolve(import.meta.dirname, "../..");

interface Mount {
  readonly source?: unknown;
  readonly target?: unknown;
  readonly type?: unknown;
}

interface DevContainer {
  readonly build?: {
    readonly dockerfile?: unknown;
    readonly context?: unknown;
  };
  readonly containerEnv?: Readonly<Record<string, unknown>>;
  readonly mounts?: readonly Mount[];
  readonly postCreateCommand?: unknown;
  readonly postStartCommand?: unknown;
  readonly remoteUser?: unknown;
  readonly updateRemoteUserUID?: unknown;
  readonly init?: unknown;
  readonly privileged?: unknown;
  readonly runArgs?: unknown;
}

describe("development container policy", () => {
  it("pins the base image and complete toolchain while remaining non-root", async () => {
    const [dockerfile, configText] = await Promise.all([
      readFile(resolve(root, ".devcontainer/Dockerfile"), "utf8"),
      readFile(resolve(root, ".devcontainer/devcontainer.json"), "utf8"),
    ]);
    const config = JSON.parse(configText) as DevContainer;

    expect(dockerfile).toMatch(
      /^FROM node:24\.19\.0-trixie-slim@sha256:[0-9a-f]{64} AS node-toolchain$/mu,
    );
    expect(dockerfile).toMatch(
      /^FROM docker:29\.7\.2-cli@sha256:[0-9a-f]{64} AS docker-toolchain$/mu,
    );
    expect(dockerfile).toMatch(
      /^FROM mcr\.microsoft\.com\/devcontainers\/base:2-trixie@sha256:[0-9a-f]{64}$/mu,
    );
    expect(dockerfile).toContain("npm install --global npm@12.0.2");
    expect(dockerfile).toContain("apt-get install --yes --no-install-recommends");
    expect(dockerfile).toContain("chromium");
    expect(dockerfile).toContain("logrotate");
    expect(dockerfile).toContain("python3-venv");
    expect(dockerfile).toContain("socat");
    expect(dockerfile).toContain("xauth");
    expect(dockerfile).toContain("xvfb");
    expect(config.build).toEqual({ dockerfile: "Dockerfile", context: "." });
    expect(config.remoteUser).toBe("vscode");
    expect(config.updateRemoteUserUID).toBe(true);
    expect(config.init).toBe(true);
    expect(config.privileged).toBeUndefined();
    expect(config.runArgs).toBeUndefined();
  });

  it("isolates every platform-specific dependency and generated output per worktree", async () => {
    const config = JSON.parse(
      await readFile(resolve(root, ".devcontainer/devcontainer.json"), "utf8"),
    ) as DevContainer;
    const mounts = config.mounts ?? [];
    const volumeMounts = mounts.filter((mount) => mount.type === "volume");
    const targets = new Set(volumeMounts.map((mount) => mount.target));
    const expectedTargets = [
      "${containerWorkspaceFolder}/node_modules",
      "${containerWorkspaceFolder}/dist",
      "${containerWorkspaceFolder}/coverage",
      "${containerWorkspaceFolder}/.vscode-test",
      "${containerWorkspaceFolder}/.vscode-test-web",
      "${containerWorkspaceFolder}/packages/language-core/lib",
      "${containerWorkspaceFolder}/packages/language-server/lib",
      "${containerWorkspaceFolder}/packages/vscode-client/lib",
      "${containerWorkspaceFolder}/docs-site/node_modules",
      "${containerWorkspaceFolder}/docs-site/dist",
      "${containerWorkspaceFolder}/docs-site/.astro",
      "/home/vscode/.npm",
      "/home/vscode/.cache",
    ];

    expect(volumeMounts).toHaveLength(expectedTargets.length);
    expect(targets).toEqual(new Set(expectedTargets));
    for (const mount of volumeMounts) {
      expect(mount.type).toBe("volume");
      expect(mount.source).toMatch(/^vscode-logrotate-\$\{devcontainerId\}-/u);
    }
    expect(mounts).toContainEqual({
      source: "/var/run/docker.sock",
      target: "/var/run/docker-host.sock",
      type: "bind",
    });
  });

  it("forwards Docker through a user-owned proxy without changing host socket permissions", async () => {
    const [configText, proxy] = await Promise.all([
      readFile(resolve(root, ".devcontainer/devcontainer.json"), "utf8"),
      readFile(resolve(root, ".devcontainer/start-docker-proxy.sh"), "utf8"),
    ]);
    const config = JSON.parse(configText) as DevContainer;

    expect(config.postStartCommand).toEqual(["bash", ".devcontainer/start-docker-proxy.sh"]);
    expect(proxy).toContain("UNIX-LISTEN:$target_socket");
    expect(proxy).toContain("UNIX-CONNECT:$source_socket");
    expect(proxy).toContain("user=vscode,group=vscode");
    expect(proxy).not.toMatch(/ch(?:mod|own).*docker-host\.sock/u);
  });

  it("uses locked installs and verifies tools and isolated mounts", async () => {
    const [configText, postCreate, verify, clean, vitest, webTests] = await Promise.all([
      readFile(resolve(root, ".devcontainer/devcontainer.json"), "utf8"),
      readFile(resolve(root, ".devcontainer/post-create.sh"), "utf8"),
      readFile(resolve(root, ".devcontainer/verify.sh"), "utf8"),
      readFile(resolve(root, "scripts/clean.mjs"), "utf8"),
      readFile(resolve(root, "vitest.config.mts"), "utf8"),
      readFile(resolve(root, "scripts/run-web-tests.mjs"), "utf8"),
    ]);
    const config = JSON.parse(configText) as DevContainer;

    expect(config.postCreateCommand).toEqual(["bash", ".devcontainer/post-create.sh"]);
    expect(config.containerEnv?.["ASTRO_TELEMETRY_DISABLED"]).toBe("1");
    expect(config.containerEnv?.["LOGROTATE_SOURCE"]).toBe(
      "/home/vscode/.cache/vscode-logrotate/upstream",
    );
    expect(postCreate).toContain("npm ci");
    expect(postCreate).toContain("npm --prefix docs-site ci");
    expect(postCreate).not.toMatch(/\bnpm (?:install|i)\b/u);
    expect(verify).toContain('test "$(node --version)" = "v24.19.0"');
    expect(postCreate).toContain("3be1e9ccffe0c2245ed596183c74913d553f9f18");
    expect(verify).toContain('test "$(npm --version)" = "12.0.2"');
    expect(verify).toContain("mountpoint --quiet");
    expect(verify).toContain("docker version");
    expect(verify).toContain("npm run check:upstream");
    expect(verify).toContain("npm run test:installed-logrotate");
    expect(verify).toContain("npm run verify");
    expect(verify).toContain("npm run test:integration");
    expect(verify).toContain("npm run test:web");
    expect(verify).toContain("npm run package");
    expect(verify).toContain("npm run test:vsix:prepared");
    expect(verify).toContain("npm run test:remote:prepared");
    expect(verify).toContain('LOGROTATE_THEME_OUTPUT_DIR="$theme_output" npm run capture:themes');
    expect(verify).toContain("npm --prefix docs-site run build");
    expect(clean).toContain("readdir(directory)");
    expect(clean).toContain('entry.endsWith(".tsbuildinfo")');
    expect(clean).not.toMatch(/rm\(resolve\(root, (?:path|directory)\)/u);
    expect(vitest).toContain('reportsDirectory: "coverage/report"');
    expect(webTests).toContain('testRunnerDataDir: resolve(root, ".vscode-test-web/runtime")');
  });

  it("documents a container workflow that does not depend on host version managers", async () => {
    const [readme, containerReadme, guide] = await Promise.all([
      readFile(resolve(root, "README.md"), "utf8"),
      readFile(resolve(root, ".devcontainer/README.md"), "utf8"),
      readFile(resolve(root, "docs/development-container.md"), "utf8"),
    ]);
    const containerStart = readme.indexOf("### Development container");
    const hostStart = readme.indexOf("### Host setup");

    expect(containerStart).toBeGreaterThanOrEqual(0);
    expect(hostStart).toBeGreaterThan(containerStart);
    const containerWorkflow = readme.slice(containerStart, hostStart);
    expect(containerWorkflow).toContain("Dev Containers: Rebuild and Reopen in Container");
    expect(containerWorkflow).toContain("node --version");
    expect(containerWorkflow).toContain("npm --version");
    expect(containerWorkflow).toContain("npm ci");
    expect(containerWorkflow).toContain("npm run verify");
    expect(containerWorkflow).toContain("bash .devcontainer/verify.sh");
    expect(containerWorkflow).not.toMatch(/\bnvm\b/u);
    expect(readme.slice(hostStart)).toContain("nvm install");
    expect(readme.slice(hostStart)).toContain("nvm use");
    for (const containerDocumentation of [containerReadme, guide]) {
      expect(containerDocumentation).toMatch(/do not run `nvm` in the container/iu);
      expect(containerDocumentation).toContain("node --version");
      expect(containerDocumentation).toContain("npm --version");
      expect(containerDocumentation).toContain("npm ci");
      expect(containerDocumentation).toContain("npm run verify");
    }
  });

  it("builds and scans the container without forwarding runner secrets", async () => {
    const [workflow, ci, installPicket] = await Promise.all([
      readFile(resolve(root, ".github/workflows/devcontainer.yml"), "utf8"),
      readFile(resolve(root, ".github/workflows/ci.yml"), "utf8"),
      readFile(resolve(root, ".github/scripts/install-picket.sh"), "utf8"),
    ]);
    const document = parseDocument(workflow);

    expect(document.errors).toEqual([]);
    expect(workflow).toMatch(/^permissions:\n {2}contents: read$/mu);
    expect(workflow).toContain("uses: devcontainers/ci@513af61f4de4f75d37e4438f184ba4358f0fc1ca");
    expect(ci).toContain("uses: willibrandon/picket@cb6cbae0f5c9d35e75642e9ded88a3edaa8d12c8");
    expect(installPicket).toContain('readonly version="0.2.11"');
    expect(installPicket).toContain(
      'readonly expected_sha256="c1d694a56c2eb7844b0145ac31696952c7cf31198ff26b7cf50eb2a3131c3b54"',
    );
    expect(ci).toContain("cache-mode: secret-hash-only");
    expect(ci).toContain("fail-on: findings");
    expect(ci).toContain("redact: 100");
    expect(ci).toContain("timeout: 300");
    expect(workflow).not.toContain("uses: willibrandon/picket@");
    expect(workflow).toContain("inheritEnv: false");
    expect(workflow).toContain("push: never");
    expect(workflow).toContain("docker save vscode-logrotate-devcontainer:ci");
    expect(workflow).toContain("--docker-archive");
    expect(workflow).toContain("--ignore-path .picketignore");
    expect(workflow).toContain("--report-format sarif");
    expect(workflow).toContain("--redact 100");
    expect(workflow).toContain("--max-target-megabytes 64");
    expect(workflow).toContain("--max-archive-depth 2");
    expect(workflow).toContain("--max-archive-entries 100000");
    expect(workflow).toContain("--max-archive-megabytes 4096");
    expect(workflow).toContain("--max-archive-ratio 1000");
    expect(workflow).toContain("--timeout 900");
    expect(workflow).toContain("--exit-code 1");
    expect(workflow).toContain("--no-banner");
    expect(workflow).toContain("if: ${{ always() }}");
    expect(workflow).toContain(
      "uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    );
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("schedule:");
    expect(workflow).not.toContain("secrets.");
  });

  it("suppresses only reviewed image findings by exact fingerprint", async () => {
    const ignore = await readFile(resolve(root, ".picketignore"), "utf8");
    const entries = ignore
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    expect(entries).toHaveLength(28);
    expect(new Set(entries).size).toBe(entries.length);
    for (const entry of entries) {
      expect(entry).toMatch(/^picket:v1:[0-9a-f]{64}$/u);
    }
  });

  it("keeps container dependencies under Dependabot review", async () => {
    const dependabot = await readFile(resolve(root, ".github/dependabot.yml"), "utf8");

    expect(dependabot).toContain("package-ecosystem: docker");
    expect(dependabot).toContain("directory: /.devcontainer");
    for (const dependency of ["node", "docker", "mcr.microsoft.com/devcontainers/base"]) {
      expect(dependabot).toContain(`dependency-name: ${dependency}`);
    }
    expect(dependabot.match(/version-update:semver-(?:major|minor|patch)/gu)).toHaveLength(10);
  });
});
