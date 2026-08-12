import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { runVSCodeCommand } from "@vscode/test-electron";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const version = process.env.VSCODE_VERSION ?? "stable";
const vsix = resolve(root, process.env.VSIX_PATH ?? `dist/logrotate-${manifest.version}.vsix`);
const checksum = resolve(root, `dist/logrotate-${manifest.version}.sha256`);
const commandEnvironment = { ...process.env, DONT_PROMPT_WSL_INSTALL: "1" };
const digest = createHash("sha256")
  .update(await readFile(vsix))
  .digest("hex");
const expectedChecksum = `${digest}  ${basename(vsix)}\n`;
if ((await readFile(checksum, "utf8")) !== expectedChecksum) {
  throw new Error(`Checksum does not match ${basename(vsix)}.`);
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "vscode-logrotate-vsix-"));
const extensionsDirectory = resolve(temporaryRoot, "extensions");
const userDataDirectory = resolve(temporaryRoot, "user-data");
await Promise.all([mkdir(extensionsDirectory), mkdir(userDataDirectory)]);

try {
  const profileArguments = [
    `--extensions-dir=${extensionsDirectory}`,
    `--user-data-dir=${userDataDirectory}`,
  ];
  const installation = await runVSCodeCommand(
    ["--install-extension", vsix, "--force", ...profileArguments],
    { spawn: { env: commandEnvironment }, version },
  );
  process.stdout.write(installation.stdout);
  process.stderr.write(installation.stderr);

  const listing = await runVSCodeCommand(
    ["--list-extensions", "--show-versions", ...profileArguments],
    { spawn: { env: commandEnvironment }, version },
  );
  const expectedIdentity = `${manifest.publisher}.${manifest.name}@${manifest.version}`;
  const installed = listing.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean);
  if (!installed.includes(expectedIdentity.toLowerCase())) {
    throw new Error(
      `Clean profile contains ${JSON.stringify(installed)}, expected ${expectedIdentity}.`,
    );
  }

  const testCli = resolve(root, "node_modules/@vscode/test-cli/out/bin.mjs");
  const cliArguments = [testCli, "--config", resolve(root, ".vscode-test-package.mjs")];
  const command = process.platform === "linux" ? "xvfb-run" : process.execPath;
  const arguments_ =
    process.platform === "linux" ? ["-a", process.execPath, ...cliArguments] : cliArguments;
  const exitCode = await run(command, arguments_, {
    ...commandEnvironment,
    LOGROTATE_VSIX_EXTENSIONS_DIR: extensionsDirectory,
    LOGROTATE_VSIX_USER_DATA_DIR: userDataDirectory,
    VSCODE_VERSION: version,
  });
  if (exitCode !== 0) throw new Error(`VSIX smoke test exited with code ${exitCode}.`);
  console.log(
    `Installed and activated ${expectedIdentity} from the local VSIX in a clean profile.`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function run(command, arguments_, environment) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, arguments_, {
      cwd: root,
      env: environment,
      shell: false,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => {
      if (signal !== null) rejectPromise(new Error(`${command} stopped with ${signal}.`));
      else resolvePromise(code ?? 1);
    });
  });
}
