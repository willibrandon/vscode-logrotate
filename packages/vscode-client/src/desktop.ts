import * as vscode from "vscode";
import { LanguageClient, TransportKind } from "vscode-languageclient/node";
import type { ServerOptions } from "vscode-languageclient/node";
import {
  clientOptions,
  registerCommonCommands,
  registerFileSystemBridge,
  registerLoadedIncludeWatching,
} from "./common.js";
import {
  explainUnavailability,
  externalValidationUnavailable,
} from "./external-validation-policy.js";
import { NodeProcessHost, validateWithInstalledLogrotate } from "./external-validator.js";

let client: LanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel("Logrotate Language Server", { log: true });
  output.info("Activating Logrotate extension in the desktop extension host.");
  const module = vscode.Uri.joinPath(context.extensionUri, "dist", "nodeServer.cjs").fsPath;
  const serverOptions: ServerOptions = { module, transport: TransportKind.ipc };
  client = new LanguageClient(
    "logrotate",
    "Logrotate Language Server",
    serverOptions,
    clientOptions(output),
  );
  context.subscriptions.push(output, client);
  registerCommonCommands(context, { client, output });
  registerFileSystemBridge(context, { client, output });
  registerLoadedIncludeWatching(context, { client, output });
  const diagnostics = vscode.languages.createDiagnosticCollection("logrotate-installed");
  const activeValidations = new Map<string, AbortController>();
  context.subscriptions.push(diagnostics);
  context.subscriptions.push({
    dispose(): void {
      for (const controller of activeValidations.values()) controller.abort();
      activeValidations.clear();
    },
  });
  const validate = async (document: vscode.TextDocument, explicit: boolean): Promise<void> => {
    const unavailable = externalValidationUnavailable({
      isDesktop: true,
      isTrusted: vscode.workspace.isTrusted,
      scheme: document.uri.scheme,
      isSaved: !document.isUntitled && !document.isDirty,
      languageId: document.languageId,
    });
    if (unavailable !== undefined) {
      if (explicit) await vscode.window.showInformationMessage(explainUnavailability(unavailable));
      return;
    }
    const executable = vscode.workspace
      .getConfiguration("logrotate", document.uri)
      .get<string>("executablePath", "logrotate");
    activeValidations.get(document.uri.toString())?.abort();
    const controller = new AbortController();
    activeValidations.set(document.uri.toString(), controller);
    try {
      const result = await validateWithInstalledLogrotate(
        executable,
        document.uri.fsPath,
        new NodeProcessHost(),
        undefined,
        { signal: controller.signal, isTrusted: () => vscode.workspace.isTrusted },
      );
      if (result.cancelled) return;
      diagnostics.set(document.uri, diagnosticsFromOutput(document, result));
    } catch (error) {
      diagnostics.delete(document.uri);
      if (explicit && !controller.signal.aborted) {
        await vscode.window.showErrorMessage(
          `Unable to run installed logrotate: ${safeMessage(error instanceof Error ? error.message : String(error))}`,
        );
      }
    } finally {
      if (activeValidations.get(document.uri.toString()) === controller) {
        activeValidations.delete(document.uri.toString());
      }
    }
  };
  const updateExternalValidationContext = async (): Promise<void> => {
    const document = vscode.window.activeTextEditor?.document;
    const available =
      document !== undefined &&
      externalValidationUnavailable({
        isDesktop: true,
        isTrusted: vscode.workspace.isTrusted,
        scheme: document.uri.scheme,
        isSaved: !document.isUntitled && !document.isDirty,
        languageId: document.languageId,
      }) === undefined;
    await vscode.commands.executeCommand(
      "setContext",
      "logrotate.externalValidationAvailable",
      available,
    );
  };
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "logrotate.validateWithInstalledLogrotate",
      async (): Promise<void> => {
        const document = vscode.window.activeTextEditor?.document;
        if (document === undefined) {
          await vscode.window.showInformationMessage(
            "Open a logrotate configuration file before running installed validation.",
          );
          return;
        }
        await validate(document, true);
      },
    ),
    vscode.workspace.onDidSaveTextDocument(async (document): Promise<void> => {
      await updateExternalValidationContext();
      const mode = vscode.workspace
        .getConfiguration("logrotate", document.uri)
        .get<string>("externalValidation.mode", "off");
      if (mode === "onSave") await validate(document, false);
    }),
    vscode.workspace.onDidCloseTextDocument((document): void => {
      activeValidations.get(document.uri.toString())?.abort();
      activeValidations.delete(document.uri.toString());
      diagnostics.delete(document.uri);
    }),
    vscode.workspace.onDidChangeTextDocument(async ({ document }): Promise<void> => {
      if (document === vscode.window.activeTextEditor?.document) {
        await updateExternalValidationContext();
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(updateExternalValidationContext),
    vscode.workspace.onDidGrantWorkspaceTrust(updateExternalValidationContext),
  );
  output.info("Starting Logrotate language server.");
  await client.start();
  output.info("Logrotate language server started.");
  await updateExternalValidationContext();
}

export async function deactivate(): Promise<void> {
  await client?.stop();
  client = undefined;
}

function diagnosticsFromOutput(
  document: vscode.TextDocument,
  result: Awaited<ReturnType<typeof validateWithInstalledLogrotate>>,
): vscode.Diagnostic[] {
  if (result.exitCode === 0 && !result.timedOut && !result.truncated) return [];
  const output = `${result.stderr}\n${result.stdout}`.trim();
  const firstLine = output
    .split(/\r\n|\n|\r/u)
    .find((line) => /error|warning/u.test(line.toLowerCase()));
  const message = result.timedOut
    ? "Installed logrotate validation timed out."
    : result.truncated
      ? "Installed logrotate validation exceeded its output limit."
      : safeMessage(
          firstLine ?? `Installed logrotate exited with code ${result.exitCode ?? "unknown"}.`,
        );
  const diagnostic = new vscode.Diagnostic(
    new vscode.Range(0, 0, 0, Math.max(1, document.lineAt(0).text.length)),
    `[logrotate ${result.version} on this host] ${message}`,
    vscode.DiagnosticSeverity.Warning,
  );
  diagnostic.source = "logrotate-installed";
  diagnostic.code = "LRHOST";
  return [diagnostic];
}

function safeMessage(value: string): string {
  let sanitized = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    sanitized +=
      (code >= 0 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127
        ? "�"
        : character;
  }
  return sanitized.length <= 500 ? sanitized : `${sanitized.slice(0, 500)}…`;
}
