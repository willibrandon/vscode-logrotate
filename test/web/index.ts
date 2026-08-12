import * as vscode from "vscode";

const extensionId = "logrotate.logrotate";

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

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}
