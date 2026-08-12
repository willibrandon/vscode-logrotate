import * as vscode from "vscode";
import { detectLogrotateLanguage } from "./language-detection.js";

interface ContentDetectionRuntime {
  readonly output: vscode.LogOutputChannel;
}

export function registerContentDetection(
  context: vscode.ExtensionContext,
  runtime: ContentDetectionRuntime,
): void {
  const pending = new Set<string>();
  let disposed = false;

  const detect = (document: vscode.TextDocument): void => {
    if (
      disposed ||
      document.languageId === "logrotate" ||
      document.languageId === "logrotate-state" ||
      document.lineCount === 0
    ) {
      return;
    }
    const language = detectLogrotateLanguage(document.lineAt(0).text);
    const uri = document.uri.toString();
    if (language === undefined || pending.has(uri)) return;
    pending.add(uri);
    void Promise.resolve(vscode.languages.setTextDocumentLanguage(document, language))
      .catch((error: unknown): void => {
        runtime.output.warn(
          `Unable to detect the Logrotate language from document content: ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .finally((): void => {
        pending.delete(uri);
      });
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(detect),
    vscode.workspace.onDidChangeTextDocument(({ document, contentChanges }): void => {
      if (contentChanges.some(({ range }) => range.start.line === 0 || range.end.line === 0)) {
        detect(document);
      }
    }),
    {
      dispose(): void {
        if (disposed) return;
        disposed = true;
        pending.clear();
      },
    },
  );
  for (const document of vscode.workspace.textDocuments) detect(document);
}
