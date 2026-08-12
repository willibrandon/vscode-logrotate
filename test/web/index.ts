import * as vscode from "vscode";

const extensionId = "willibrandon.logrotate";

interface ExtensionManifest {
  readonly browser: string;
}

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension(extensionId);
  assert(extension !== undefined, `${extensionId} was not installed in the web extension host`);
  await extension.activate();
  assert(extension.isActive, "the web extension did not activate");
  const manifest = extension.packageJSON as ExtensionManifest;
  assert(manifest.browser === "./dist/browser.js", "the browser entry is incorrect");

  const folder = vscode.workspace.workspaceFolders?.[0];
  assert(folder !== undefined, "the virtual test workspace was not opened");
  assert(folder.uri.scheme !== "file", "the web test must use a virtual filesystem");
  const rootUri = vscode.Uri.joinPath(folder.uri, "logrotate.conf");
  const includedUri = vscode.Uri.joinPath(folder.uri, "included.conf");
  const document = await vscode.workspace.openTextDocument(rootUri);
  assert(document.languageId === "logrotate", "logrotate.conf did not receive the language id");
  await vscode.window.showTextDocument(document);

  const diagnostics = await waitForDiagnostics(includedUri);
  assert(
    diagnostics.some(({ code }) => code === "LR1001"),
    `expected included virtual-file diagnostics, received ${JSON.stringify(diagnostics)}`,
  );
  const includedDocument = await vscode.workspace.openTextDocument(includedUri);
  await vscode.window.showTextDocument(includedDocument);
  await waitForLanguage(includedUri, "logrotate");
  const openedDiagnostic = (await waitForDiagnostics(includedUri)).find(
    ({ code }) => code === "LR1001",
  );
  assert(openedDiagnostic !== undefined, "expected LR1001 after the virtual include opened");
  assert(
    openedDiagnostic.range.isEqual(new vscode.Range(1, 4, 1, 10)),
    `expected the rotote token range, received ${JSON.stringify(openedDiagnostic.range)}`,
  );

  const completion = await vscode.commands.executeCommand<vscode.CompletionList>(
    "vscode.executeCompletionItemProvider",
    document.uri,
    new vscode.Position(4, 4),
  );
  assert(
    completion.items.some(({ label }) => label === "compress"),
    "completion was unavailable",
  );
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function waitForDiagnostics(uri: vscode.Uri): Promise<readonly vscode.Diagnostic[]> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const diagnostics = vscode.languages.getDiagnostics(uri);
    if (diagnostics.length > 0) return diagnostics;
    await delay(50);
  }
  return vscode.languages.getDiagnostics(uri);
}

async function waitForLanguage(uri: vscode.Uri, languageId: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const document = vscode.workspace.textDocuments.find(
      (candidate) => candidate.uri.toString() === uri.toString(),
    );
    if (document?.languageId === languageId) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${uri.toString()} to use ${languageId}.`);
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}
