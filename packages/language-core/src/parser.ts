import { decodeArguments } from "./arguments.js";
import { directiveByName } from "./registry.js";
import { lex } from "./lexer.js";
import type {
  CoreDiagnostic,
  DirectiveNode,
  DocumentNode,
  ErrorNode,
  IncludeNode,
  ParsedDocument,
  PathHeaderNode,
  RotationBlockNode,
  ScriptNode,
  TextSpan,
  ValidationOptions,
} from "./model.js";
import { SourceMap } from "./source-map.js";
import type { DirectiveScope } from "./types.js";

interface ParseContext {
  readonly source: string;
  readonly lines: SourceMap["lines"];
  readonly diagnostics: CoreDiagnostic[];
  readonly options: ValidationOptions;
  index: number;
}

const scriptNames = new Set(["firstaction", "lastaction", "prerotate", "postrotate", "preremove"]);

export function parse(source: string, options: ValidationOptions = {}): ParsedDocument {
  const map = new SourceMap(source);
  const context: ParseContext = {
    source,
    lines: map.lines,
    diagnostics: [],
    options,
    index: 0,
  };
  const children = parseNodes(context, "global");
  const maxProblems = options.maxProblems ?? 100;
  return {
    kind: "document",
    source,
    start: 0,
    end: source.length,
    tokens: lex(source),
    children,
    diagnostics: context.diagnostics.slice(0, maxProblems),
    newline: detectNewline(source),
  };
}

function parseNodes(context: ParseContext, scope: DirectiveScope): DocumentNode[] {
  const nodes: DocumentNode[] = [];
  while (context.index < context.lines.length) {
    if (context.options.cancelled?.() === true) {
      break;
    }
    const line = context.lines[context.index];
    if (line === undefined) {
      break;
    }
    const content = context.source.slice(line.start, line.contentEnd);
    const trimmed = content.trim();
    if (scope === "block" && trimmed.startsWith("}")) {
      break;
    }
    if (trimmed === "") {
      nodes.push({
        kind: "blank",
        start: line.start,
        end: line.end,
        raw: context.source.slice(line.start, line.end),
      });
      context.index += 1;
      continue;
    }
    if (trimmed.startsWith("#")) {
      nodes.push({
        kind: "comment",
        start: line.start,
        end: line.end,
        raw: context.source.slice(line.start, line.end),
        text: trimmed.slice(1),
      });
      context.index += 1;
      continue;
    }
    const key = /^\s*([A-Za-z]+)(?=\s|=|$)/u.exec(content);
    if (key !== null) {
      const name = key[1] ?? "";
      if (scriptNames.has(name)) {
        nodes.push(parseScript(context, scope, name, key));
        continue;
      }
      const directive = parseDirective(context, scope, name, key);
      nodes.push(name === "include" ? toInclude(directive) : directive);
      context.index += 1;
      continue;
    }
    if (trimmed === "}") {
      addDiagnostic(context, {
        code: "LR1005",
        severity: "error",
        message: "This closing brace has no matching rotation block.",
        source: "logrotate",
        start: line.start + content.indexOf("}"),
        end: line.start + content.indexOf("}") + 1,
      });
      nodes.push(errorNode(context.source, line.start, line.end, "Unexpected closing brace."));
      context.index += 1;
      continue;
    }
    nodes.push(parseRotationBlock(context));
  }
  return nodes;
}

