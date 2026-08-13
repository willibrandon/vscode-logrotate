import assert from "node:assert/strict";
import * as vscode from "vscode";

const extensionId = "willibrandon.logrotate";

interface ExtensionManifest {
  readonly browser: string;
  readonly license: string;
  readonly main: string;
  readonly version: string;
}

interface SyntaxToken {
  readonly c: string;
  readonly t: string;
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
      assert.equal(manifest.version, process.env["EXPECTED_INSTALLED_EXTENSION_VERSION"]);
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
    const unknownDirective = diagnostics.find(({ code }) => code === "LR1001");
    assert.ok(
      unknownDirective,
      `expected LR1001 for included.conf, received ${JSON.stringify(diagnostics)}`,
    );

    const includedDocument = await vscode.workspace.openTextDocument(includedUri);
    await vscode.window.showTextDocument(includedDocument);
    const associatedDocument = await waitForLanguage(includedUri, "logrotate");
    assert.equal(associatedDocument.languageId, "logrotate");
    const openedDiagnostics = await waitForDiagnostics(includedUri);
    const openedUnknownDirective = openedDiagnostics.find(({ code }) => code === "LR1001");
    assert.ok(openedUnknownDirective, "expected LR1001 after included.conf opened in the editor");
    assert.deepEqual(openedUnknownDirective.range, new vscode.Range(1, 4, 1, 10));
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
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "the integration workspace was not opened");
    const tokens = await vscode.commands.executeCommand<readonly SyntaxToken[] | undefined>(
      "_workbench.captureSyntaxTokens",
      vscode.Uri.joinPath(folder.uri, "theme-preview.logrotate"),
    );
    assert.ok(
      tokens?.some(({ t }) => t.includes("meta.embedded.block.shell source.shell")),
      "the logrotate grammar did not tokenize its embedded shell block",
    );

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

    editor.selections = selections;
    await executeAndWaitForDocumentChange("editor.action.commentLine", document);

    assert.equal(document.lineAt(0).text, "# /var/log/application.log {");
    assert.equal(document.lineAt(1).text, "  # daily");
    assert.equal(document.lineAt(2).text, "  # ");
    assert.equal(document.lineAt(4).text, "    echo rotated");

    editor.selections = selections.slice(0, 3);
    await executeAndWaitForDocumentChange("editor.action.commentLine", document);
    assert.equal(document.getText(), source);
  });
});

async function executeAndWaitForDocumentChange(
  command: string,
  document: vscode.TextDocument,
): Promise<void> {
  const startingVersion = document.version;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let subscription: vscode.Disposable | undefined;
  const changed = new Promise<void>((resolve, reject) => {
    subscription = vscode.workspace.onDidChangeTextDocument(({ document: changedDocument }) => {
      if (changedDocument.uri.toString() === document.uri.toString()) resolve();
    });
    timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${command} to edit ${document.uri.toString()}`));
    }, 5_000);
  });

  try {
    await vscode.commands.executeCommand(command);
    if (document.version === startingVersion) await changed;
  } finally {
    subscription?.dispose();
    if (timeout !== undefined) clearTimeout(timeout);
  }
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

async function waitForLanguage(uri: vscode.Uri, languageId: string): Promise<vscode.TextDocument> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const document = vscode.workspace.textDocuments.find(
      (candidate) => candidate.uri.toString() === uri.toString(),
    );
    if (document?.languageId === languageId) return document;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${uri.toString()} to use ${languageId}.`);
}
