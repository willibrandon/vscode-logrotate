import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const testCli = resolve(root, "node_modules/@vscode/test-cli/out/bin.mjs");
const cliArguments = [testCli, "--config", resolve(root, ".vscode-test.mjs")];
const command = process.platform === "linux" ? "xvfb-run" : process.execPath;
const arguments_ =
  process.platform === "linux" ? ["-a", process.execPath, ...cliArguments] : cliArguments;
const child = spawn(command, arguments_, { cwd: root, stdio: "inherit", shell: false });
const exitCode = await new Promise((resolvePromise, rejectPromise) => {
  child.once("error", rejectPromise);
  child.once("close", (code, signal) => {
    if (signal !== null) rejectPromise(new Error(`Desktop test host stopped with ${signal}.`));
    else resolvePromise(code ?? 1);
  });
});
process.exitCode = exitCode;
