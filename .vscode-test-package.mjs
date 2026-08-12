import { resolve } from "node:path";
import { defineConfig } from "@vscode/test-cli";

const extensionsDirectory = process.env.LOGROTATE_VSIX_EXTENSIONS_DIR;
const userDataDirectory = process.env.LOGROTATE_VSIX_USER_DATA_DIR;
if (extensionsDirectory === undefined || userDataDirectory === undefined) {
  throw new Error("The VSIX smoke test requires isolated extension and user-data directories.");
}

export default defineConfig({
  files: "dist/test/desktop/**/*.test.cjs",
  extensionDevelopmentPath: resolve(import.meta.dirname, "test/package/host"),
  workspaceFolder: resolve(import.meta.dirname, "test/fixtures/workspace"),
  version: process.env.VSCODE_VERSION ?? "stable",
  env: {
    EXPECTED_INSTALLED_EXTENSION_PATH_PREFIX: extensionsDirectory,
  },
  mocha: {
    timeout: 30_000,
  },
  launchArgs: [`--extensions-dir=${extensionsDirectory}`, `--user-data-dir=${userDataDirectory}`],
});
