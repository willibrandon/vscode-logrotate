import { CancellationTokenSource } from "vscode-jsonrpc";
import { afterEach, describe, expect, it } from "vitest";
import type {
  CodeAction,
  CompletionItem,
  Diagnostic,
  DocumentHighlight,
  DocumentLink,
  DocumentSymbol,
  FoldingRange,
  Hover,
  Location,
  SelectionRange,
  SemanticTokens,
  SignatureHelp,
  SymbolInformation,
  TextEdit,
} from "vscode-languageserver";
import { createServerHarness, type ServerHarness } from "./harness.js";

const uri = "file:///workspace/logrotate.conf";
let harness: ServerHarness | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

describe("shared language server edge contracts", () => {
  it("returns neutral responses for every document request against an unopened URI", async () => {
    harness = await createServerHarness();
    const missing = "file:///workspace/missing";
    const textDocument = { textDocument: { uri: missing } };
    const positioned = { ...textDocument, position: { line: 0, character: 0 } };
    expect(await send<CompletionItem[]>("textDocument/completion", positioned)).toEqual([]);
    expect(await send<Hover | null>("textDocument/hover", positioned)).toBeNull();
    expect(await send<SignatureHelp | null>("textDocument/signatureHelp", positioned)).toBeNull();
    expect(await send<DocumentSymbol[]>("textDocument/documentSymbol", textDocument)).toEqual([]);
    expect(await send<FoldingRange[]>("textDocument/foldingRange", textDocument)).toEqual([]);
    expect(
      await send<SelectionRange[]>("textDocument/selectionRange", {
        ...textDocument,
        positions: [{ line: 0, character: 0 }],
      }),
    ).toEqual([]);
    expect(await send<DocumentLink[]>("textDocument/documentLink", textDocument)).toEqual([]);
    expect(await send<Location[]>("textDocument/definition", positioned)).toEqual([]);
    expect(
      await send<Location[]>("textDocument/references", {
        ...positioned,
        context: { includeDeclaration: true },
      }),
    ).toEqual([]);
    expect(await send<DocumentHighlight[]>("textDocument/documentHighlight", positioned)).toEqual(
      [],
    );
    expect(
      await send<TextEdit[]>("textDocument/formatting", {
        ...textDocument,
        options: { tabSize: 2, insertSpaces: true },
      }),
    ).toEqual([]);
    expect(
      await send<TextEdit[]>("textDocument/rangeFormatting", {
        ...textDocument,
        range: zeroRange(),
        options: { tabSize: 2, insertSpaces: true },
      }),
    ).toEqual([]);
    expect(
      await send<SemanticTokens>("textDocument/semanticTokens/full", textDocument),
    ).toMatchObject({ data: [] });
    expect(
      await send<CodeAction[]>("textDocument/codeAction", {
        ...textDocument,
        range: zeroRange(),
        context: { diagnostics: [] },
      }),
    ).toEqual([]);
  });

  it("applies partial settings, disables validation, and caps revalidation", async () => {
    harness = await createServerHarness();
    await harness.open(uri, "logrotate", "UNKNOWN\n".repeat(10));
    expect((await harness.waitForDiagnostics(uri, (items) => items.length === 10)).version).toBe(1);

    await harness.configure({ logrotate: { validation: { enable: false } } });
    expect(await harness.waitForDiagnostics(uri, (items) => items.length === 0)).toMatchObject({
      uri,
      diagnostics: [],
    });

    await harness.configure({
      logrotate: { validation: { enable: true, maxProblems: 2 }, targetVersion: "3.22" },
    });
    const capped = await harness.waitForDiagnostics(uri, (items) => items.length === 2);
    expect(capped.diagnostics).toHaveLength(2);
    await harness.change(uri, "daily\n", 2);
    await harness.waitForDiagnostics(uri, (items) => items.length === 0);
    const hover = await send<Hover | null>("textDocument/hover", at(0, 2));
    expect(hoverText(hover)).toContain("Target: 3.22");
  });

  it("handles cancellation, script terminators, bounded paths, and unavailable paths", async () => {
    const entries = Array.from(
      { length: 205 },
      (_, index) => `log-${String(index).padStart(3, "0")}`,
    );
    harness = await createServerHarness({
      "file:///workspace": { entries, readDelayMilliseconds: 25 },
    });
    await harness.open(uri, "logrotate", "include log-");
    const cancellation = new CancellationTokenSource();
    const cancelledRequest = harness.client.sendRequest<CompletionItem[]>(
      "textDocument/completion",
      at(0, 12),
      cancellation.token,
    );
    setTimeout(() => cancellation.cancel(), 1);
    expect(await cancelledRequest).toEqual([]);
    cancellation.dispose();

    await harness.change(uri, "/var/log/a {\npostrotate\n\nendscript\n}\n", 2);
    expect((await send<CompletionItem[]>("textDocument/completion", at(2, 0)))[0]).toMatchObject({
      label: "endscript",
      insertText: "endscript",
    });
    await harness.change(uri, "/var/log/a {\npostrotate\nend\nendscript\n}\n", 3);
    expect((await send<CompletionItem[]>("textDocument/completion", at(2, 3)))[0]?.label).toBe(
      "endscript",
    );

    await harness.change(uri, 'include "log-', 4);
    expect(await send<CompletionItem[]>("textDocument/completion", at(0, 13))).toHaveLength(200);
    await harness.change(uri, "include missing/path", 5);
    expect(await send<CompletionItem[]>("textDocument/completion", at(0, 20))).toEqual([]);
    await harness.change(uri, "unknown value", 6);
    expect(await send<CompletionItem[]>("textDocument/completion", at(0, 13))).toEqual([]);
  });

  it("provides null, deprecated, related, and active-argument help states", async () => {
    harness = await createServerHarness();
    await harness.open(uri, "logrotate", "errors\ndelaycompress\nsu service group\n");
    expect(await send<Hover | null>("textDocument/hover", at(2, 9))).toBeNull();
    expect(hoverText(await send<Hover | null>("textDocument/hover", at(0, 2)))).toContain(
      "Deprecated and ignored",
    );
    expect(hoverText(await send<Hover | null>("textDocument/hover", at(1, 4)))).toContain(
      "Related: `compress`",
    );
    expect(await send<SignatureHelp | null>("textDocument/signatureHelp", at(1, 5))).toBeNull();
    const signature = await send<SignatureHelp | null>("textDocument/signatureHelp", at(2, 16));
    expect(signature).toMatchObject({
      activeSignature: 0,
      activeParameter: 1,
      signatures: [{ label: "su <user> <group>", activeParameter: 1 }],
    });
  });

  it("searches symbols and navigates repeated directives across loaded documents", async () => {
    const second = "file:///workspace/second.conf";
    const state = "file:///workspace/logrotate.status";
    harness = await createServerHarness();
    await harness.open(uri, "logrotate", "daily\n/var/log/a {\n  daily\n}\n");
    await harness.open(second, "logrotate", "/var/log/b {\n  daily\n}\n");
    await harness.open(
      state,
      "logrotate-state",
      'logrotate state -- version 2\n"/var/log/a" 2026-1-1\n',
    );

    const all = await send<SymbolInformation[]>("workspace/symbol", { query: "" });
    expect(all.map(({ name }) => name)).toEqual(["/var/log/a", "/var/log/b"]);
    expect(await send<SymbolInformation[]>("workspace/symbol", { query: "LOG/B" })).toHaveLength(1);
    expect(await send<SymbolInformation[]>("workspace/symbol", { query: "absent" })).toEqual([]);

    const definition = await send<Location[]>("textDocument/definition", at(2, 4));
    expect(definition).toEqual([
      expect.objectContaining({
        uri,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
      }),
    ]);
    const references = await send<Location[]>("textDocument/references", {
      ...at(2, 4),
      context: { includeDeclaration: true },
    });
    expect(references.map(({ uri: resource }) => resource)).toEqual([uri, uri, second]);
    const highlights = await send<DocumentHighlight[]>("textDocument/documentHighlight", at(2, 4));
    expect(highlights).toHaveLength(2);
    expect(highlights.every(({ kind }) => kind === 2)).toBe(true);

    expect(await send<Location[]>("textDocument/definition", at(1, 0))).toEqual([]);
    expect(
      await send<Location[]>("textDocument/references", {
        ...at(1, 0),
        context: { includeDeclaration: true },
      }),
    ).toEqual([]);
    expect(await send<DocumentHighlight[]>("textDocument/documentHighlight", at(1, 0))).toEqual([]);
  });

  it("returns structural fallbacks for empty selections, links, symbols, and folds", async () => {
    harness = await createServerHarness();
    await harness.open(uri, "logrotate", "include\n\n/var/log/a { daily }");
    expect(await send<DocumentLink[]>("textDocument/documentLink", document())).toEqual([]);
    const symbols = await send<DocumentSymbol[]>("textDocument/documentSymbol", document());
    expect(symbols.map(({ name }) => name)).toEqual(["include", "/var/log/a"]);
    expect(await send<FoldingRange[]>("textDocument/foldingRange", document())).toEqual([]);
    await harness.change(uri, "", 2);
    const selections = await send<SelectionRange[]>("textDocument/selectionRange", {
      ...document(),
      positions: [{ line: 0, character: 0 }],
    });
    expect(selections).toHaveLength(1);
    expect(selections[0]?.range.start).toEqual({ line: 0, character: 0 });
  });

  it("classifies every semantic-token family and deprecated modifiers", async () => {
    harness = await createServerHarness();
    await harness.open(
      uri,
      "logrotate",
      [
        "# comment",
        "errors ignored",
        "rotate 4",
        "olddir /archive",
        "su service group",
        "create 0640 owner group",
        "/var/log/a { daily }",
        "",
      ].join("\n"),
    );
    const tokens = await send<SemanticTokens>("textDocument/semanticTokens/full", document());
    const tokenTypes = new Set<number>();
    const modifiers = new Set<number>();
    for (let index = 0; index < tokens.data.length; index += 5) {
      tokenTypes.add(tokens.data[index + 3] ?? -1);
      modifiers.add(tokens.data[index + 4] ?? -1);
    }
    expect(tokenTypes).toEqual(new Set([0, 1, 2, 3, 4]));
    expect(modifiers).toContain(1);
  });

  it("maps tags and related locations and offers every safe diagnostic repair", async () => {
    harness = await createServerHarness();
    const source = [
      "ERRORS",
      "errors",
      "delaycompress",
      "dateformat -%Y%m%d",
      "shredcycles 3",
      "create",
      "copytruncate",
      "/var/log/a {",
      "  postrotate",
      "    echo hello",
      "",
    ].join("\n");
    await harness.open(uri, "logrotate", source);
    const publication = await harness.waitForDiagnostics(uri, (items) =>
      items.some(({ code }) => code === "LR1009"),
    );
    const deprecated = publication.diagnostics.find(({ code }) => code === "LR2001");
    const related = publication.diagnostics.find(({ code }) => code === "LR2006");
    expect(deprecated?.tags).toEqual([2, 1]);
    expect(related?.relatedInformation?.[0]?.location.uri).toBe(uri);

    const actions = await send<CodeAction[]>("textDocument/codeAction", {
      ...document(),
      range: fullDocumentRange(source),
      context: { diagnostics: publication.diagnostics },
    });
    expect(actions.map(({ title }) => title)).toEqual(
      expect.arrayContaining([
        "Replace with “errors”",
        "Add prerequisite “compress”",
        "Add prerequisite “dateext”",
        "Add prerequisite “shred”",
        "Add missing closing brace",
        "Add missing endscript",
      ]),
    );
    expect(actions.every(({ kind }) => kind === "quickfix")).toBe(true);
    expect(
      actions
        .filter(({ title }) => !title.startsWith("Open upstream documentation"))
        .every(({ isPreferred }) => isPreferred === true),
    ).toBe(true);
    expect(
      actions
        .filter(({ title }) => title.startsWith("Open upstream documentation"))
        .every(({ isPreferred }) => isPreferred === false),
    ).toBe(true);

    const inertDiagnostics: Diagnostic[] = [
      { range: zeroRange(), message: "unknown", code: "LR1001" },
      { range: zeroRange(), message: "unrelated", code: "LR9999" },
    ];
    expect(
      await send<CodeAction[]>("textDocument/codeAction", {
        ...document(),
        range: zeroRange(),
        context: { diagnostics: inertDiagnostics },
      }),
    ).toEqual([]);
  });

  it("formats only the requested range and clears included diagnostics when a root closes", async () => {
    const included = "file:///workspace/included.conf";
    harness = await createServerHarness({ [included]: { text: "UNKNOWN\n" } });
    await harness.open(uri, "logrotate", "include included.conf\n/var/log/a {\nsize= 10M\n}\n");
    await harness.waitForDiagnostics(included, (items) => items.length > 0);
    const edits = await send<TextEdit[]>("textDocument/rangeFormatting", {
      ...document(),
      range: {
        start: { line: 1, character: 0 },
        end: { line: 3, character: 1 },
      },
      options: { tabSize: 2, insertSpaces: true },
    });
    expect(edits).toEqual([
      expect.objectContaining({
        range: {
          start: { line: 2, character: 0 },
          end: { line: 2, character: 5 },
        },
        newText: "  size",
      }),
    ]);
    await harness.close(uri);
    expect(await harness.waitForDiagnostics(included, (items) => items.length === 0)).toMatchObject(
      {
        uri: included,
        diagnostics: [],
      },
    );
  });
});

function document(): { readonly textDocument: { readonly uri: string } } {
  return { textDocument: { uri } };
}

function at(line: number, character: number) {
  return { ...document(), position: { line, character } };
}

function send<T>(method: string, params: unknown): Promise<T> {
  if (harness === undefined) throw new Error("Server harness is not active.");
  return harness.client.sendRequest<T>(method, params);
}

function zeroRange() {
  return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
}

function fullDocumentRange(source: string) {
  const lines = source.split("\n");
  return {
    start: { line: 0, character: 0 },
    end: { line: lines.length - 1, character: lines.at(-1)?.length ?? 0 },
  };
}

function hoverText(hover: Hover | null): string {
  if (hover === null) return "";
  return Array.isArray(hover.contents)
    ? hover.contents
        .map((content) => (typeof content === "string" ? content : content.value))
        .join("\n")
    : typeof hover.contents === "string"
      ? hover.contents
      : hover.contents.value;
}
