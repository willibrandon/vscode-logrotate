import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { open } from "@vscode/test-web";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(root, "docs-site/src/assets");
const debuggingPort = 9334;
const deviceScaleFactor = 2;

await mkdir(outputDirectory, { recursive: true });
const testWeb = await open({
  browserType: "chromium",
  browserOptions: [
    `--remote-debugging-port=${debuggingPort}`,
    "--remote-allow-origins=*",
    `--force-device-scale-factor=${deviceScaleFactor}`,
    "--window-size=1280,640",
  ],
  extensionDevelopmentPath: root,
  folderPath: resolve(root, "test/fixtures/workspace"),
  headless: true,
  quality: "stable",
  testRunnerDataDir: resolve(root, ".vscode-test-web/docs"),
});

let browser;
try {
  browser = await connectToBrowser(debuggingPort);
  const context = browser.contexts()[0];
  const page = context?.pages()[0];
  if (page === undefined) throw new Error("VS Code did not create a browser page.");

  const workbench = page.locator(".monaco-workbench");
  await workbench.waitFor({ state: "visible", timeout: 30_000 });
  await selectTheme(page, "Dark+");

  await openFile(page, "application.logrotate");
  await page.keyboard.press("Control+B");
  await waitForDiagnostics(page);
  await goToLineEnd(page, 6);
  await runCommand(page, "Trigger Suggest");
  await page
    .locator(".suggest-widget:visible")
    .filter({ hasText: "compress" })
    .waitFor({ state: "visible", timeout: 10_000 });
  await captureWorkbench(page, "directive-completion.png", 310);

  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+B");
  await openFile(page, "proxy.logrotate");
  await page.keyboard.press("Control+B");
  await page.setViewportSize({ width: 850, height: 640 });
  await page.keyboard.press("Control+Equal");
  await page.keyboard.press("Control+Equal");
  await page.keyboard.press("Control+Equal");
  await page
    .locator(".monaco-editor:visible")
    .last()
    .locator(".squiggly-error")
    .waitFor({ state: "attached", timeout: 10_000 });
  await page.keyboard.press("Control+Shift+M");
  await page
    .locator(".markers-panel:visible")
    .filter({ hasText: "Unknown directive" })
    .waitFor({ state: "visible", timeout: 10_000 });
  await goToLineEnd(page, 6);
  await page.keyboard.press("Control+Period");
  await page
    .locator(".action-widget:visible")
    .filter({ hasText: "Replace with" })
    .waitFor({ state: "visible", timeout: 10_000 });
  await captureWorkbench(page, "diagnostic-quick-fix.png", 480);
} finally {
  await browser?.close();
  testWeb.dispose();
}

async function connectToBrowser(port) {
  const endpoint = `http://127.0.0.1:${port}`;
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return await chromium.connectOverCDP(endpoint);
    } catch (error) {
      lastError = error;
      await new Promise((resolvePromise) => globalThis.setTimeout(resolvePromise, 100));
    }
  }
  throw lastError;
}

async function openFile(page, filename) {
  const row = page
    .locator(".explorer-folders-view .monaco-list-row")
    .filter({ hasText: filename })
    .first();
  await row.waitFor({ state: "visible", timeout: 10_000 });
  await row.click();
  await page.locator(".monaco-editor:visible .view-lines").last().waitFor({ state: "visible" });
}

async function goToLineEnd(page, line) {
  const editor = page.locator(".monaco-editor:visible").last();
  await editor.click();
  await page.keyboard.press("Control+Home");
  for (let current = 1; current < line; current += 1) {
    await page.keyboard.press("ArrowDown");
  }
  await page.keyboard.press("End");
}

async function runCommand(page, label) {
  await page.keyboard.press("F1");
  const input = page.locator(".quick-input-widget:visible input");
  await input.waitFor({ state: "visible" });
  await input.fill(`>${label}`);
  const command = page
    .locator(".quick-input-list .monaco-list-row")
    .filter({ hasText: label })
    .first();
  await command.waitFor({ state: "visible", timeout: 10_000 });
  await command.click();
}

async function waitForDiagnostics(page) {
  await page
    .locator(".monaco-editor:visible")
    .last()
    .locator(".squiggly-error")
    .waitFor({ state: "attached", timeout: 30_000 });
}

async function selectTheme(page, label) {
  await page.keyboard.press("F1");
  const commandInput = page.locator(".quick-input-widget:visible input");
  await commandInput.waitFor({ state: "visible" });
  await commandInput.fill(">Preferences: Color Theme");
  const command = page
    .locator(".quick-input-list .monaco-list-row")
    .filter({ hasText: "Preferences: Color Theme" })
    .first();
  await command.waitFor({ state: "visible" });
  await command.click();
  const input = page.locator(".quick-input-widget:visible input");
  await input.waitFor({ state: "visible" });
  await input.fill(label);
  const matchingRow = page
    .locator(".quick-input-list .monaco-list-row")
    .filter({ hasText: label })
    .first();
  await matchingRow.waitFor({ state: "visible" });
  await matchingRow.click();
  await page.waitForTimeout(300);
}

async function captureWorkbench(page, filename, contentHeight) {
  const workbench = page.locator(".monaco-workbench");
  const bounds = await workbench.boundingBox();
  if (bounds === null) throw new Error(`Unable to measure the workbench for ${filename}.`);
  const titleBarHeight = 35;
  const activityBarWidth = 48;
  const statusBarHeight = 22;
  const availableHeight = bounds.height - titleBarHeight - statusBarHeight;
  await page.screenshot({
    path: resolve(outputDirectory, filename),
    scale: "device",
    clip: {
      x: bounds.x + activityBarWidth,
      y: bounds.y + titleBarHeight,
      width: bounds.width - activityBarWidth,
      height: Math.min(contentHeight ?? availableHeight, availableHeight),
    },
  });
  process.stdout.write(`Captured docs-site/src/assets/${filename}.\n`);
}
