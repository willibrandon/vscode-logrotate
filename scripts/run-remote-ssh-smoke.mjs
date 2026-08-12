import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import {
  downloadAndUnzipVSCode,
  resolveCliPathFromVSCodeExecutablePath,
} from "@vscode/test-electron";

const executeFile = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const vsix = resolve(root, process.env.VSIX_PATH ?? `dist/logrotate-${manifest.version}.vsix`);
const remoteSshVersion = "0.124.0";
if (process.platform !== "linux") {
  throw new Error("The Remote SSH smoke test requires a Linux Docker host.");
}
const temporaryRoot = await mkdtemp(join(tmpdir(), "vscode-logrotate-remote-"));
const artifactDirectory = resolve(root, "dist/remote-smoke");
const container = `vscode-logrotate-remote-${process.pid}`;
const image = `${container}:test`;
const extensionIdentifier = `${manifest.publisher}.${manifest.name}`;
const expectedRemoteExtensionPath = `/home/vscode/.vscode-server/extensions/${extensionIdentifier}-${manifest.version}`;
const key = resolve(temporaryRoot, "id_ed25519");
const sshConfig = resolve(temporaryRoot, "ssh-config");
const userDataDirectory = resolve(temporaryRoot, "user-data");
const extensionsDirectory = resolve(temporaryRoot, "extensions");
const probeVsix = resolve(temporaryRoot, "logrotate-remote-smoke-probe.vsix");
const resultPath = "/home/vscode/workspace/.remote-smoke-result.json";
const remoteVsix = `/home/vscode/${basename(vsix)}`;
const remoteProbeVsix = "/home/vscode/logrotate-remote-smoke-probe.vsix";
let bootstrapProcess;
let smokeProcess;
let containerStarted = false;

