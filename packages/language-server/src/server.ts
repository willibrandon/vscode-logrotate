import {
  analyze,
  completionTable,
  directiveByName,
  format,
  parse,
  parseState,
  rotationBlocks,
} from "@logrotate/language-core";
import type {
  CoreDiagnostic,
  DirectiveNode,
  DocumentNode,
  ParsedDocument,
  TextSpan,
} from "@logrotate/language-core";
import {
  CodeActionKind,
  CompletionItemKind,
  DiagnosticSeverity,
  DiagnosticTag,
  DocumentHighlightKind,
  FoldingRangeKind,
  InsertTextFormat,
  MarkupKind,
  SemanticTokensBuilder,
  SymbolKind,
  TextDocumentSyncKind,
  TextDocuments,
} from "vscode-languageserver";
import type {
  CodeAction,
  CompletionItem,
  Connection,
  Diagnostic,
  DocumentHighlight,
  DocumentLink,
  DocumentSymbol,
  FoldingRange,
  Hover,
  InitializeResult,
  Location,
  Position,
  SelectionRange,
  SemanticTokens,
  SignatureHelp,
  TextEdit,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";

const tokenTypes = ["keyword", "string", "number", "comment", "parameter"] as const;
const tokenModifiers = ["deprecated"] as const;

export interface ServerSettings {
  readonly validation: {
    readonly enable: boolean;
    readonly maxProblems: number;
  };
  readonly targetVersion: string;
}

const defaultSettings: ServerSettings = {
  validation: { enable: true, maxProblems: 100 },
  targetVersion: "latest",
};

export function startLanguageServer(connection: Connection): void {
  const documents = new TextDocuments(TextDocument);
  let settings: ServerSettings = defaultSettings;

  connection.onInitialize((): InitializeResult => ({
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: { triggerCharacters: [" ", "=", "/"] },
      hoverProvider: true,
      signatureHelpProvider: { triggerCharacters: [" "] },
      documentSymbolProvider: true,
      foldingRangeProvider: true,
      selectionRangeProvider: true,
      documentLinkProvider: { resolveProvider: false },
      definitionProvider: true,
      referencesProvider: true,
      documentHighlightProvider: true,
      documentFormattingProvider: true,
      documentRangeFormattingProvider: true,
      semanticTokensProvider: {
        legend: { tokenTypes: [...tokenTypes], tokenModifiers: [...tokenModifiers] },
        full: true,
      },
      codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix] },
    },
  }));

  connection.onDidChangeConfiguration((event): void => {
    const candidate = (event.settings as { readonly logrotate?: Partial<ServerSettings> })
      .logrotate;
    settings = {
      validation: {
        enable: candidate?.validation?.enable ?? defaultSettings.validation.enable,
        maxProblems: candidate?.validation?.maxProblems ?? defaultSettings.validation.maxProblems,
      },
      targetVersion: candidate?.targetVersion ?? defaultSettings.targetVersion,
    };
    for (const document of documents.all()) {
      publishDiagnostics(connection, document, settings);
    }
  });

  documents.onDidOpen(({ document }): void => publishDiagnostics(connection, document, settings));
  documents.onDidChangeContent(({ document }): void =>
    publishDiagnostics(connection, document, settings),
  );
  documents.onDidClose(({ document }): void => {
    void connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
  });

  connection.onCompletion((params): CompletionItem[] => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined || document.languageId === "logrotate-state") {
      return [];
    }
    const line = document.getText({
      start: { line: params.position.line, character: 0 },
      end: params.position,
    });
    if (insideScript(parse(document.getText()), document.offsetAt(params.position))) {
      return line.trim() === "" || "endscript".startsWith(line.trim())
        ? [{ label: "endscript", kind: CompletionItemKind.Keyword, insertText: "endscript" }]
        : [];
    }
    const scope = scopeAt(parse(document.getText()), document.offsetAt(params.position));
    return completionTable
      .filter(({ label }) => directiveByName.get(label)?.scopes.includes(scope) === true)
      .map((item): CompletionItem => ({
        label: item.label,
        kind: item.deprecated ? CompletionItemKind.Text : CompletionItemKind.Keyword,
        detail: item.detail,
        insertText: item.insertText,
        insertTextFormat: InsertTextFormat.Snippet,
        ...(item.deprecated ? { tags: [1] } : {}),
      }));
  });

  connection.onHover((params): Hover | null => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined) {
      return null;
    }
    if (document.languageId === "logrotate-state") {
      return {
        contents: {
          kind: MarkupKind.Markdown,
          value:
            "This machine-managed state record controls when a log is considered last rotated. Editing it can change rotation history.",
        },
      };
    }
    const word = wordAt(document, params.position);
    const definition = directiveByName.get(word.text);
    if (definition === undefined) {
      return null;
    }
    const status = definition.deprecated ? "\n\n**Deprecated and ignored.**" : "";
    return {
      range: word.range,
      contents: {
        kind: MarkupKind.Markdown,
        value: `**${definition.name}** · ${definition.arguments.kind}\n\n${definition.summary}${status}\n\nValid in: ${definition.scopes.join(", ")} · [Upstream documentation](${definition.documentation})`,
      },
    };
  });

  connection.onSignatureHelp((params): SignatureHelp | null => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined) {
      return null;
    }
    const prefix = document.getText({
      start: { line: params.position.line, character: 0 },
      end: params.position,
    });
    const match = /^\s*(createolddir|create|su)\s+(.*)$/u.exec(prefix);
    if (match === null) {
      return null;
    }
    const labels: Readonly<Record<string, readonly string[]>> = {
      create: ["mode", "owner", "group"],
      createolddir: ["mode", "owner", "group"],
      su: ["user", "group"],
    };
    const name = match[1] ?? "";
    const parameters = labels[name] ?? [];
    const activeParameter = Math.min(
      Math.max(0, (match[2] ?? "").trim().split(/\s+/u).length - 1),
      parameters.length - 1,
    );
    return {
      activeSignature: 0,
      activeParameter,
      signatures: [
        {
          label: `${name} ${parameters.map((parameter) => `<${parameter}>`).join(" ")}`,
          parameters: parameters.map((label) => ({ label })),
          activeParameter,
        },
      ],
    };
  });

  connection.onDocumentSymbol((params): DocumentSymbol[] => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined || document.languageId === "logrotate-state") {
      return [];
    }
    const parsed = parse(document.getText());
    return rotationBlocks(parsed).map((block): DocumentSymbol => ({
      name: block.header.paths.map(({ value }) => value).join(" ") || "Rotation block",
      kind: SymbolKind.Object,
      range: range(document, block),
      selectionRange: range(document, block.header),
      children: block.children
        .filter((node) => node.kind === "script")
        .map((script): DocumentSymbol => ({
          name: script.starter.name,
          kind: SymbolKind.Function,
          range: range(document, script),
          selectionRange: range(document, script.starter.nameSpan),
        })),
    }));
  });

  connection.onFoldingRanges((params): FoldingRange[] => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined) {
      return [];
    }
    const result: FoldingRange[] = [];
    walk(parse(document.getText()).children, (node): void => {
      if (node.kind === "rotation-block" || node.kind === "script" || node.kind === "path-header") {
        const nodeRange = range(document, node);
        if (nodeRange.end.line > nodeRange.start.line) {
          result.push({
            startLine: nodeRange.start.line,
            endLine: nodeRange.end.line,
            ...(node.kind === "script" ? { kind: FoldingRangeKind.Region } : {}),
          });
        }
      }
    });
    return result;
  });

  connection.onSelectionRanges((params): SelectionRange[] => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined) {
      return [];
    }
    const parsed = parse(document.getText());
    return params.positions.map((position): SelectionRange => {
      const offset = document.offsetAt(position);
      const containing = containingNodes(parsed.children, offset);
      let parent: SelectionRange = { range: range(document, parsed) };
      for (const node of containing) {
        parent = { range: range(document, node), parent };
      }
      return { range: { start: position, end: position }, parent };
    });
  });

  connection.onDocumentLinks((params): DocumentLink[] => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined) {
      return [];
    }
    const links: DocumentLink[] = [];
    walk(parse(document.getText()).children, (node): void => {
      if (node.kind === "include" && node.target !== undefined) {
        links.push({
          range: range(document, node.target),
          tooltip: "Open included logrotate resource",
        });
      }
    });
    return links;
  });

  connection.onDefinition((params): Location[] => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined) {
      return [];
    }
    const offset = document.offsetAt(params.position);
    const parsed = parse(document.getText());
    const selected = directiveAt(parsed.children, offset);
    if (selected === undefined) {
      return [];
    }
    const first = allDirectives(parsed.children).find(({ name }) => name === selected.name);
    return first === undefined
      ? []
      : [{ uri: document.uri, range: range(document, first.nameSpan) }];
  });

  connection.onReferences((params): Location[] => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined) {
      return [];
    }
    const selected = directiveAt(
      parse(document.getText()).children,
      document.offsetAt(params.position),
    );
    if (selected === undefined) {
      return [];
    }
    return allDirectives(parse(document.getText()).children)
      .filter(({ name }) => name === selected.name)
      .map((directive): Location => ({
        uri: document.uri,
        range: range(document, directive.nameSpan),
      }));
  });

  connection.onDocumentHighlight((params): DocumentHighlight[] => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined) {
      return [];
    }
    const parsed = parse(document.getText());
    const selected = directiveAt(parsed.children, document.offsetAt(params.position));
    return selected === undefined
      ? []
      : allDirectives(parsed.children)
          .filter(({ name }) => name === selected.name)
          .map((directive): DocumentHighlight => ({
            range: range(document, directive.nameSpan),
            kind: DocumentHighlightKind.Read,
          }));
  });

  connection.onDocumentFormatting((params): TextEdit[] => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined || document.languageId === "logrotate-state") {
      return [];
    }
    return format(document.getText(), {
      insertSpaces: params.options.insertSpaces,
      tabSize: params.options.tabSize,
    }).map((edit): TextEdit => ({ range: range(document, edit), newText: edit.newText }));
  });

  connection.onDocumentRangeFormatting((params): TextEdit[] => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined || document.languageId === "logrotate-state") {
      return [];
    }
    return format(document.getText(), {
      insertSpaces: params.options.insertSpaces,
      tabSize: params.options.tabSize,
      range: {
        start: document.offsetAt(params.range.start),
        end: document.offsetAt(params.range.end),
      },
    }).map((edit): TextEdit => ({ range: range(document, edit), newText: edit.newText }));
  });

  connection.languages.semanticTokens.on((params): SemanticTokens => {
    const document = documents.get(params.textDocument.uri);
    const builder = new SemanticTokensBuilder();
    if (document === undefined || document.languageId === "logrotate-state") {
      return builder.build();
    }
    for (const directive of allDirectives(parse(document.getText()).children)) {
      const start = document.positionAt(directive.nameSpan.start);
      builder.push(
        start.line,
        start.character,
        directive.nameSpan.end - directive.nameSpan.start,
        0,
        directive.definition?.deprecated === true ? 1 : 0,
      );
    }
    return builder.build();
  });

  connection.onCodeAction((params): CodeAction[] => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined || document.languageId === "logrotate-state") {
      return [];
    }
    return params.context.diagnostics.flatMap((diagnostic): readonly CodeAction[] => {
      if (diagnostic.code === "LR1007") {
        const lower = document.getText(diagnostic.range).toLowerCase();
        return [
          {
            title: `Replace with “${lower}”`,
            kind: CodeActionKind.QuickFix,
            isPreferred: true,
            diagnostics: [diagnostic],
            edit: { changes: { [document.uri]: [{ range: diagnostic.range, newText: lower }] } },
          },
        ];
      }
      if (diagnostic.code === "LR1006") {
        const end = document.positionAt(document.getText().length);
        return [
          {
            title: "Add missing closing brace",
            kind: CodeActionKind.QuickFix,
            isPreferred: true,
            diagnostics: [diagnostic],
            edit: {
              changes: {
                [document.uri]: [
                  {
                    range: { start: end, end },
                    newText: `${detectNewline(document.getText())}}${detectNewline(document.getText())}`,
                  },
                ],
              },
            },
          },
        ];
      }
      if (diagnostic.code === "LR1009") {
        const end = document.positionAt(document.getText().length);
        return [
          {
            title: "Add missing endscript",
            kind: CodeActionKind.QuickFix,
            isPreferred: true,
            diagnostics: [diagnostic],
            edit: {
              changes: {
                [document.uri]: [
                  {
                    range: { start: end, end },
                    newText: `${detectNewline(document.getText())}endscript${detectNewline(document.getText())}`,
                  },
                ],
              },
            },
          },
        ];
      }
      return [];
    });
  });

  documents.listen(connection);
  connection.listen();
}

