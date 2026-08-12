import { afterEach, describe, expect, it } from "vitest";
import type {
  CodeAction,
  CompletionItem,
  DocumentLink,
  DocumentSymbol,
  FoldingRange,
  Hover,
  Location,
  SelectionRange,
  SemanticTokens,
  SignatureHelp,
  TextEdit,
} from "vscode-languageserver";
import { createServerHarness, type ServerHarness } from "./harness.js";

const uri = "file:///workspace/logrotate.conf";
let harness: ServerHarness | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

describe("shared language server contract", () => {
  it("advertises only the implemented shared capabilities", async () => {
    harness = await createServerHarness();
    expect(harness.initializeResult.capabilities).toMatchObject({
      textDocumentSync: 2,
      completionProvider: { triggerCharacters: [" ", "=", "/"] },
      hoverProvider: true,
      signatureHelpProvider: { triggerCharacters: [" "] },
      documentSymbolProvider: true,
      workspaceSymbolProvider: true,
      foldingRangeProvider: true,
      selectionRangeProvider: true,
      documentLinkProvider: { resolveProvider: false },
      definitionProvider: true,
      referencesProvider: true,
      documentHighlightProvider: true,
      documentFormattingProvider: true,
      documentRangeFormattingProvider: true,
      semanticTokensProvider: { full: true },
      codeActionProvider: { codeActionKinds: ["quickfix"] },
    });
    expect(harness.initializeResult.capabilities.semanticTokensProvider).not.toHaveProperty(
      "full.delta",
    );
  });

  it("logs initialization, document analysis, configuration, and close without document contents", async () => {
    harness = await createServerHarness();
    await harness.waitForLog(({ message }) => message.includes("language server initialized"));

    const privateDocumentText = "/var/log/private {\n  never-log-this-content\n}\n";
    await harness.open(uri, "logrotate", privateDocumentText);
    await harness.waitForDiagnostics(uri, (items) => items.length > 0);
    await harness.waitForLog(
      ({ message }) => message.includes("Analyzed") && message.includes(uri),
    );
    await harness.configure({
      logrotate: {
        validation: { enable: true, maxProblems: 25 },
        targetVersion: "latest\n[error] forged",
      },
    });
    const configurationLog = await harness.waitForLog(({ message }) =>
      message.includes("maxProblems=25"),
    );
    expect(configurationLog.message).not.toContain("\n");
    expect(configurationLog.message).toContain("targetVersion=latest�[error] forged");
    await harness.close(uri);
    await harness.waitForLog(({ message }) => message.includes("Closed") && message.includes(uri));

    const messages = harness.logMessages().map(({ message }) => message);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining("[initialize] Initializing Logrotate language server"),
        expect.stringContaining("[initialized] Logrotate language server initialized"),
        expect.stringContaining(`[textDocument/didOpen] Opened ${uri}`),
        expect.stringMatching(
          /\[textDocument\/publishDiagnostics\] Analyzed .*: \d+ diagnostic\(s\) across 1 resource\(s\)\./u,
        ),
        expect.stringContaining("[workspace/didChangeConfiguration] Configuration updated"),
        expect.stringContaining(`[textDocument/didClose] Closed ${uri}`),
      ]),
    );
    expect(messages.join("\n")).not.toContain("never-log-this-content");
  });

  it("formats virtual Git resources without encoded provider metadata", async () => {
    harness = await createServerHarness();
    const gitUri =
      "git:/home/brandon/src/dotsider/deploy/caddy-metrics-logrotate.git?%7B%22path%22%3A%22%2Fhome%2Fbrandon%2Fsrc%2Fdotsider%2Fdeploy%2Fcaddy-metrics-logrotate%22%2C%22ref%22%3A%22%22%7D";
    await harness.open(gitUri, "logrotate", "/var/log/caddy-metrics.log {\n  daily\n}\n");

    const opened = await harness.waitForLog(({ message }) =>
      message.includes("[textDocument/didOpen]"),
    );
    expect(opened.message).toContain(
      "Opened git:/home/brandon/src/dotsider/deploy/caddy-metrics-logrotate (logrotate, version 1).",
    );
    expect(opened.message).not.toMatch(/%22|%2F|%3A|%7B|\.git\?/u);

    await harness.waitForDiagnostics(gitUri);
    const analyzed = await harness.waitForLog(
      ({ message }) => message.includes("Analyzed") && message.includes("git:"),
    );
    expect(analyzed.message).toContain(
      "Analyzed git:/home/brandon/src/dotsider/deploy/caddy-metrics-logrotate (version 1)",
    );
    expect(analyzed.message).not.toContain("?");
  });

  it("debounces changes, publishes only the current version, caps findings, and clears on close", async () => {
    harness = await createServerHarness();
    await harness.open(uri, "logrotate", "UNKNOWN\n".repeat(120));
    await harness.change(uri, "daily\n", 2);
    const current = await harness.waitForDiagnostics(uri, (items) => items.length === 0);
    expect(current.version).toBe(2);
    await harness.change(uri, "UNKNOWN\n".repeat(120), 3);
    const malformed = await harness.waitForDiagnostics(uri, (items) => items.length === 100);
    expect(malformed.version).toBe(3);
    expect(malformed.diagnostics).toHaveLength(100);
    expect(malformed.diagnostics.every(({ source }) => source === "logrotate")).toBe(true);
    await harness.close(uri);
    expect(await harness.waitForDiagnostics(uri, (items) => items.length === 0)).toMatchObject({
      uri,
      diagnostics: [],
    });
  });

  it("offers state-aware directives, arguments, paths, and no logrotate items in shell bodies", async () => {
    harness = await createServerHarness({
      "file:///workspace": { entries: ["logrotate.d", "logs"] },
    });
    await harness.open(uri, "logrotate", "taboo");
    const globals = await request<CompletionItem[]>(
      harness,
      "textDocument/completion",
      position(0, 5),
    );
    expect(globals.map(({ label }) => label)).toContain("tabooext");
    expect(globals.map(({ label }) => label)).not.toContain("postrotate");

    await harness.change(uri, "/var/log/a {\n  po\n}\n", 2);
    const local = await request<CompletionItem[]>(
      harness,
      "textDocument/completion",
      position(1, 4),
    );
    expect(local.map(({ label }) => label)).toContain("postrotate");
    expect(local.map(({ label }) => label)).not.toContain("tabooext");

    await harness.change(uri, "/var/log/a {\n  size \n}\n", 3);
    const sizes = await request<CompletionItem[]>(
      harness,
      "textDocument/completion",
      position(1, 7),
    );
    expect(sizes.map(({ label }) => label)).toEqual(["1k", "1M", "1G", "100M"]);

    await harness.change(uri, "include /workspace/lo", 4);
    const paths = await request<CompletionItem[]>(
      harness,
      "textDocument/completion",
      position(0, 21),
    );
    expect(paths.map(({ label }) => label)).toEqual(["logrotate.d", "logs"]);

    await harness.change(uri, "/var/log/a {\npostrotate\n  dai\nendscript\n}\n", 5);
    const shell = await request<CompletionItem[]>(
      harness,
      "textDocument/completion",
      position(2, 5),
    );
    expect(shell).toEqual([]);
  });

  it("returns complete hover and quote-aware signature help", async () => {
    harness = await createServerHarness();
    await harness.open(uri, "logrotate", 'create 0640 "service user" group\n');
    const hover = await request<Hover | null>(harness, "textDocument/hover", position(0, 2));
    expect(markdown(hover)).toContain("Valid in: global, block");
    expect(markdown(hover)).toContain("Since:");
    expect(markdown(hover)).toContain("Upstream documentation");
    const signature = await request<SignatureHelp | null>(
      harness,
      "textDocument/signatureHelp",
      position(0, 27),
    );
    expect(signature?.signatures[0]?.label).toBe("create <mode> <owner> <group>");
    expect(signature?.activeParameter).toBe(2);
  });

  it("provides symbols, folds, selection, links, definition, references, and semantic refinements", async () => {
    harness = await createServerHarness({
      "file:///workspace/parts": { text: "daily\n" },
    });
    const source = `include parts
/var/log/a
/var/log/b {
  create 0640 user group
  postrotate
    echo daily
  endscript
}
`;
    await harness.open(uri, "logrotate", source);
    const symbols = await request<DocumentSymbol[]>(
      harness,
      "textDocument/documentSymbol",
      textDocument(),
    );
    expect(symbols.map(({ name }) => name)).toEqual(["include parts", "/var/log/a /var/log/b"]);
    expect(symbols[1]?.children?.[0]?.name).toBe("postrotate");

    const folds = await request<FoldingRange[]>(
      harness,
      "textDocument/foldingRange",
      textDocument(),
    );
    expect(folds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ startLine: 1, endLine: 8 }),
        expect.objectContaining({ startLine: 1, endLine: 3 }),
        expect.objectContaining({ startLine: 4, endLine: 7 }),
      ]),
    );

    const selections = await request<SelectionRange[]>(harness, "textDocument/selectionRange", {
      textDocument: { uri },
      positions: [{ line: 3, character: 4 }],
    });
    expect(selections[0]?.range).toEqual({
      start: { line: 3, character: 2 },
      end: { line: 3, character: 8 },
    });
    expect(selections[0]?.parent?.parent?.parent).toBeDefined();

    const links = await request<DocumentLink[]>(
      harness,
      "textDocument/documentLink",
      textDocument(),
    );
    expect(links[0]?.target).toBe("file:///workspace/parts");
    const definition = await request<Location[]>(
      harness,
      "textDocument/definition",
      position(0, 10),
    );
    expect(definition[0]?.uri).toBe("file:///workspace/parts");

    const references = await request<Location[]>(harness, "textDocument/references", {
      ...position(3, 3),
      context: { includeDeclaration: true },
    });
    expect(references).toHaveLength(1);

    const tokens = await request<SemanticTokens>(
      harness,
      "textDocument/semanticTokens/full",
      textDocument(),
    );
    expect(tokens.data.length).toBeGreaterThanOrEqual(25);
  });

  it("returns minimal formatting edits and safe diagnostic-driven code actions", async () => {
    harness = await createServerHarness();
    await harness.open(uri, "logrotate", "/var/log/a {\nsize= 10M\n}\n");
    const edits = await request<TextEdit[]>(harness, "textDocument/formatting", {
      textDocument: { uri },
      options: { tabSize: 2, insertSpaces: true },
    });
    expect(edits).toEqual([
      expect.objectContaining({
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 5 },
        },
        newText: "  size",
      }),
    ]);

    await harness.change(uri, "rotat 4\n", 2);
    const diagnosis = await harness.waitForDiagnostics(uri, (items) => items.length > 0);
    const actions = await request<CodeAction[]>(harness, "textDocument/codeAction", {
      textDocument: { uri },
      range: diagnosis.diagnostics[0]?.range,
      context: { diagnostics: diagnosis.diagnostics },
    });
    expect(actions[0]).toMatchObject({
      title: "Replace with “rotate”",
      kind: "quickfix",
      isPreferred: true,
    });
    expect(actions.some(({ title }) => /reorder/iu.test(title))).toBe(false);
  });

  it("keeps state files read-only while providing diagnostics and warning hover", async () => {
    harness = await createServerHarness();
    await harness.open(uri, "logrotate-state", "bad header\n/path today\n");
    const diagnostics = await harness.waitForDiagnostics(uri, (items) => items.length > 0);
    expect(diagnostics.diagnostics.every(({ source }) => source === "logrotate-state")).toBe(true);
    const hover = await request<Hover | null>(harness, "textDocument/hover", position(1, 2));
    expect(markdown(hover)).toContain("machine-managed state record");
    expect(
      await request<CompletionItem[]>(harness, "textDocument/completion", position(1, 2)),
    ).toEqual([]);
    expect(
      await request<TextEdit[]>(harness, "textDocument/formatting", {
        textDocument: { uri },
        options: { tabSize: 2, insertSpaces: true },
      }),
    ).toEqual([]);
    expect(
      await request<CodeAction[]>(harness, "textDocument/codeAction", {
        textDocument: { uri },
        range: diagnostics.diagnostics[0]?.range,
        context: { diagnostics: diagnostics.diagnostics },
      }),
    ).toEqual([]);
  });

  it("loads includes through protocol requests and publishes and clears cross-file diagnostics", async () => {
    const includedUri = "file:///workspace/parts";
    harness = await createServerHarness({
      [includedUri]: { text: "UNKNOWN\n" },
    });
    await harness.open(uri, "logrotate", "include parts\n");
    const included = await harness.waitForDiagnostics(includedUri, (items) => items.length > 0);
    expect(included.diagnostics[0]).toMatchObject({ code: "LR1001", source: "logrotate" });
    await harness.change(uri, "daily\n", 2);
    expect(
      await harness.waitForDiagnostics(includedUri, (items) => items.length === 0),
    ).toMatchObject({
      uri: includedUri,
      diagnostics: [],
    });
  });
});

function textDocument(): { readonly textDocument: { readonly uri: string } } {
  return { textDocument: { uri } };
}

function position(
  line: number,
  character: number,
): {
  readonly textDocument: { readonly uri: string };
  readonly position: { readonly line: number; readonly character: number };
} {
  return { textDocument: { uri }, position: { line, character } };
}

function request<T>(active: ServerHarness, method: string, params: unknown): Promise<T> {
  return active.client.sendRequest<T>(method, params);
}

function markdown(hover: Hover | null): string {
  if (hover === null) return "";
  const contents = hover.contents;
  return typeof contents === "string"
    ? contents
    : Array.isArray(contents)
      ? contents.map((value) => (typeof value === "string" ? value : value.value)).join("\n")
      : contents.value;
}
