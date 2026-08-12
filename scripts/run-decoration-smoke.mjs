import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const temporaryRoot = await mkdtemp(join(tmpdir(), "vscode-logrotate-decoration-"));
const userDataDirectory = resolve(temporaryRoot, "user-data");
const extensionsDirectory = resolve(temporaryRoot, "extensions");
const workspace = resolve(root, "test/fixtures/workspace");
const conflictingExtension = resolve(root, "test/fixtures/conflicting-conf-extension");
const port = await availablePort();
let child;
let browser;

try {
  await Promise.all([
    mkdir(userDataDirectory, { recursive: true }),
    mkdir(extensionsDirectory, { recursive: true }),
  ]);
  const executable = await downloadAndUnzipVSCode(process.env.VSCODE_VERSION ?? "stable");
  const editorArguments = [
    "--no-cached-data",
    "--disable-workspace-trust",
    "--user-data-dir",
    userDataDirectory,
    "--extensions-dir",
    extensionsDirectory,
    `--extensionDevelopmentPath=${root}`,
    `--extensionDevelopmentPath=${conflictingExtension}`,
    `--remote-debugging-port=${port}`,
    "--disable-extensions",
    "--disable-updates",
    "--skip-welcome",
    "--skip-release-notes",
    workspace,
  ];
  const command = process.platform === "linux" ? "xvfb-run" : executable;
  const arguments_ =
    process.platform === "linux"
      ? ["-a", executable, "--no-sandbox", "--disable-gpu-sandbox", ...editorArguments]
      : editorArguments;
  child = spawn(command, arguments_, {
    cwd: root,
    env: { ...process.env, DONT_PROMPT_WSL_INSTALL: "1" },
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  });
  const endpoint = `http://127.0.0.1:${port}`;
  browser = await connectToWorkbench(endpoint, child);
  const page = await waitForWorkbench(browser, child);
  const includedFile = page.getByRole("treeitem", { name: /included\.conf/u });
  await includedFile.waitFor({ state: "visible", timeout: 30_000 });
  await includedFile.click();
  try {
    await page.waitForFunction(
      () => {
        const visibleIncludedEditor = [
          ...globalThis.document.querySelectorAll(".editor-instance"),
        ].find(
          (editor) =>
            editor.getClientRects().length > 0 &&
            [...editor.querySelectorAll(".view-line")].some(
              (line) => line.textContent?.includes("rotote 2") === true,
            ),
        );
        const logrotateLanguage = [...globalThis.document.querySelectorAll(".statusbar-item")].some(
          (item) => item.textContent?.trim() === "Logrotate",
        );
        return (
          logrotateLanguage && visibleIncludedEditor?.querySelector(".squiggly-error") !== null
        );
      },
      undefined,
      { timeout: 10_000 },
    );
  } catch (error) {
    const failureScreenshot = resolve(root, "dist/decoration-smoke-failure.png");
    await page.screenshot({ path: failureScreenshot });
    const workbenchState = await page.evaluate(() => ({
      activeTab: globalThis.document.querySelector('[role="tab"][aria-selected="true"]')
        ?.textContent,
      editors: [...globalThis.document.querySelectorAll(".editor-instance")].map((editor) => ({
        visible: editor.getClientRects().length > 0,
        lines: [...editor.querySelectorAll(".view-line")]
          .filter((line) => line.textContent?.includes("rotote") === true)
          .map((line) => line.innerHTML),
      })),
      squiggles: globalThis.document.querySelectorAll(".squiggly-error").length,
      status: [...globalThis.document.querySelectorAll(".statusbar-item")].map((item) =>
        item.textContent?.trim(),
      ),
    }));
    throw new Error(
      `The active included editor did not display an error squiggle. Workbench state: ${JSON.stringify(workbenchState)}. Screenshot: ${failureScreenshot}`,
      { cause: error },
    );
  }
  process.stdout.write(
    "Verified the active included editor displays the LR1001 error squiggle without navigation.\n",
  );
} finally {
  await browser?.close().catch(() => undefined);
  if (child !== undefined && child.exitCode === null && child.signalCode === null) child.kill();
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    server.close();
    throw new Error("Unable to reserve a debugger port for the VS Code workbench.");
  }
  await new Promise((resolvePromise, rejectPromise) =>
    server.close((error) => (error === undefined ? resolvePromise() : rejectPromise(error))),
  );
  return address.port;
}

async function connectToWorkbench(endpoint, editorProcess) {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    requireRunning(editorProcess);
    try {
      return await chromium.connectOverCDP(endpoint);
    } catch (error) {
      lastError = error;
      await delay(100);
    }
  }
  throw new Error(`Unable to connect to the VS Code workbench at ${endpoint}.`, {
    cause: lastError,
  });
}

async function waitForWorkbench(connectedBrowser, editorProcess) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    requireRunning(editorProcess);
    for (const context of connectedBrowser.contexts()) {
      for (const page of context.pages()) {
        if ((await page.title()).includes("Visual Studio Code")) return page;
      }
    }
    await delay(100);
  }
  throw new Error("The VS Code workbench did not open before the timeout.");
}

function requireRunning(editorProcess) {
  if (editorProcess.exitCode !== null || editorProcess.signalCode !== null) {
    throw new Error(
      `VS Code exited with ${editorProcess.exitCode ?? editorProcess.signalCode} before the decoration check completed.`,
    );
  }
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => globalThis.setTimeout(resolvePromise, milliseconds));
}
