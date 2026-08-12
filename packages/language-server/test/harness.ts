import { PassThrough } from "node:stream";
import {
  createConnection as createServerConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-languageserver/node";
import type {
  Diagnostic,
  InitializeResult,
  LogMessageParams,
  PublishDiagnosticsParams,
} from "vscode-languageserver";
import { createMessageConnection } from "vscode-jsonrpc/node";
import type { MessageConnection } from "vscode-jsonrpc/node";
import { startLanguageServer } from "../src/server.js";
import { readDirectoryRequest, readFileRequest, statRequest } from "../src/protocol.js";

interface TestFile {
  readonly text?: string;
  readonly entries?: readonly string[];
  readonly readDelayMilliseconds?: number;
}

interface DiagnosticWaiter {
  readonly uri: string;
  readonly predicate: (diagnostics: readonly Diagnostic[]) => boolean;
  readonly resolve: (params: PublishDiagnosticsParams) => void;
}

interface LogWaiter {
  readonly predicate: (message: LogMessageParams) => boolean;
  readonly resolve: (message: LogMessageParams) => void;
}

export interface ServerHarness {
  readonly client: MessageConnection;
  readonly initializeResult: InitializeResult;
  open(uri: string, languageId: string, text: string, version?: number): Promise<void>;
  change(uri: string, text: string, version: number): Promise<void>;
  configure(settings: unknown): Promise<void>;
  close(uri: string): Promise<void>;
  waitForDiagnostics(
    uri: string,
    predicate?: (diagnostics: readonly Diagnostic[]) => boolean,
  ): Promise<PublishDiagnosticsParams>;
  logMessages(): readonly LogMessageParams[];
  waitForLog(predicate: (message: LogMessageParams) => boolean): Promise<LogMessageParams>;
  dispose(): Promise<void>;
}

export async function createServerHarness(
  files: Readonly<Record<string, TestFile>> = {},
): Promise<ServerHarness> {
  const clientToServer = new PassThrough();
  const serverToClient = new PassThrough();
  const server = createServerConnection(
    new StreamMessageReader(clientToServer),
    new StreamMessageWriter(serverToClient),
  );
  const client = createMessageConnection(
    new StreamMessageReader(serverToClient),
    new StreamMessageWriter(clientToServer),
  );
  const published = new Map<string, PublishDiagnosticsParams>();
  const waiters: DiagnosticWaiter[] = [];
  const logMessages: LogMessageParams[] = [];
  const logWaiters: LogWaiter[] = [];

  client.onNotification(
    "textDocument/publishDiagnostics",
    (params: PublishDiagnosticsParams): void => {
      published.set(params.uri, params);
      for (let index = waiters.length - 1; index >= 0; index -= 1) {
        const waiter = waiters[index];
        if (waiter?.uri === params.uri && waiter.predicate(params.diagnostics)) {
          waiters.splice(index, 1);
          waiter.resolve(params);
        }
      }
    },
  );
  client.onNotification("window/logMessage", (message: LogMessageParams): void => {
    logMessages.push(message);
    for (let index = logWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = logWaiters[index];
      if (waiter?.predicate(message) === true) {
        logWaiters.splice(index, 1);
        waiter.resolve(message);
      }
    }
  });
  client.onRequest(readFileRequest, ({ uri }): string => {
    const text = files[uri]?.text;
    if (text === undefined) throw new Error(`Missing test file: ${uri}`);
    return text;
  });
  client.onRequest(readDirectoryRequest, async ({ uri }): Promise<readonly string[]> => {
    const entries = files[uri]?.entries;
    if (entries === undefined) throw new Error(`Missing test directory: ${uri}`);
    const delay = files[uri]?.readDelayMilliseconds;
    if (delay !== undefined) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, delay));
    }
    return entries;
  });
  client.onRequest(statRequest, ({ uri }) => {
    const file = files[uri];
    if (file === undefined) throw new Error(`Missing test resource: ${uri}`);
    return {
      type: file.entries === undefined ? ("file" as const) : ("directory" as const),
      size: file.text?.length ?? file.entries?.length ?? 0,
      mtime: 1,
    };
  });
  client.listen();
  startLanguageServer(server, {
    setTimeout(callback): ReturnType<typeof setTimeout> {
      return setTimeout(callback, 1);
    },
    clearTimeout(handle): void {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
  });

  const initializeResult = await client.sendRequest<InitializeResult>("initialize", {
    processId: null,
    rootUri: null,
    capabilities: {},
  });
  await client.sendNotification("initialized", {});

  return {
    client,
    initializeResult,
    async open(uri, languageId, text, version = 1): Promise<void> {
      await client.sendNotification("textDocument/didOpen", {
        textDocument: { uri, languageId, version, text },
      });
    },
    async change(uri, text, version): Promise<void> {
      await client.sendNotification("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
    },
    async configure(settings): Promise<void> {
      await client.sendNotification("workspace/didChangeConfiguration", { settings });
    },
    async close(uri): Promise<void> {
      await client.sendNotification("textDocument/didClose", { textDocument: { uri } });
    },
    waitForDiagnostics(uri, predicate = () => true): Promise<PublishDiagnosticsParams> {
      const current = published.get(uri);
      if (current !== undefined && predicate(current.diagnostics)) return Promise.resolve(current);
      return new Promise((resolvePromise, rejectPromise): void => {
        const waiter = { uri, predicate, resolve: resolvePromise };
        waiters.push(waiter);
        const timeout = setTimeout((): void => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          rejectPromise(new Error(`Timed out waiting for diagnostics for ${uri}`));
        }, 2000);
        timeout.unref();
      });
    },
    logMessages(): readonly LogMessageParams[] {
      return logMessages;
    },
    waitForLog(predicate): Promise<LogMessageParams> {
      const current = logMessages.find(predicate);
      if (current !== undefined) return Promise.resolve(current);
      return new Promise((resolvePromise, rejectPromise): void => {
        const waiter = { predicate, resolve: resolvePromise };
        logWaiters.push(waiter);
        const timeout = setTimeout((): void => {
          const index = logWaiters.indexOf(waiter);
          if (index >= 0) logWaiters.splice(index, 1);
          rejectPromise(new Error("Timed out waiting for language server log output"));
        }, 2000);
        timeout.unref();
      });
    },
    async dispose(): Promise<void> {
      await client.sendRequest("shutdown");
      server.dispose();
      client.dispose();
      clientToServer.destroy();
      serverToClient.destroy();
    },
  };
}
