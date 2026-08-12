import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";
import { clientOptions, registerCommonCommands, registerFileSystemBridge } from "./common.js";
import { explainUnavailability } from "./external-validation-policy.js";

let client: LanguageClient | undefined;
let serverWorker: Worker | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel("Logrotate Language Server", { log: true });
  const server = vscode.Uri.joinPath(context.extensionUri, "dist", "browserServer.js");
  const worker = new Worker(server.toString(true), { name: "Logrotate Language Server" });
  serverWorker = worker;
  client = new LanguageClient(
    "logrotate",
    "Logrotate Language Server",
    worker,
    clientOptions(output),
  );
  context.subscriptions.push(output, client);
  registerCommonCommands(context, { client, output });
  registerFileSystemBridge(context, { client, output });
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "logrotate.validateWithInstalledLogrotate",
      async (): Promise<void> => {
        await vscode.window.showInformationMessage(explainUnavailability("browser"));
      },
    ),
  );
  await client.start();
  await vscode.commands.executeCommand(
    "setContext",
    "logrotate.externalValidationAvailable",
    false,
  );
}

export async function deactivate(): Promise<void> {
  await client?.stop();
  serverWorker?.terminate();
  client = undefined;
  serverWorker = undefined;
}
