import assert from "node:assert/strict";
import * as vscode from "vscode";

const extensionId = "willibrandon.logrotate";

interface ExtensionManifest {
  readonly browser: string;
  readonly license: string;
  readonly main: string;
  readonly version: string;
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
    assert.equal(manifest.license, "MIT");

    const installedPathPrefix = process.env["EXPECTED_INSTALLED_EXTENSION_PATH_PREFIX"];
    if (installedPathPrefix !== undefined) {
      assert.equal(manifest.version, "0.1.0");
      assert.ok(
        extension.extensionPath.startsWith(installedPathPrefix),
        `expected packaged extension under ${installedPathPrefix}, received ${extension.extensionPath}`,
      );
    }
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

  test("recognizes an extensionless configuration from its content", async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "the integration workspace was not opened");
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.joinPath(folder.uri, "deployment-policy"),
    );

    assert.equal(document.languageId, "logrotate");
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

  test("toggles configuration comments at indentation boundaries and leaves embedded shell to its language", async () => {
    const source = [
      "/var/log/application.log {",
      "  daily",
      "  ",
      "  postrotate",
      "    echo rotated",
      "  endscript",
      "}",
      "",
    ].join("\n");
    const document = await vscode.workspace.openTextDocument({
      language: "logrotate",
      content: source,
    });
    const editor = await vscode.window.showTextDocument(document);
    const selections = [0, 1, 2, 4].map((line) => {
      const position = new vscode.Position(
        line,
        document.lineAt(line).firstNonWhitespaceCharacterIndex,
      );
      return new vscode.Selection(position, position);
    });

    await toggleCommentsAfterEmbeddedLanguagesLoad(editor, document, selections, source, 4);

    assert.equal(document.lineAt(0).text, "# /var/log/application.log {");
    assert.equal(document.lineAt(1).text, "  # daily");
    assert.equal(document.lineAt(2).text, "  # ");
    assert.equal(document.lineAt(4).text, "    echo rotated");

    await vscode.commands.executeCommand("editor.action.commentLine");
    assert.equal(document.getText(), source);
  });
});

async function toggleCommentsAfterEmbeddedLanguagesLoad(
  editor: vscode.TextEditor,
  document: vscode.TextDocument,
  selections: readonly vscode.Selection[],
  source: string,
  embeddedLine: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    editor.selections = [...selections];
    await vscode.commands.executeCommand("editor.action.commentLine");
    if (document.lineAt(embeddedLine).text === "    echo rotated") return;

    await vscode.commands.executeCommand("undo");
    assert.equal(document.getText(), source);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("embedded shell language did not become available to the comment command");
}

async function waitForDiagnostics(uri: vscode.Uri): Promise<readonly vscode.Diagnostic[]> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const diagnostics = vscode.languages.getDiagnostics(uri);
    if (diagnostics.length > 0) return diagnostics;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return vscode.languages.getDiagnostics(uri);
}