function publishDiagnostics(
  connection: Connection,
  document: TextDocument,
  settings: ServerSettings,
): void {
  if (!settings.validation.enable) {
    void connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
    return;
  }
  const core =
    document.languageId === "logrotate-state"
      ? parseState(document.getText(), { maxProblems: settings.validation.maxProblems }).diagnostics
      : analyze(
          parse(document.getText(), {
            maxProblems: settings.validation.maxProblems,
            targetVersion: settings.targetVersion,
          }),
        );
  void connection.sendDiagnostics({
    uri: document.uri,
    version: document.version,
    diagnostics: core
      .slice(0, settings.validation.maxProblems)
      .map((item): Diagnostic => toDiagnostic(document, item)),
  });
}

function toDiagnostic(document: TextDocument, diagnostic: CoreDiagnostic): Diagnostic {
  const severity: Readonly<Record<CoreDiagnostic["severity"], DiagnosticSeverity>> = {
    error: DiagnosticSeverity.Error,
    warning: DiagnosticSeverity.Warning,
    information: DiagnosticSeverity.Information,
    hint: DiagnosticSeverity.Hint,
  };
  return {
    range: range(document, diagnostic),
    severity: severity[diagnostic.severity],
    code: diagnostic.code,
    source: diagnostic.source,
    message: diagnostic.message,
    ...(diagnostic.tags === undefined
      ? {}
      : {
          tags: diagnostic.tags.map((tag) =>
            tag === "deprecated" ? DiagnosticTag.Deprecated : DiagnosticTag.Unnecessary,
          ),
        }),
    ...(diagnostic.related === undefined
      ? {}
      : {
          relatedInformation: diagnostic.related.map((related) => ({
            location: { uri: document.uri, range: range(document, related) },
            message: "Related configuration",
          })),
        }),
  };
}

