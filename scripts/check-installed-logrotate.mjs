import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const executable = process.env.LOGROTATE_EXECUTABLE ?? "logrotate";
const expectedVersion = process.env.LOGROTATE_EXPECTED_VERSION ?? "3.22";
const temporaryRoot = await mkdtemp(join(tmpdir(), "vscode-logrotate-host-validation-"));
const logPath = resolve(temporaryRoot, "application.log");
const configPath = resolve(temporaryRoot, "logrotate.conf");
const originalLog = "release validation must not rotate this content\n";

try {
  await Promise.all([
    writeFile(logPath, originalLog, "utf8"),
    writeFile(
      configPath,
      `"${escapeConfigurationPath(logPath)}" {\n  size 1\n  rotate 1\n}\n`,
      "utf8",
    ),
  ]);

  const version = await execute(executable, ["--version"], {
    cwd: temporaryRoot,
    maxBuffer: 1024 * 1024,
    timeout: 10_000,
  });
  const versionText = `${version.stdout}\n${version.stderr}`;
  const versionPattern = new RegExp(
    `^logrotate ${escapeRegex(expectedVersion)}(?:\\.|\\s|$)`,
    "mu",
  );
  if (!versionPattern.test(versionText)) {
    throw new Error(
      `Expected supported logrotate ${expectedVersion}, received ${JSON.stringify(versionText.trim())}.`,
    );
  }

  const validation = await execute(executable, ["--debug", "--state", "/dev/null", configPath], {
    cwd: temporaryRoot,
    maxBuffer: 1024 * 1024,
    timeout: 10_000,
  });
  const validationText = `${validation.stdout}\n${validation.stderr}`;
  if (!/debug mode does nothing/iu.test(validationText)) {
    throw new Error("The supported binary did not confirm non-mutating debug mode.");
  }
  if ((await readFile(logPath, "utf8")) !== originalLog) {
    throw new Error("Installed validation changed the source log.");
  }
  const files = await readdir(temporaryRoot);
  if (files.some((entry) => entry.startsWith("application.log."))) {
    throw new Error(`Installed validation created a rotated log: ${JSON.stringify(files)}.`);
  }
  console.log(
    `Supported logrotate ${expectedVersion} completed a non-mutating --debug validation.`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function escapeConfigurationPath(path) {
  return path.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
