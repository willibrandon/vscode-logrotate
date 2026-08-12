const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const vscode = require("vscode");

const execute = promisify(execFile);
const resultName = ".remote-smoke-result.json";

exports.activate = async function activate() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder === undefined) return;
  const resultUri = vscode.Uri.joinPath(folder.uri, resultName);
  let result;
  try {
    assert.equal(vscode.env.remoteName, "ssh-remote");
    assert.equal(folder.uri.scheme, "file");

    const extension = vscode.extensions.getExtension("willibrandon.logrotate");
    assert.ok(extension, "willibrandon.logrotate is not installed in the remote extension host");
    const extensionVersion = extension.packageJSON.version;
    assert.equal(typeof extensionVersion, "string");
    assert.equal(
      extension.extensionPath,
      `/home/vscode/.vscode-server/extensions/willibrandon.logrotate-${extensionVersion}`,
    );

    const rootUri = vscode.Uri.joinPath(folder.uri, "logrotate.conf");
    const includedUri = vscode.Uri.joinPath(folder.uri, "included.conf");
    const document = await vscode.workspace.openTextDocument(rootUri);
    await vscode.window.showTextDocument(document);
    await extension.activate();
    assert.equal(extension.isActive, true);
    assert.equal(document.languageId, "logrotate");

    const includedDiagnostics = await waitForDiagnostics(
      includedUri,
      (diagnostics) => diagnostics.some(({ code }) => code === "LR1001"),
      "the included unknown-directive diagnostic",
    );

    await vscode.commands.executeCommand("logrotate.validateWithInstalledLogrotate");
    const hostDiagnostics = await waitForDiagnostics(
      rootUri,
      (diagnostics) =>
        diagnostics.some(
          ({ code, source }) => code === "LRHOST" && source === "logrotate-installed",
        ),
      "the installed logrotate diagnostic",
    );
    const hostDiagnostic = hostDiagnostics.find(({ code }) => code === "LRHOST");
    assert.ok(hostDiagnostic);
    assert.match(hostDiagnostic.message, /^\[logrotate 3\.22\.0 on this host\]/u);
    assert.match(hostDiagnostic.message, /unknown option 'rotote'/u);

    const { stdout: processes } = await execute("ps", ["-eo", "args="], {
      maxBuffer: 1024 * 1024,
      timeout: 10_000,
    });
    const languageServerProcess = processes
      .split(/\r?\n/u)
      .find((line) => line.includes(`${extension.extensionPath}/dist/nodeServer.cjs`));
    assert.ok(languageServerProcess, "the Logrotate language server is not running remotely");

    result = {
      ok: true,
      remoteName: vscode.env.remoteName,
      workspaceScheme: folder.uri.scheme,
      extensionPath: extension.extensionPath,
      extensionVersion,
      extensionHostExecutable: process.execPath,
      languageServerProcess: languageServerProcess.trim(),
      includedDiagnosticCodes: includedDiagnostics.map(({ code }) => String(code)).sort(),
      installedDiagnostic: hostDiagnostic.message,
    };
  } catch (error) {
    result = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    };
  }

  await vscode.workspace.fs.writeFile(
    resultUri,
    Buffer.from(`${JSON.stringify(result, null, 2)}\n`),
  );
  setTimeout(() => {
    void vscode.commands.executeCommand("workbench.action.quit");
  }, 100);
};

async function waitForDiagnostics(uri, predicate, description) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const diagnostics = vscode.languages.getDiagnostics(uri);
    if (predicate(diagnostics)) return diagnostics;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}