try {
  await requireFile(vsix);
  await Promise.all([
    mkdir(resolve(userDataDirectory, "User"), { recursive: true }),
    mkdir(extensionsDirectory, { recursive: true }),
    rm(artifactDirectory, { recursive: true, force: true }).then(() =>
      mkdir(artifactDirectory, { recursive: true }),
    ),
  ]);
  await run("docker", ["info"]);
  await run("docker", [
    "build",
    "--file",
    resolve(root, "test/remote/Dockerfile"),
    "--tag",
    image,
    resolve(root, "test/remote"),
  ]);
  await run("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key]);
  await run("docker", [
    "run",
    "--detach",
    "--name",
    container,
    "--publish",
    "127.0.0.1::22",
    image,
  ]);
  containerStarted = true;
  await run("docker", ["cp", `${key}.pub`, `${container}:/tmp/ci-key.pub`]);
  await run("docker", [
    "exec",
    container,
    "install",
    "-m",
    "600",
    "-o",
    "vscode",
    "-g",
    "vscode",
    "/tmp/ci-key.pub",
    "/home/vscode/.ssh/authorized_keys",
  ]);
  const { stdout: portOutput } = await run("docker", ["port", container, "22/tcp"]);
  const port = parsePort(portOutput);
  await writeFile(
    sshConfig,
    [
      "Host logrotate-ci",
      "  HostName 127.0.0.1",
      `  Port ${port}`,
      "  User vscode",
      `  IdentityFile ${key}`,
      "  IdentitiesOnly yes",
      "  StrictHostKeyChecking no",
      "  UserKnownHostsFile /dev/null",
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(sshConfig, 0o600);
  await writeFile(
    resolve(userDataDirectory, "User/settings.json"),
    `${JSON.stringify(
      {
        "extensions.autoCheckUpdates": false,
        "extensions.autoUpdate": false,
        "remote.SSH.configFile": sshConfig,
        "remote.SSH.localServerDownload": "always",
        "remote.SSH.remotePlatform": { "logrotate-ci": "linux" },
        "remote.SSH.showLoginTerminal": false,
        "remote.SSH.useExecServer": false,
        "remote.SSH.useLocalServer": false,
        "security.workspace.trust.enabled": false,
        "telemetry.telemetryLevel": "off",
        "update.mode": "none",
      },
      undefined,
      2,
    )}\n`,
    "utf8",
  );

  await prepareRemoteWorkspace(container, remoteVsix);
  await packageProbe(probeVsix);
  await run("docker", ["cp", probeVsix, `${container}:${remoteProbeVsix}`]);

  const version = process.env.VSCODE_VERSION ?? "stable";
  const vscodeExecutable = await downloadAndUnzipVSCode(version);
  const vscodeCli = resolveCliPathFromVSCodeExecutablePath(vscodeExecutable);
  const commandEnvironment = { ...process.env, DONT_PROMPT_WSL_INSTALL: "1" };
  await run(
    vscodeCli,
    [
      "--user-data-dir",
      userDataDirectory,
      "--extensions-dir",
      extensionsDirectory,
      "--install-extension",
      `ms-vscode-remote.remote-ssh@${remoteSshVersion}`,
      "--force",
    ],
    { env: commandEnvironment },
  );
  const { stdout: versionOutput } = await run(vscodeCli, ["--version"], {
    env: commandEnvironment,
  });
  const [, commit] = versionOutput.trim().split(/\r?\n/u);
  if (!/^[0-9a-f]{40}$/u.test(commit ?? "")) {
    throw new Error(
      `Unable to determine the VS Code commit from ${JSON.stringify(versionOutput)}.`,
    );
  }
  const codeServer = `/home/vscode/.vscode-server/bin/${commit}/bin/code-server`;

  bootstrapProcess = launchRemoteCode(
    vscodeCli,
    userDataDirectory,
    extensionsDirectory,
    "/home/vscode/workspace",
  );
  await waitFor(
    async () => commandSucceeds("docker", ["exec", container, "test", "-x", codeServer]),
    120_000,
    "VS Code Server bootstrap",
  );
  await stop(bootstrapProcess);
  bootstrapProcess = undefined;

  await run("docker", [
    "exec",
    "--user",
    "vscode",
    container,
    codeServer,
    "--server-data-dir",
    "/home/vscode/.vscode-server",
    "--install-extension",
    remoteVsix,
    "--force",
  ]);
  await run("docker", [
    "exec",
    "--user",
    "vscode",
    container,
    codeServer,
    "--server-data-dir",
    "/home/vscode/.vscode-server",
    "--install-extension",
    remoteProbeVsix,
    "--force",
  ]);
  const { stdout: installed } = await run("docker", [
    "exec",
    "--user",
    "vscode",
    container,
    codeServer,
    "--server-data-dir",
    "/home/vscode/.vscode-server",
    "--list-extensions",
    "--show-versions",
  ]);
  requireInstalledExtension(installed, `${extensionIdentifier}@${manifest.version}`);
  requireInstalledExtension(installed, "willibrandon.logrotate-remote-smoke-probe@0.0.0");

  smokeProcess = launchRemoteCode(
    vscodeCli,
    userDataDirectory,
    extensionsDirectory,
    "/home/vscode/workspace",
  );
  await waitFor(
    async () => commandSucceeds("docker", ["exec", container, "test", "-f", resultPath]),
    120_000,
    "remote extension-host assertions",
  );
  await run("docker", [
    "cp",
    `${container}:${resultPath}`,
    resolve(artifactDirectory, "result.json"),
  ]);
  const result = JSON.parse(await readFile(resolve(artifactDirectory, "result.json"), "utf8"));
  validateResult(result);
  await copyLanguageServerLog(container, artifactDirectory);
  await writeFile(
    resolve(artifactDirectory, "environment.json"),
    `${JSON.stringify(
      {
        vscodeVersion: versionOutput.trim().split(/\r?\n/u)[0],
        vscodeCommit: commit,
        remoteSshVersion,
        image:
          "debian:trixie-slim@sha256:3a39a0592364683e6bab97937b72cad5a8fa6dcbbee90edb3bb48c7f8e94f258",
      },
      undefined,
      2,
    )}\n`,
    "utf8",
  );
  console.log(
    `Verified ${extensionIdentifier}@${manifest.version} in an ephemeral Remote SSH extension host.`,
  );
} finally {
  await Promise.allSettled([
    bootstrapProcess === undefined ? Promise.resolve() : stop(bootstrapProcess),
    smokeProcess === undefined ? Promise.resolve() : stop(smokeProcess),
  ]);
  if (containerStarted) {
    await executeFile("docker", ["rm", "--force", container], {
      cwd: root,
      maxBuffer: 1024 * 1024,
      timeout: 30_000,
    }).catch(() => undefined);
  }
  await executeFile("docker", ["image", "rm", "--force", image], {
    cwd: root,
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
  }).catch(() => undefined);
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function prepareRemoteWorkspace(containerName, extensionVsix) {
  const staging = resolve(temporaryRoot, "workspace");
  await mkdir(resolve(staging, ".vscode"), { recursive: true });
  for (const name of ["deployment-policy", "included.conf", "logrotate.conf"]) {
    await writeFile(
      resolve(staging, name),
      await readFile(resolve(root, "test/fixtures/workspace", name)),
    );
  }
  await writeFile(
    resolve(staging, ".vscode/settings.json"),
    `${JSON.stringify(
      {
        "logrotate.executablePath": "/usr/sbin/logrotate",
        "logrotate.externalValidation.mode": "off",
        "logrotate.targetVersion": "auto",
      },
      undefined,
      2,
    )}\n`,
    "utf8",
  );
  await run("docker", ["exec", containerName, "mkdir", "-p", "/home/vscode/workspace"]);
  await run("docker", ["cp", `${staging}/.`, `${containerName}:/home/vscode/workspace`]);
  await run("docker", [
    "exec",
    containerName,
    "chown",
    "-R",
    "vscode:vscode",
    "/home/vscode/workspace",
  ]);
  await run("docker", ["cp", vsix, `${containerName}:${extensionVsix}`]);
  await run("docker", ["exec", containerName, "chown", "vscode:vscode", extensionVsix]);
}

async function packageProbe(output) {
  const vsce = resolve(root, "node_modules/@vscode/vsce/vsce");
  await run(process.execPath, [vsce, "package", "--no-dependencies", "--out", output], {
    cwd: resolve(root, "test/remote/probe"),
  });
}

function launchRemoteCode(cli, userData, extensions, remotePath) {
  return spawn(
    "xvfb-run",
    [
      "-a",
      cli,
      "--user-data-dir",
      userData,
      "--extensions-dir",
      extensions,
      "--new-window",
      "--remote",
      "ssh-remote+logrotate-ci",
      remotePath,
      "--disable-updates",
      "--skip-welcome",
      "--skip-release-notes",
      "--wait",
    ],
    {
      cwd: root,
      detached: true,
      env: { ...process.env, DONT_PROMPT_WSL_INSTALL: "1" },
      shell: false,
      stdio: "inherit",
    },
  );
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (child.pid !== undefined) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      return;
    }
  }
  await Promise.race([once(child, "exit"), delay(5_000)]);
  if (child.exitCode === null && child.signalCode === null && child.pid !== undefined) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // The process exited after the status check.
    }
  }
}

