import * as vscode from "vscode";
import type { BaseLanguageClient, LanguageClientOptions } from "vscode-languageclient";
import {
  readDirectoryRequest,
  readFileRequest,
  statRequest,
} from "@logrotate/language-server/protocol";

export interface ClientRuntime {
  readonly client: BaseLanguageClient;
  readonly output: vscode.LogOutputChannel;
}

export function clientOptions(output: vscode.LogOutputChannel): LanguageClientOptions {
  return {
    documentSelector: [{ language: "logrotate" }, { language: "logrotate-state" }],
    outputChannel: output,
    markdown: { isTrusted: false },
    synchronize: { configurationSection: "logrotate" },
  };
}

export function registerCommonCommands(
  context: vscode.ExtensionContext,
  runtime: ClientRuntime,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("logrotate.restartLanguageServer", async (): Promise<void> => {
      await runtime.client.stop();
      await runtime.client.start();
    }),
    vscode.commands.registerCommand("logrotate.showLanguageServerOutput", (): void => {
      runtime.output.show(true);
    }),
    vscode.commands.registerCommand(
      "logrotate.openDirectiveDocumentation",
      async (): Promise<void> => {
        await vscode.env.openExternal(
          vscode.Uri.parse("https://github.com/logrotate/logrotate/blob/main/logrotate.8.in"),
        );
      },
    ),
  );
}

export function registerFileSystemBridge(
  context: vscode.ExtensionContext,
  runtime: ClientRuntime,
): void {
  context.subscriptions.push(
    runtime.client.onRequest(readFileRequest, async ({ uri }): Promise<string> => {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.parse(uri));
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }),
    runtime.client.onRequest(readDirectoryRequest, async ({ uri }): Promise<readonly string[]> => {
      const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.parse(uri));
      return entries.map(([name]) => name);
    }),
    runtime.client.onRequest(statRequest, async ({ uri }) => {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.parse(uri));
      return {
        type:
          (stat.type & vscode.FileType.Directory) !== 0
            ? ("directory" as const)
            : (stat.type & vscode.FileType.File) !== 0
              ? ("file" as const)
              : ("other" as const),
        size: stat.size,
        mtime: stat.mtime,
      };
    }),
  );
}