function parseRotationBlock(context: ParseContext): RotationBlockNode | ErrorNode {
  const firstLine = context.lines[context.index];
  if (firstLine === undefined) {
    return errorNode(
      context.source,
      context.source.length,
      context.source.length,
      "Missing rotation block.",
    );
  }
  const headerStart = firstLine.start;
  let headerEnd = firstLine.end;
  let openBrace: TextSpan | undefined;
  const parts: string[] = [];
  while (context.index < context.lines.length) {
    const line = context.lines[context.index];
    if (line === undefined) {
      break;
    }
    const content = context.source.slice(line.start, line.contentEnd);
    const brace = findUnquotedBrace(content);
    const pathContent = brace >= 0 ? content.slice(0, brace) : content;
    parts.push(pathContent);
    headerEnd = line.end;
    if (brace >= 0) {
      openBrace = { start: line.start + brace, end: line.start + brace + 1 };
      context.index += 1;
      break;
    }
    context.index += 1;
    const next = context.lines[context.index];
    if (
      next === undefined ||
      /^\s*[A-Za-z]+(?=\s|=|$)/u.test(context.source.slice(next.start, next.contentEnd))
    ) {
      break;
    }
  }
  const joined = parts.join(" ");
  const decoded = decodeArguments(joined);
  const paths = decoded.arguments.map((argument) => ({
    ...argument,
    start: headerStart + argument.start,
    end: headerStart + argument.end,
  }));
  const header: PathHeaderNode = {
    kind: "path-header",
    start: headerStart,
    end: headerEnd,
    raw: context.source.slice(headerStart, headerEnd),
    paths,
    ...(openBrace === undefined ? {} : { openBrace }),
  };
  if (openBrace === undefined) {
    addDiagnostic(context, {
      code: "LR1004",
      severity: "error",
      message: "A rotation path header must end with an opening brace.",
      source: "logrotate",
      start: headerStart,
      end: Math.max(headerStart, headerEnd - (firstLine.newline.length || 0)),
    });
    return errorNode(
      context.source,
      headerStart,
      headerEnd,
      "Rotation header has no opening brace.",
    );
  }
  const children = parseNodes(context, "block");
  const closingLine = context.lines[context.index];
  let closeBrace: TextSpan | undefined;
  let end = children.at(-1)?.end ?? headerEnd;
  if (closingLine !== undefined) {
    const closingContent = context.source.slice(closingLine.start, closingLine.contentEnd);
    const closingOffset = closingContent.indexOf("}");
    if (closingOffset >= 0) {
      closeBrace = {
        start: closingLine.start + closingOffset,
        end: closingLine.start + closingOffset + 1,
      };
      end = closingLine.end;
      context.index += 1;
    }
  }
  if (closeBrace === undefined) {
    addDiagnostic(context, {
      code: "LR1006",
      severity: "error",
      message: "The rotation block is missing a closing brace.",
      source: "logrotate",
      start: openBrace.start,
      end: openBrace.end,
    });
  }
  return {
    kind: "rotation-block",
    start: headerStart,
    end,
    raw: context.source.slice(headerStart, end),
    header,
    children,
    ...(closeBrace === undefined ? {} : { closeBrace }),
  };
}