async function copyLanguageServerLog(containerName, destination) {
  const { stdout } = await run("docker", [
    "exec",
    containerName,
    "find",
    "/home/vscode/.vscode-server/data/logs",
    "-type",
    "f",
    "-path",
    "*willibrandon.logrotate/Logrotate Language Server.log",
  ]);
  const logs = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
  const log = logs.at(-1);
  if (log === undefined) throw new Error("The remote Logrotate output log was not created.");
  await run("docker", [
    "cp",
    `${containerName}:${log}`,
    resolve(destination, "language-server.log"),
  ]);
}

function validateResult(result) {
  if (typeof result !== "object" || result === null || result.ok !== true) {
    throw new Error(`Remote smoke assertions failed: ${JSON.stringify(result)}.`);
  }
  if (
    result.remoteName !== "ssh-remote" ||
    result.workspaceScheme !== "file" ||
    typeof result.extensionPath !== "string" ||
    result.extensionPath !== expectedRemoteExtensionPath ||
    result.extensionVersion !== manifest.version ||
    typeof result.extensionHostExecutable !== "string" ||
    !result.extensionHostExecutable.startsWith("/home/vscode/.vscode-server/") ||
    typeof result.languageServerProcess !== "string" ||
    !result.languageServerProcess.includes(`${expectedRemoteExtensionPath}/dist/nodeServer.cjs`) ||
    !Array.isArray(result.includedDiagnosticCodes) ||
    !result.includedDiagnosticCodes.includes("LR1001") ||
    typeof result.installedDiagnostic !== "string" ||
    !result.installedDiagnostic.startsWith("[logrotate 3.22.0 on this host]")
  ) {
    throw new Error(`Remote smoke evidence is incomplete: ${JSON.stringify(result)}.`);
  }
}

function requireInstalledExtension(output, expected) {
  const installed = output
    .split(/\r?\n/u)
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean);
  if (!installed.includes(expected.toLowerCase())) {
    throw new Error(`Remote profile contains ${JSON.stringify(installed)}, expected ${expected}.`);
  }
}

function parsePort(output) {
  const match = /:(\d+)\s*$/u.exec(output.trim());
  const port = Number.parseInt(match?.[1] ?? "", 10);
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`Unable to parse the published SSH port from ${JSON.stringify(output)}.`);
  }
  return port;
}

async function waitFor(predicate, timeoutMilliseconds, description) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function commandSucceeds(command, arguments_) {
  try {
    await executeFile(command, arguments_, {
      cwd: root,
      maxBuffer: 1024 * 1024,
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

async function run(command, arguments_, options = {}) {
  const result = await executeFile(command, arguments_, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    maxBuffer: 8 * 1024 * 1024,
    timeout: 300_000,
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  return result;
}

async function requireFile(path) {
  await readFile(path);
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => globalThis.setTimeout(resolvePromise, milliseconds));
}
