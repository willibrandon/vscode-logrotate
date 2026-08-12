import { beforeEach, describe, expect, it, vi } from "vitest";

interface FakeDocument {
  readonly uri: { toString(): string };
  languageId: string;
  lineCount: number;
  lineAt(line: number): { readonly text: string };
  setText(text: string): void;
}

const vscodeMock = vi.hoisted(() => {
  const documents: FakeDocument[] = [];
  const opened: ((document: FakeDocument) => void)[] = [];
  const changed: ((event: FakeChangeEvent) => void)[] = [];
  const assignments: { readonly uri: string; readonly language: string }[] = [];
  let nextAssignmentError: Error | undefined;

  interface FakeChangeEvent {
    readonly document: FakeDocument;
    readonly contentChanges: readonly {
      readonly range: {
        readonly start: { readonly line: number };
        readonly end: { readonly line: number };
      };
    }[];
  }

  const createDocument = (uri: string, languageId: string, text: string): FakeDocument => {
    let currentText = text;
    return {
      uri: { toString: () => uri },
      languageId,
      lineCount: text.split("\n").length,
      lineAt(line: number) {
        return { text: currentText.split("\n")[line] ?? "" };
      },
      setText(next: string): void {
        currentText = next;
        this.lineCount = next.split("\n").length;
      },
    };
  };

  return {
    assignments,
    changed,
    documents,
    opened,
    createDocument,
    failNextAssignment(error: Error): void {
      nextAssignmentError = error;
    },
    module: {
      languages: {
        setTextDocumentLanguage(document: FakeDocument, language: string): Promise<FakeDocument> {
          if (nextAssignmentError !== undefined) {
            const error = nextAssignmentError;
            nextAssignmentError = undefined;
            return Promise.reject(error);
          }
          document.languageId = language;
          assignments.push({ uri: document.uri.toString(), language });
          return Promise.resolve(document);
        },
      },
      workspace: {
        textDocuments: documents,
        onDidOpenTextDocument(listener: (document: FakeDocument) => void) {
          opened.push(listener);
          return listenerDisposable(opened, listener);
        },
        onDidChangeTextDocument(listener: (event: FakeChangeEvent) => void) {
          changed.push(listener);
          return listenerDisposable(changed, listener);
        },
      },
    },
  };

  function listenerDisposable<T>(listeners: T[], listener: T): { dispose(): void } {
    return {
      dispose(): void {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      },
    };
  }
});

vi.mock("vscode", () => vscodeMock.module);

describe("content detection registration", () => {
  beforeEach(() => {
    vscodeMock.assignments.length = 0;
    vscodeMock.changed.length = 0;
    vscodeMock.documents.length = 0;
    vscodeMock.opened.length = 0;
  });

  it("recovers existing, newly opened, and first-line-edited documents from competing languages", async () => {
    const { registerContentDetection } = await import("../src/common.js");
    const existing = vscodeMock.createDocument(
      "file:///workspace/included.conf",
      "properties",
      "/var/log/included.log {\n    rotote 2\n}\n",
    );
    const edited = vscodeMock.createDocument("file:///workspace/policy.conf", "properties", "name");
    const alreadyAssociated = vscodeMock.createDocument(
      "file:///workspace/logrotate.conf",
      "logrotate",
      "/var/log/root.log {",
    );
    vscodeMock.documents.push(existing, edited, alreadyAssociated);
    const subscriptions: { dispose(): void }[] = [];
    const output = { warn: vi.fn() };

    registerContentDetection({ subscriptions } as never, { output } as never);
    await vi.waitFor(() => expect(existing.languageId).toBe("logrotate"));

    const state = vscodeMock.createDocument(
      "file:///workspace/status.conf",
      "properties",
      "logrotate state -- version 2\n",
    );
    vscodeMock.documents.push(state);
    for (const listener of vscodeMock.opened) listener(state);
    await vi.waitFor(() => expect(state.languageId).toBe("logrotate-state"));

    edited.setText("/var/log/edited.log {\n}");
    for (const listener of vscodeMock.changed) {
      listener({
        document: edited,
        contentChanges: [{ range: { start: { line: 0 }, end: { line: 0 } } }],
      });
    }
    await vi.waitFor(() => expect(edited.languageId).toBe("logrotate"));

    expect(vscodeMock.assignments).toEqual([
      { uri: "file:///workspace/included.conf", language: "logrotate" },
      { uri: "file:///workspace/status.conf", language: "logrotate-state" },
      { uri: "file:///workspace/policy.conf", language: "logrotate" },
    ]);
    expect(output.warn).not.toHaveBeenCalled();

    for (const subscription of subscriptions) subscription.dispose();
    const afterDispose = vscodeMock.createDocument(
      "file:///workspace/after.conf",
      "properties",
      "/var/log/after.log {",
    );
    for (const listener of vscodeMock.opened) listener(afterDispose);
    expect(afterDispose.languageId).toBe("properties");
  });

  it("reports language-assignment failures without retrying unrelated changes", async () => {
    const { registerContentDetection } = await import("../src/common.js");
    const document = vscodeMock.createDocument(
      "file:///workspace/included.conf",
      "properties",
      "/var/log/included.log {",
    );
    vscodeMock.documents.push(document);
    vscodeMock.failNextAssignment(new Error("language service unavailable"));
    const output = { warn: vi.fn() };

    registerContentDetection({ subscriptions: [] } as never, { output } as never);

    await vi.waitFor(() => {
      expect(output.warn).toHaveBeenCalledWith(
        "Unable to detect the Logrotate language from document content: language service unavailable",
      );
    });
    expect(document.languageId).toBe("properties");
    expect(vscodeMock.assignments).toEqual([]);
  });
});
