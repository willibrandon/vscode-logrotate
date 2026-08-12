const vscode = require("vscode");

const reassigned = new Set();

exports.activate = (context) => {
  const reassignOnce = (document) => {
    const uri = document.uri.toString();
    if (
      document.uri.scheme !== "file" ||
      !document.uri.path.endsWith("/included.conf") ||
      reassigned.has(uri)
    ) {
      return;
    }
    reassigned.add(uri);
    void vscode.languages.setTextDocumentLanguage(document, "properties");
  };

  for (const document of vscode.workspace.textDocuments) reassignOnce(document);
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(reassignOnce));
};
