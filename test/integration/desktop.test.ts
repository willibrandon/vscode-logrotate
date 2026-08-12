import assert from "node:assert/strict";
import * as vscode from "vscode";

const extensionId = "logrotate.logrotate";

interface ExtensionManifest {
  readonly browser: string;
  readonly main: string;
}

suite("Logrotate desktop extension", () => {
  test("activates the Node client and starts the language server", async () => {
    const extension = vscode.extensions.getExtension(extensionId);
    assert.ok(extension, `${extensionId} was not installed in the extension host`);

    await extension.activate();

    assert.equal(extension.isActive, true);
    const manifest = extension.packageJSON as ExtensionManifest;
    assert.equal(manifest.main, "./dist/extension.cjs");
    assert.equal(manifest.browser, "./dist/browser.js");
  });

  test("bridges included files and publishes their diagnostics", async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "the integration workspace was not opened");
    const rootUri = vscode.Uri.joinPath(folder.uri, "logrotate.conf");
    const includedUri = vscode.Uri.joinPath(folder.uri, "included.conf");
    const document = await vscode.workspace.openTextDocument(rootUri);

    assert.equal(document.languageId, "logrotate");
    await vscode.window.showTextDocument(document);
    const diagnostics = await waitForDiagnostics(includedUri);

    assert.ok(
      diagnostics.some(({ code }) => code === "LR1001"),
      `expected LR1001 for included.conf, received ${JSON.stringify(diagnostics)}`,
    );
  });

  test("serves completion and formatting through the extension host", async () => {
    const completionDocument = await vscode.workspace.openTextDocument({
      language: "logrotate",
      content: "/var/log/example.log {\n    co\n}\n",
    });
    await vscode.window.showTextDocument(completionDocument);
    const completion = await vscode.commands.executeCommand<vscode.CompletionList>(
      "vscode.executeCompletionItemProvider",
      completionDocument.uri,
      new vscode.Position(1, 6),
    );
    const formatDocument = await vscode.workspace.openTextDocument({
      language: "logrotate",
      content: "/var/log/example.log {\nrotate 3\n}\n",
    });
    await vscode.window.showTextDocument(formatDocument);
    const edits = await vscode.commands.executeCommand<readonly vscode.TextEdit[] | undefined>(
      "vscode.executeFormatDocumentProvider",
      formatDocument.uri,
      { insertSpaces: true, tabSize: 4 },
    );

    assert.ok(completion.items.some(({ label }) => label === "compress"));
    assert.ok(edits !== undefined && edits.length > 0, "expected formatting edits");
  });
});

async function waitForDiagnostics(uri: vscode.Uri): Promise<readonly vscode.Diagnostic[]> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const diagnostics = vscode.languages.getDiagnostics(uri);
    if (diagnostics.length > 0) return diagnostics;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return vscode.languages.getDiagnostics(uri);
}
