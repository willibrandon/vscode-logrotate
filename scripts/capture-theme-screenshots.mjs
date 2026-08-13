import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { open } from "@vscode/test-web";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(
  process.env.LOGROTATE_THEME_OUTPUT_DIR ?? resolve(root, "docs/images"),
);
const debuggingPort = 9333;
const captureWidth = 1_000;
const captureHeight = 310;
const deviceScaleFactor = 2;
const themes = [
  { label: "Dark+", file: "dark-plus.png" },
  { label: "Light+", file: "light-plus.png" },
  { label: "Dark High Contrast", file: "high-contrast.png" },
  { label: "GitHub Dark Default", file: "github-dark.png" },
  { label: "Dracula Theme", file: "dracula.png" },
  { label: "One Dark Pro", file: "one-dark-pro.png" },
];

await mkdir(outputDirectory, { recursive: true });
const testWeb = await open({
  browserType: "chromium",
  browserOptions: [
    `--remote-debugging-port=${debuggingPort}`,
    "--remote-allow-origins=*",
    `--force-device-scale-factor=${deviceScaleFactor}`,
    "--window-size=1440,900",
  ],
  extensionDevelopmentPath: root,
  extensionIds: [
    { id: "GitHub.github-vscode-theme" },
    { id: "dracula-theme.theme-dracula" },
    { id: "zhuangtongfa.Material-theme" },
  ],
  folderPath: resolve(root, "test/fixtures/workspace"),
  headless: true,
  quality: "stable",
  testRunnerDataDir: resolve(root, ".vscode-test-web/runtime"),
});

let browser;
try {
  browser = await connectToBrowser(debuggingPort);
  const context = browser.contexts()[0];
  const page = context?.pages()[0];
  if (page === undefined) throw new Error("VS Code did not create a browser page.");
  await page.locator(".monaco-workbench").waitFor({ state: "visible", timeout: 30_000 });
  await openFile(page, "theme-preview.logrotate");
  await page.keyboard.press("Control+B");

  for (const theme of themes) {
    await selectTheme(page, theme.label);
    const editor = page.locator(".editor-instance:visible").last();
    await editor.waitFor({ state: "visible" });
    const bounds = await editor.boundingBox();
    if (bounds === null) throw new Error(`Unable to measure the editor for ${theme.label}.`);
    await page.screenshot({
      path: resolve(outputDirectory, theme.file),
      scale: "device",
      clip: {
        ...bounds,
        width: Math.min(bounds.width, captureWidth),
        height: Math.min(bounds.height, captureHeight),
      },
    });
    process.stdout.write(`Captured ${theme.label} as docs/images/${theme.file}.\n`);
  }
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
  await row.waitFor({ state: "visible" });
  await row.click();
  await page.locator(".monaco-editor:visible .view-lines").last().waitFor({ state: "visible" });
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
