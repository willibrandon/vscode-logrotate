import * as vscode from "vscode";
import type { BaseLanguageClient, LanguageClientOptions } from "vscode-languageclient";
import type { LoadedIncludeResource } from "@logrotate/language-server/protocol";
import {
  includedResourceChangedNotification,
  loadedIncludesNotification,
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
      runtime.output.info("Restarting Logrotate language server.");
      await runtime.client.stop();
      await runtime.client.start();
      runtime.output.info("Logrotate language server restarted.");
    }),
    vscode.commands.registerCommand("logrotate.showLanguageServerOutput", (): void => {
      runtime.output.show(true);
    }),
    vscode.commands.registerCommand(
      "logrotate.openDirectiveDocumentation",
      async (candidate?: unknown): Promise<void> => {
        await vscode.env.openExternal(documentationUri(candidate));
      },
    ),
  );
}

function documentationUri(candidate: unknown): vscode.Uri {
  const fallback = vscode.Uri.parse(
    "https://github.com/logrotate/logrotate/blob/main/logrotate.8.in",
  );
  if (typeof candidate !== "string") return fallback;
  try {
    const uri = vscode.Uri.parse(candidate, true);
    return uri.scheme === "https" &&
      uri.authority === "github.com" &&
      /^\/logrotate\/logrotate\/blob\/(?:main|[0-9a-f]{40})\/logrotate\.8\.in$/u.test(uri.path) &&
      uri.query === "" &&
      uri.fragment === ""
      ? uri
      : fallback;
  } catch {
    return fallback;
  }
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

export function registerLoadedIncludeWatching(
  context: vscode.ExtensionContext,
  runtime: ClientRuntime,
): void {
  const roots = new Map<string, ReadonlyMap<string, LoadedIncludeResource["type"]>>();
  const watchers = new Map<
    string,
    { readonly type: LoadedIncludeResource["type"]; readonly watcher: vscode.FileSystemWatcher }
  >();
  let disposed = false;

  const reportChange = (uri: string): void => {
    void runtime.client
      .sendNotification(includedResourceChangedNotification, { uri })
      .catch((error: unknown): void => {
        runtime.output.error(
          `Unable to refresh changed included resource: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  };

  const reconcile = (): void => {
    const required = new Map<string, LoadedIncludeResource["type"]>();
    for (const resources of roots.values()) {
      for (const [uri, type] of resources) required.set(uri, type);
    }
    for (const [uri, entry] of watchers) {
      if (required.get(uri) === entry.type) continue;
      entry.watcher.dispose();
      watchers.delete(uri);
    }
    for (const [value, type] of required) {
      if (watchers.has(value)) continue;
      const uri = vscode.Uri.parse(value);
      if (uri.scheme !== "file") continue;
      try {
        const pattern =
          type === "directory"
            ? new vscode.RelativePattern(uri, "*")
            : new vscode.RelativePattern(
                vscode.Uri.joinPath(uri, ".."),
                escapeGlobPattern(uri.path.slice(uri.path.lastIndexOf("/") + 1)),
              );
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        watcher.onDidCreate((changed): void => reportChange(changed.toString()));
        watcher.onDidChange((changed): void => reportChange(changed.toString()));
        watcher.onDidDelete((changed): void => reportChange(changed.toString()));
        watchers.set(value, { type, watcher });
      } catch (error) {
        runtime.output.warn(
          `Unable to watch included resource: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  };

  context.subscriptions.push(
    runtime.client.onNotification(loadedIncludesNotification, ({ rootUri, resources }): void => {
      if (disposed) return;
      if (resources.length === 0) {
        roots.delete(rootUri);
      } else {
        roots.set(
          rootUri,
          new Map(
            resources.flatMap(({ uri, type }) => {
              try {
                return vscode.Uri.parse(uri).scheme === "file" ? [[uri, type] as const] : [];
              } catch {
                return [];
              }
            }),
          ),
        );
      }
      reconcile();
    }),
    {
      dispose(): void {
        if (disposed) return;
        disposed = true;
        roots.clear();
        for (const { watcher } of watchers.values()) watcher.dispose();
        watchers.clear();
      },
    },
  );
}

function escapeGlobPattern(value: string): string {
  const escaped: Readonly<Record<string, string>> = {
    "*": "[*]",
    "?": "[?]",
    "[": "[[]",
    "]": "[]]",
    "{": "[{]",
    "}": "[}]",
  };
  return value.replace(/[*?{}]|\[|\]/gu, (character) => escaped[character] ?? character);
}