function parseDirective(
  context: ParseContext,
  scope: DirectiveScope,
  name: string,
  match: RegExpExecArray,
): DirectiveNode {
  const line = context.lines[context.index];
  if (line === undefined) {
    throw new Error("Parser line invariant violated.");
  }
  const content = context.source.slice(line.start, line.contentEnd);
  const nameLocalStart = match.index + match[0].lastIndexOf(name);
  const nameSpan = {
    start: line.start + nameLocalStart,
    end: line.start + nameLocalStart + name.length,
  };
  const definition = directiveByName.get(name);
  if (definition === undefined) {
    const lower = directiveByName.get(name.toLowerCase());
    addDiagnostic(context, {
      code: lower === undefined ? "LR1001" : "LR1007",
      severity: "error",
      message:
        lower === undefined
          ? `Unknown directive “${name}”.`
          : `Directive names are lowercase; use “${lower.name}”.`,
      source: "logrotate",
      start: nameSpan.start,
      end: nameSpan.end,
    });
  } else if (!definition.scopes.includes(scope)) {
    addDiagnostic(context, {
      code: "LR1008",
      severity: "error",
      message: `“${name}” is not valid in ${scope === "global" ? "global" : "rotation-block"} scope.`,
      source: "logrotate",
      start: nameSpan.start,
      end: nameSpan.end,
    });
  } else if (definition.deprecated) {
    addDiagnostic(context, {
      code: "LR2001",
      severity: "warning",
      message: `“${name}” is deprecated and ignored by logrotate.`,
      source: "logrotate",
      start: nameSpan.start,
      end: nameSpan.end,
      tags: ["deprecated", "unnecessary"],
    });
  }
  let argumentStart = nameLocalStart + name.length;
  while (argumentStart < content.length && /[\t\v\f =]/u.test(content[argumentStart] ?? "")) {
    argumentStart += 1;
  }
  const decoded = decodeArguments(content, argumentStart, content.length);
  for (const diagnostic of decoded.diagnostics) {
    addDiagnostic(context, {
      ...diagnostic,
      start: line.start + diagnostic.start,
      end: line.start + diagnostic.end,
    });
  }
  const args = decoded.arguments.map((argument) => ({
    ...argument,
    start: line.start + argument.start,
    end: line.start + argument.end,
  }));
  if (definition !== undefined) {
    validateArguments(context, definition.arguments.kind, definition.arguments, args, nameSpan);
  }
  return {
    kind: "directive",
    start: line.start,
    end: line.end,
    raw: context.source.slice(line.start, line.end),
    name,
    nameSpan,
    scope,
    ...(definition === undefined ? {} : { definition }),
    arguments: args,
  };
}

function parseScript(
  context: ParseContext,
  scope: DirectiveScope,
  name: string,
  match: RegExpExecArray,
): ScriptNode {
  const starter = parseDirective(context, scope, name, match);
  const startLine = context.lines[context.index];
  if (startLine === undefined) {
    throw new Error("Script start invariant violated.");
  }
  context.index += 1;
  const bodyStart = startLine.end;
  let bodyEnd = context.source.length;
  let terminator: DirectiveNode | undefined;
  while (context.index < context.lines.length) {
    const line = context.lines[context.index];
    if (line === undefined) {
      break;
    }
    const content = context.source.slice(line.start, line.contentEnd);
    const endMatch = /^\s*(endscript)(?:\s*)$/u.exec(content);
    if (endMatch !== null) {
      bodyEnd = line.start;
      terminator = parseDirective(context, "block", "endscript", endMatch);
      context.index += 1;
      break;
    }
    context.index += 1;
  }
  if (terminator === undefined) {
    addDiagnostic(context, {
      code: "LR1009",
      severity: "error",
      message: `“${name}” is missing its endscript terminator.`,
      source: "logrotate",
      start: starter.nameSpan.start,
      end: starter.nameSpan.end,
    });
  }
  const end = terminator?.end ?? context.source.length;
  return {
    kind: "script",
    start: starter.start,
    end,
    raw: context.source.slice(starter.start, end),
    starter,
    body: context.source.slice(bodyStart, bodyEnd),
    bodySpan: { start: bodyStart, end: bodyEnd },
    ...(terminator === undefined ? {} : { terminator }),
  };
}

function toInclude(directive: DirectiveNode): IncludeNode {
  return {
    kind: "include",
    start: directive.start,
    end: directive.end,
    raw: directive.raw,
    directive,
    ...(directive.arguments[0] === undefined ? {} : { target: directive.arguments[0] }),
  };
}