function range(
  document: TextDocument,
  span: TextSpan,
): { readonly start: Position; readonly end: Position } {
  return { start: document.positionAt(span.start), end: document.positionAt(span.end) };
}

function wordAt(
  document: TextDocument,
  position: Position,
): { readonly text: string; readonly range: { readonly start: Position; readonly end: Position } } {
  const lineStart = document.offsetAt({ line: position.line, character: 0 });
  const lineEnd = document.offsetAt({ line: position.line + 1, character: 0 });
  const line = document.getText().slice(lineStart, lineEnd);
  const local = document.offsetAt(position) - lineStart;
  const words = [...line.matchAll(/[A-Za-z]+/gu)];
  const match = words.find(({ index, 0: text }) => index <= local && index + text.length >= local);
  const start = lineStart + (match?.index ?? local);
  const text = match?.[0] ?? "";
  return { text, range: range(document, { start, end: start + text.length }) };
}

function walk(nodes: readonly DocumentNode[], visitor: (node: DocumentNode) => void): void {
  for (const node of nodes) {
    visitor(node);
    if (node.kind === "rotation-block") {
      walk(node.children, visitor);
    }
  }
}

function allDirectives(nodes: readonly DocumentNode[]): readonly DirectiveNode[] {
  const result: DirectiveNode[] = [];
  walk(nodes, (node): void => {
    if (node.kind === "directive") {
      result.push(node);
    } else if (node.kind === "include") {
      result.push(node.directive);
    } else if (node.kind === "script") {
      result.push(node.starter);
      if (node.terminator !== undefined) {
        result.push(node.terminator);
      }
    }
  });
  return result;
}

function directiveAt(nodes: readonly DocumentNode[], offset: number): DirectiveNode | undefined {
  return allDirectives(nodes).find(
    ({ nameSpan }) => nameSpan.start <= offset && offset <= nameSpan.end,
  );
}

function containingNodes(nodes: readonly DocumentNode[], offset: number): readonly DocumentNode[] {
  const result: DocumentNode[] = [];
  for (const node of nodes) {
    if (node.start <= offset && offset <= node.end) {
      result.unshift(node);
      if (node.kind === "rotation-block") {
        result.unshift(...containingNodes(node.children, offset));
      }
    }
  }
  return result;
}

function insideScript(document: ParsedDocument, offset: number): boolean {
  let result = false;
  walk(document.children, (node): void => {
    if (node.kind === "script" && node.bodySpan.start <= offset && offset <= node.bodySpan.end) {
      result = true;
    }
  });
  return result;
}

function scopeAt(document: ParsedDocument, offset: number): "global" | "block" {
  return rotationBlocks(document).some((block) => block.start <= offset && offset <= block.end)
    ? "block"
    : "global";
}

function detectNewline(source: string): string {
  return source.includes("\r\n") ? "\r\n" : source.includes("\r") ? "\r" : "\n";
}
