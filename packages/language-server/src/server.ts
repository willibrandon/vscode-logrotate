import {
  analyze,
  buildIncludeGraph,
  completionTable,
  decodeArguments,
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
  FileSystemProvider,
  ParsedDocument,
  TextSpan,
} from "@logrotate/language-core";
import { URI, Utils } from "vscode-uri";
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
  SymbolInformation,
  TextEdit,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { readDirectoryRequest, readFileRequest, statRequest } from "./protocol.js";

const tokenTypes = ["keyword", "string", "number", "comment", "parameter"] as const;
const tokenModifiers = ["deprecated"] as const;

export interface TimerHost {
  setTimeout(callback: () => void, milliseconds: number): unknown;
  clearTimeout(handle: unknown): void;
}

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

export function startLanguageServer(connection: Connection, timers: TimerHost): void {
  const documents = new TextDocuments(TextDocument);
  let settings: ServerSettings = defaultSettings;
  const pendingDiagnostics = new Map<string, unknown>();
  const loadedIncludes = new Map<string, ReadonlySet<string>>();
  const fileSystem = connectionFileSystem(connection, documents);

  const cancelPending = (uri: string): void => {
    const pending = pendingDiagnostics.get(uri);
    if (pending !== undefined) {
      timers.clearTimeout(pending);
      pendingDiagnostics.delete(uri);
    }
  };
  const scheduleDiagnostics = (document: TextDocument): void => {
    cancelPending(document.uri);
    const version = document.version;
    const handle = timers.setTimeout((): void => {
      pendingDiagnostics.delete(document.uri);
      if (documents.get(document.uri)?.version !== version) return;
      void publishDiagnostics(
        connection,
        documents,
        document,
        settings,
        fileSystem,
        loadedIncludes,
      );
    }, 150);
    pendingDiagnostics.set(document.uri, handle);
  };

  connection.onInitialize((): InitializeResult => ({
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
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
      scheduleDiagnostics(document);
    }
  });

  documents.onDidOpen(({ document }): void => scheduleDiagnostics(document));
  documents.onDidChangeContent(({ document }): void => scheduleDiagnostics(document));
  documents.onDidClose(({ document }): void => {
    cancelPending(document.uri);
    void connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
  });

  connection.onShutdown((): void => {
    for (const pending of pendingDiagnostics.values()) timers.clearTimeout(pending);
    pendingDiagnostics.clear();
  });

  connection.onCompletion(async (params, token): Promise<CompletionItem[]> => {
    const document = documents.get(params.textDocument.uri);
    if (
      document === undefined ||
      document.languageId === "logrotate-state" ||
      token.isCancellationRequested
    ) {
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
    const directiveLine = /^\s*([a-z]+)(?:\s*=\s*|\s+)(.*)$/u.exec(line);
    if (directiveLine !== null) {
      const name = directiveLine[1] ?? "";
      const argument = directiveLine[2] ?? "";
      if (name === "include") {
        return completePath(
          document.uri,
          argument,
          fileSystem,
          () => token.isCancellationRequested,
        );
      }
      return argumentCompletions(name);
    }
    if (/^\s*(?:\/|~\/)/u.test(line)) {
      return completePath(
        document.uri,
        line.trimStart(),
        fileSystem,
        () => token.isCancellationRequested,
      );
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
    const interactions =
      definition.interactions.length === 0
        ? ""
        : `\n\nRelated: ${definition.interactions.map((name) => `\`${name}\``).join(", ")}.`;
    return {
      range: word.range,
      contents: {
        kind: MarkupKind.Markdown,
        value: `**${definition.name}** · ${definition.arguments.kind}\n\n${definition.summary}${status}${interactions}\n\nValid in: ${definition.scopes.join(", ")} · Since: ${definition.since} · Target: ${settings.targetVersion} · [Upstream documentation](${definition.documentation})`,
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
    const argumentSource = match[2] ?? "";
    const decoded = decodeArguments(argumentSource);
    const activeParameter = Math.min(
      /\s$/u.test(argumentSource)
        ? decoded.arguments.length
        : Math.max(0, decoded.arguments.length - 1),
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
    return parsed.children.flatMap((node): readonly DocumentSymbol[] => {
      if (node.kind === "include") {
        return [
          {
            name: `include ${node.target?.value ?? ""}`.trimEnd(),
            kind: SymbolKind.File,
            range: range(document, node),
            selectionRange: range(document, node.directive.nameSpan),
          },
        ];
      }
      if (node.kind !== "rotation-block") return [];
      return [
        {
          name: node.header.paths.map(({ value }) => value).join(" ") || "Rotation block",
          kind: SymbolKind.Object,
          range: range(document, node),
          selectionRange: range(document, node.header),
          children: node.children
            .filter((child) => child.kind === "script")
            .map((script): DocumentSymbol => ({
              name: script.starter.name,
              kind: SymbolKind.Function,
              range: range(document, script),
              selectionRange: range(document, script.starter.nameSpan),
            })),
        },
      ];
    });
  });

  connection.onWorkspaceSymbol((params): SymbolInformation[] => {
    const query = params.query.toLowerCase();
    return documents.all().flatMap((document): readonly SymbolInformation[] => {
      if (document.languageId !== "logrotate") return [];
      return rotationBlocks(parse(document.getText())).flatMap(
        (block): readonly SymbolInformation[] => {
          const name = block.header.paths.map(({ value }) => value).join(" ") || "Rotation block";
          return query === "" || name.toLowerCase().includes(query)
            ? [
                {
                  name,
                  kind: SymbolKind.Object,
                  location: { uri: document.uri, range: range(document, block.header) },
                },
              ]
            : [];
        },
      );
    });
  });

  connection.onFoldingRanges((params): FoldingRange[] => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined) {
      return [];
    }
    const result: FoldingRange[] = [];
    walk(parse(document.getText()).children, (node): void => {
      if (node.kind === "rotation-block" || node.kind === "script") {
        const nodeRange = range(document, node);
        if (nodeRange.end.line > nodeRange.start.line) {
          result.push({
            startLine: nodeRange.start.line,
            endLine: nodeRange.end.line,
            ...(node.kind === "script" ? { kind: FoldingRangeKind.Region } : {}),
          });
        }
        if (node.kind === "rotation-block") {
          const headerRange = range(document, node.header);
          if (headerRange.end.line > headerRange.start.line) {
            result.push({ startLine: headerRange.start.line, endLine: headerRange.end.line });
          }
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
      const token = parsed.tokens.find(({ start, end }) => start <= offset && offset <= end);
      return token === undefined ? parent : { range: range(document, token), parent };
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
          target: fileSystem.resolve(document.uri, node.target.value),
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
    const selectedInclude = includeAt(parsed.children, offset);
    if (selectedInclude?.target !== undefined) {
      return [
        {
          uri: fileSystem.resolve(document.uri, selectedInclude.target.value),
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        },
      ];
    }
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
    return documents.all().flatMap((loaded): readonly Location[] =>
      allDirectives(parse(loaded.getText()).children)
        .filter(({ name }) => name === selected.name)
        .map((directive): Location => ({
          uri: loaded.uri,
          range: range(loaded, directive.nameSpan),
        })),
    );
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
    const parsed = parse(document.getText());
    for (const directive of allDirectives(parsed.children)) {
      const start = document.positionAt(directive.nameSpan.start);
      builder.push(
        start.line,
        start.character,
        directive.nameSpan.end - directive.nameSpan.start,
        0,
        directive.definition?.deprecated === true ? 1 : 0,
      );
      directive.arguments.forEach((argument, index): void => {
        const tokenType = semanticArgumentType(directive, index);
        if (tokenType === undefined || argument.end <= argument.start) return;
        const argumentStart = document.positionAt(argument.start);
        builder.push(
          argumentStart.line,
          argumentStart.character,
          argument.end - argument.start,
          tokenType,
          0,
        );
      });
    }
    for (const block of rotationBlocks(parsed)) {
      for (const path of block.header.paths) {
        const start = document.positionAt(path.start);
        builder.push(start.line, start.character, path.end - path.start, 1, 0);
      }
    }
    for (const token of parsed.tokens) {
      if (token.kind !== "comment") continue;
      const start = document.positionAt(token.start);
      builder.push(start.line, start.character, token.end - token.start, 3, 0);
    }
    return builder.build();
  });

  connection.onCodeAction((params): CodeAction[] => {
    const document = documents.get(params.textDocument.uri);
    if (document === undefined || document.languageId === "logrotate-state") {
      return [];
    }
    return params.context.diagnostics.flatMap((diagnostic): readonly CodeAction[] => {
      if (diagnostic.code === "LR1001" || diagnostic.code === "LR1007") {
        const suggestion =
          diagnostic.code === "LR1007"
            ? document.getText(diagnostic.range).toLowerCase()
            : diagnosticSuggestion(diagnostic.data);
        if (suggestion === undefined) return [];
        return [
          {
            title: `Replace with “${suggestion}”`,
            kind: CodeActionKind.QuickFix,
            isPreferred: true,
            diagnostics: [diagnostic],
            edit: {
              changes: { [document.uri]: [{ range: diagnostic.range, newText: suggestion }] },
            },
          },
        ];
      }
      const prerequisite: Readonly<Record<string, string>> = {
        LR2002: "compress",
        LR2003: "dateext",
        LR2005: "shred",
      };
      const prerequisiteName =
        typeof diagnostic.code === "string" ? prerequisite[diagnostic.code] : undefined;
      if (prerequisiteName !== undefined) {
        const line = document.getText({
          start: { line: diagnostic.range.start.line, character: 0 },
          end: diagnostic.range.start,
        });
        const indentation = /^\s*/u.exec(line)?.[0] ?? "";
        const start = { line: diagnostic.range.start.line, character: 0 };
        return [
          {
            title: `Add prerequisite “${prerequisiteName}”`,
            kind: CodeActionKind.QuickFix,
            isPreferred: true,
            diagnostics: [diagnostic],
            edit: {
              changes: {
                [document.uri]: [
                  {
                    range: { start, end: start },
                    newText: `${indentation}${prerequisiteName}${detectNewline(document.getText())}`,
                  },
                ],
              },
            },
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

async function publishDiagnostics(
  connection: Connection,
  documents: TextDocuments<TextDocument>,
  document: TextDocument,
  settings: ServerSettings,
  fileSystem: FileSystemProvider,
  loadedIncludes: Map<string, ReadonlySet<string>>,
): Promise<void> {
  if (!settings.validation.enable) {
    await connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
    await clearRemovedIncludes(connection, document.uri, new Set(), loadedIncludes);
    return;
  }
  if (document.languageId === "logrotate-state") {
    const core = parseState(document.getText(), {
      maxProblems: settings.validation.maxProblems,
    }).diagnostics;
    await connection.sendDiagnostics({
      uri: document.uri,
      version: document.version,
      diagnostics: core.map((item): Diagnostic => toDiagnostic(document, item)),
    });
    return;
  }

  const version = document.version;
  const graph = await buildIncludeGraph(
    document.uri,
    document.getText(),
    fileSystem,
    {},
    () => documents.get(document.uri)?.version !== version,
  );
  if (graph.cancelled || documents.get(document.uri)?.version !== version) return;

  const currentIncludes = new Set<string>();
  for (const [uri, included] of graph.files) {
    if (uri !== document.uri) currentIncludes.add(uri);
    const open = documents.get(uri);
    const diagnosticDocument =
      open ?? TextDocument.create(uri, "logrotate", 0, included.document.source);
    const parsed = parse(diagnosticDocument.getText(), {
      maxProblems: settings.validation.maxProblems,
      targetVersion: settings.targetVersion,
    });
    const core = [
      ...analyze(parsed),
      ...graph.diagnostics.filter(({ resource }) => resource === uri),
    ].slice(0, settings.validation.maxProblems);
    await connection.sendDiagnostics({
      uri,
      ...(open === undefined ? {} : { version: open.version }),
      diagnostics: core.map((item): Diagnostic => toDiagnostic(diagnosticDocument, item)),
    });
  }
  await clearRemovedIncludes(connection, document.uri, currentIncludes, loadedIncludes);
  loadedIncludes.set(document.uri, currentIncludes);
}

async function clearRemovedIncludes(
  connection: Connection,
  rootUri: string,
  current: ReadonlySet<string>,
  loadedIncludes: Map<string, ReadonlySet<string>>,
): Promise<void> {
  const previous = loadedIncludes.get(rootUri) ?? new Set<string>();
  loadedIncludes.set(rootUri, current);
  for (const uri of previous) {
    if (current.has(uri) || loadedByAnotherRoot(uri, rootUri, loadedIncludes)) continue;
    await connection.sendDiagnostics({ uri, diagnostics: [] });
  }
}

function loadedByAnotherRoot(
  uri: string,
  rootUri: string,
  loadedIncludes: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  for (const [candidateRoot, resources] of loadedIncludes) {
    if (candidateRoot !== rootUri && resources.has(uri)) return true;
  }
  return false;
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
    ...(diagnostic.data === undefined ? {} : { data: diagnostic.data }),
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

function includeAt(
  nodes: readonly DocumentNode[],
  offset: number,
): Extract<DocumentNode, { readonly kind: "include" }> | undefined {
  let result: Extract<DocumentNode, { readonly kind: "include" }> | undefined;
  walk(nodes, (node): void => {
    if (
      result === undefined &&
      node.kind === "include" &&
      node.start <= offset &&
      offset <= node.end
    ) {
      result = node;
    }
  });
  return result;
}

function containingNodes(nodes: readonly DocumentNode[], offset: number): readonly DocumentNode[] {
  const result: DocumentNode[] = [];
  for (const node of nodes) {
    if (node.start <= offset && offset <= node.end) {
      result.push(node);
      if (node.kind === "rotation-block") {
        result.push(...containingNodes(node.children, offset));
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

function semanticArgumentType(directive: DirectiveNode, index: number): number | undefined {
  const kind = directive.definition?.arguments.kind;
  if (
    kind === "integer" ||
    kind === "nonnegative-integer" ||
    kind === "positive-integer" ||
    kind === "weekday" ||
    kind === "monthday" ||
    kind === "size" ||
    ((kind === "create" || kind === "createolddir") && index === 0)
  ) {
    return 2;
  }
  if (kind === "user-group" || ((kind === "create" || kind === "createolddir") && index > 0)) {
    return 4;
  }
  if (
    kind === "path" ||
    kind === "command" ||
    kind === "extension" ||
    kind === "remainder" ||
    kind === "mail-address" ||
    kind === "date-format" ||
    kind === "taboo-list"
  ) {
    return 1;
  }
  return undefined;
}

function argumentCompletions(name: string): CompletionItem[] {
  const kind = directiveByName.get(name)?.arguments.kind;
  const choices: Readonly<Partial<Record<NonNullable<typeof kind>, readonly string[]>>> = {
    size: ["1k", "1M", "1G", "100M"],
    weekday: ["0", "1", "2", "3", "4", "5", "6", "7"],
    monthday: ["1", "15", "31"],
    create: ["0640", "0644", "0600"],
    createolddir: ["0755", "0750", "0700"],
    "date-format": ["-%Y%m%d", "-%Y%m%d-%H%M%S"],
    "taboo-list": ["+ .bak", ".bak,.old"],
  };
  return (kind === undefined ? [] : (choices[kind] ?? [])).map((label): CompletionItem => ({
    label,
    kind: CompletionItemKind.Value,
    insertText: label,
  }));
}

async function completePath(
  documentUri: string,
  rawArgument: string,
  fileSystem: FileSystemProvider,
  cancelled: () => boolean,
): Promise<CompletionItem[]> {
  if (cancelled()) return [];
  const argument = rawArgument.replace(/^["']/u, "").replace(/["']$/u, "");
  const separator = argument.lastIndexOf("/");
  const directory = separator >= 0 ? argument.slice(0, separator + 1) : "./";
  const prefix = separator >= 0 ? argument.slice(separator + 1) : argument;
  try {
    const directoryUri = fileSystem.resolve(documentUri, directory);
    const entries = await fileSystem.readDirectory(directoryUri);
    if (cancelled()) return [];
    return entries
      .filter((entry) => entry.startsWith(prefix))
      .slice(0, 200)
      .map((entry): CompletionItem => ({
        label: entry,
        kind: CompletionItemKind.File,
        insertText: entry,
      }));
  } catch {
    return [];
  }
}

function detectNewline(source: string): string {
  return source.includes("\r\n") ? "\r\n" : source.includes("\r") ? "\r" : "\n";
}

function diagnosticSuggestion(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null || !("suggestion" in data)) return undefined;
  const suggestion = (data as { readonly suggestion?: unknown }).suggestion;
  return typeof suggestion === "string" ? suggestion : undefined;
}

function connectionFileSystem(
  connection: Connection,
  documents: TextDocuments<TextDocument>,
): FileSystemProvider {
  return {
    async readFile(uri): Promise<string> {
      const open = documents.get(uri);
      return open?.getText() ?? connection.sendRequest(readFileRequest, { uri });
    },
    readDirectory(uri): Promise<readonly string[]> {
      return connection.sendRequest(readDirectoryRequest, { uri });
    },
    stat(uri) {
      return connection.sendRequest(statRequest, { uri });
    },
    resolve(baseUri, target) {
      if (/^[a-z][a-z0-9+.-]*:/iu.test(target)) return normalizeUri(target);
      const base = URI.parse(baseUri);
      if (target.startsWith("/")) return base.with({ path: normalizePath(target) }).toString();
      return Utils.resolvePath(Utils.dirname(base), target).toString();
    },
    normalize: normalizeUri,
  };
}

function normalizeUri(value: string): string {
  const uri = URI.parse(value);
  return uri.with({ path: normalizePath(uri.path) }).toString();
}

function normalizePath(value: string): string {
  const absolute = value.startsWith("/");
  const segments: string[] = [];
  for (const segment of value.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return `${absolute ? "/" : ""}${segments.join("/")}`;
}