function validateArguments(
  context: ParseContext,
  kind: string,
  definition: {
    readonly minimum?: number;
    readonly maximum?: number;
    readonly minimumArity?: number;
    readonly maximumArity?: number;
  },
  args: readonly { readonly start: number; readonly end: number; readonly value: string }[],
  nameSpan: TextSpan,
): void {
  const minimumArity =
    definition.minimumArity ??
    (kind === "none" || kind === "script" || kind === "terminator" ? 0 : 1);
  const maximumArity =
    definition.maximumArity ??
    (kind === "remainder" || kind === "taboo-list" ? Number.POSITIVE_INFINITY : minimumArity);
  if (args.length < minimumArity) {
    addDiagnostic(context, {
      code: "LR1101",
      severity: "error",
      message: "This directive is missing a required argument.",
      source: "logrotate",
      start: nameSpan.start,
      end: nameSpan.end,
    });
    return;
  }
  if (args.length > maximumArity) {
    const extra = args[maximumArity];
    if (extra !== undefined) {
      addDiagnostic(context, {
        code: "LR1102",
        severity: "error",
        message: "This directive has too many arguments.",
        source: "logrotate",
        start: extra.start,
        end: args.at(-1)?.end ?? extra.end,
      });
    }
  }
  const first = args[0];
  if (first === undefined) {
    return;
  }
  if (kind === "size" && !/^[0-9]+(?:[kKMG])?$/u.test(first.value)) {
    argumentError(context, "LR1103", "Use bytes or a k, K, M, or G size suffix.", first);
  }
  if (
    ["integer", "nonnegative-integer", "positive-integer", "weekday", "monthday"].includes(kind)
  ) {
    if (!/^-?[0-9]+$/u.test(first.value)) {
      argumentError(context, "LR1104", "Expected a base-10 integer.", first);
    } else {
      const value = Number.parseInt(first.value, 10);
      if (
        (definition.minimum !== undefined && value < definition.minimum) ||
        (definition.maximum !== undefined && value > definition.maximum)
      ) {
        argumentError(
          context,
          "LR1105",
          "The integer is outside the range accepted by this directive.",
          first,
        );
      }
    }
  }
  if (
    (kind === "create" || kind === "createolddir") &&
    /^[0-9]+$/u.test(first.value) &&
    !/^[0-7]{3,4}$/u.test(first.value)
  ) {
    argumentError(context, "LR1106", "File modes must be three or four octal digits.", first);
  }
  if (kind === "date-format") {
    const unsupported = [...first.value.matchAll(/%./gu)].find(
      (match) =>
        ![
          "%Y",
          "%m",
          "%d",
          "%H",
          "%M",
          "%S",
          "%G",
          "%V",
          "%U",
          "%W",
          "%u",
          "%w",
          "%y",
          "%g",
          "%j",
          "%s",
          "%z",
          "%%",
        ].includes(match[0]),
    );
    if (unsupported?.index !== undefined) {
      addDiagnostic(context, {
        code: "LR1107",
        severity: "error",
        message: `Date conversion “${unsupported[0]}” is not supported by target logrotate 3.22.`,
        source: "logrotate",
        start: first.start + unsupported.index,
        end: first.start + unsupported.index + unsupported[0].length,
      });
    }
  }
}

function argumentError(context: ParseContext, code: string, message: string, span: TextSpan): void {
  addDiagnostic(context, {
    code,
    severity: "error",
    message,
    source: "logrotate",
    start: span.start,
    end: span.end,
  });
}

function findUnquotedBrace(content: string): number {
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === "\\") {
      index += 1;
    } else if ((character === "'" || character === '"') && quote === undefined) {
      quote = character;
    } else if (character === quote) {
      quote = undefined;
    } else if (character === "{" && quote === undefined) {
      return index;
    }
  }
  return -1;
}

function errorNode(source: string, start: number, end: number, message: string): ErrorNode {
  return { kind: "error", start, end, raw: source.slice(start, end), message };
}

function addDiagnostic(context: ParseContext, diagnostic: CoreDiagnostic): void {
  if (context.diagnostics.length < (context.options.maxProblems ?? 100)) {
    context.diagnostics.push(diagnostic);
  }
}

function detectNewline(source: string): "\n" | "\r\n" | "\r" {
  const match = /\r\n|\n|\r/u.exec(source);
  return (match?.[0] as "\n" | "\r\n" | "\r" | undefined) ?? "\n";
}
