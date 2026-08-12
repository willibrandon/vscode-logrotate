import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";
import {
  clientOptions,
  registerCommonCommands,
  registerContentDetection,
  registerFileSystemBridge,
  registerLoadedIncludeSupport,
} from "./common.js";
import { explainUnavailability } from "./external-validation-policy.js";

let client: LanguageClient | undefined;
let serverWorker: Worker | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel("Logrotate Language Server", { log: true });
  output.info("Activating Logrotate extension in the web extension host.");
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
  registerContentDetection(context, { client, output });
  registerFileSystemBridge(context, { client, output });
  registerLoadedIncludeSupport(context, { client, fileUriCaseInsensitive: false, output });
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "logrotate.validateWithInstalledLogrotate",
      async (): Promise<void> => {
        await vscode.window.showInformationMessage(explainUnavailability("browser"));
      },
    ),
  );
  output.info("Starting Logrotate language server in a Web Worker.");
  await client.start();
  output.info("Logrotate language server started.");
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
