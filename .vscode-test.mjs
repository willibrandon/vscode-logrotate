import { defineConfig } from "@vscode/test-cli";
import { resolve } from "node:path";

export default defineConfig({
  files: "dist/test/desktop/**/*.test.cjs",
  extensionDevelopmentPath: import.meta.dirname,
  workspaceFolder: resolve(import.meta.dirname, "test/fixtures/workspace"),
  version: process.env.VSCODE_VERSION ?? "stable",
  mocha: {
    timeout: 30_000,
  },
  launchArgs: ["--disable-extensions"],
});
