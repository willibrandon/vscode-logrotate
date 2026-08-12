import { decodeArguments } from "./arguments.js";
import { directiveByName } from "./registry.js";
import { lexLines } from "./lexer.js";
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
import { resolveTargetVersion } from "./version.js";

interface ParseContext {
  readonly source: string;
  readonly lines: SourceMap["lines"];
  readonly diagnostics: CoreDiagnostic[];
  readonly options: ValidationOptions;
  index: number;
}

interface DirectiveCandidate {
  readonly name: string;
  readonly start: number;
  readonly end: number;
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
    tokens: lexLines(source, map.lines, options.cancelled),
    children,
    diagnostics: context.diagnostics.slice(0, maxProblems),
    maxProblems,
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
    const invalidControl = findInvalidControl(content);
    if (invalidControl >= 0) {
      addDiagnostic(context, {
        code: "LR1015",
        severity: "error",
        message: "Configuration text contains a binary control character.",
        source: "logrotate",
        start: line.start + invalidControl,
        end: line.start + invalidControl + 1,
      });
      nodes.push(errorNode(context.source, line.start, line.end, "Binary configuration content."));
      context.index += 1;
      continue;
    }
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
    const candidate = scanDirectiveCandidate(content);
    const name = candidate?.name ?? "";
    if (candidate !== undefined && isDirectiveSeparator(content[candidate.end])) {
      if (scriptNames.has(name)) {
        nodes.push(parseScript(context, scope, name, candidate));
        continue;
      }
      const directive = parseDirective(context, scope, name, candidate);
      nodes.push(name === "include" ? toInclude(directive) : directive);
      context.index += 1;
      continue;
    }
    if (candidate !== undefined) {
      const start = line.start + candidate.start;
      addDiagnostic(context, {
        code: "LR1010",
        severity: "error",
        message: `Directive “${name}” must be followed by whitespace or an equals sign.`,
        source: "logrotate",
        start,
        end: start + name.length,
      });
      nodes.push(errorNode(context.source, line.start, line.end, "Malformed directive line."));
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
  let inlineCloseBrace: TextSpan | undefined;
  while (context.index < context.lines.length) {
    const line = context.lines[context.index];
    if (line === undefined) {
      break;
    }
    const content = context.source.slice(line.start, line.contentEnd);
    const brace = findUnquotedBrace(content);
    headerEnd = line.end;
    if (brace >= 0) {
      openBrace = { start: line.start + brace, end: line.start + brace + 1 };
      const trailing = content.slice(brace + 1);
      const inlineCloseOffset = trailing.indexOf("}");
      if (
        inlineCloseOffset >= 0 &&
        trailing.slice(0, inlineCloseOffset).trim() === "" &&
        trailing.slice(inlineCloseOffset + 1).trim() === ""
      ) {
        inlineCloseBrace = {
          start: line.start + brace + 1 + inlineCloseOffset,
          end: line.start + brace + 2 + inlineCloseOffset,
        };
      } else if (trailing.trim() !== "") {
        const trailingStart = line.start + brace + 1 + trailing.search(/\S/u);
        addDiagnostic(context, {
          code: "LR1012",
          severity: "error",
          message: "Unexpected text after the opening brace.",
          source: "logrotate",
          start: trailingStart,
          end: line.contentEnd,
        });
      }
      context.index += 1;
      break;
    }
    context.index += 1;
    const next = context.lines[context.index];
    if (next === undefined || isDirectiveLine(context.source.slice(next.start, next.contentEnd))) {
      break;
    }
  }
  const argumentEnd = openBrace?.start ?? headerEnd;
  const projectedHeader = projectHeaderForArguments(context.source.slice(headerStart, argumentEnd));
  const decoded = decodeArguments(projectedHeader);
  const paths = decoded.arguments.map((argument) => ({
    ...argument,
    start: headerStart + argument.start,
    end: headerStart + argument.end,
    raw: context.source.slice(headerStart + argument.start, headerStart + argument.end),
  }));
  for (const diagnostic of decoded.diagnostics) {
    addDiagnostic(context, {
      ...diagnostic,
      start: headerStart + diagnostic.start,
      end: headerStart + diagnostic.end,
    });
  }
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
  if (paths.length === 0) {
    addDiagnostic(context, {
      code: "LR1014",
      severity: "error",
      message: "A rotation block requires at least one log path or glob.",
      source: "logrotate",
      start: headerStart,
      end: openBrace.start,
    });
  }
  const children = inlineCloseBrace === undefined ? parseNodes(context, "block") : [];
  const closingLine = context.lines[context.index];
  let closeBrace: TextSpan | undefined = inlineCloseBrace;
  let end = inlineCloseBrace === undefined ? (children.at(-1)?.end ?? headerEnd) : headerEnd;
  if (inlineCloseBrace === undefined && closingLine !== undefined) {
    const closingContent = context.source.slice(closingLine.start, closingLine.contentEnd);
    const closingOffset = closingContent.indexOf("}");
    if (closingOffset >= 0) {
      closeBrace = {
        start: closingLine.start + closingOffset,
        end: closingLine.start + closingOffset + 1,
      };
      end = closingLine.end;
      const trailing = closingContent.slice(closingOffset + 1);
      if (trailing.trim() !== "") {
        const trailingStart = closingLine.start + closingOffset + 1 + trailing.search(/\S/u);
        addDiagnostic(context, {
          code: "LR1013",
          severity: "error",
          message: "Unexpected text after the closing brace.",
          source: "logrotate",
          start: trailingStart,
          end: closingLine.contentEnd,
        });
      }
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
  match: DirectiveCandidate,
  matchedScriptTerminator?: boolean,
): DirectiveNode {
  const line = context.lines[context.index];
  if (line === undefined) {
    throw new Error("Parser line invariant violated.");
  }
  const content = context.source.slice(line.start, line.contentEnd);
  const nameLocalStart = match.start;
  const nameSpan = {
    start: line.start + nameLocalStart,
    end: line.start + nameLocalStart + name.length,
  };
  const definition = directiveByName.get(name);
  if (definition === undefined) {
    const lower = directiveByName.get(name.toLowerCase());
    const suggestion = lower?.name ?? closestDirective(name);
    addDiagnostic(context, {
      code: lower === undefined ? "LR1001" : "LR1007",
      severity: "error",
      message:
        lower === undefined
          ? `Unknown directive “${name}”.${suggestion === undefined ? "" : ` Did you mean “${suggestion}”?`}`
          : `Directive names are lowercase; use “${lower.name}”.`,
      source: "logrotate",
      start: nameSpan.start,
      end: nameSpan.end,
      ...(suggestion === undefined ? {} : { data: { suggestion } }),
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
  } else if (name === "endscript" && !matchedScriptTerminator) {
    addDiagnostic(context, {
      code: "LR1011",
      severity: "error",
      message: "This endscript has no matching script directive.",
      source: "logrotate",
      start: nameSpan.start,
      end: nameSpan.end,
    });
  }
  let argumentStart = nameLocalStart + name.length;
  while (argumentStart < content.length && isDirectiveSeparator(content[argumentStart])) {
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

function isDirectiveSeparator(character: string | undefined): boolean {
  return (
    character === undefined ||
    character === " " ||
    character === "\t" ||
    character === "\v" ||
    character === "\f" ||
    character === "="
  );
}

function isHorizontalWhitespace(character: string | undefined): boolean {
  return character === " " || character === "\t" || character === "\v" || character === "\f";
}

function scanDirectiveCandidate(content: string): DirectiveCandidate | undefined {
  let start = 0;
  while (isHorizontalWhitespace(content[start])) start += 1;
  let end = start;
  while (isAsciiLetter(content.charCodeAt(end))) end += 1;
  if (end === start) return undefined;
  return { name: content.slice(start, end), start, end };
}

function isDirectiveLine(content: string): boolean {
  const candidate = scanDirectiveCandidate(content);
  return candidate !== undefined && isDirectiveSeparator(content[candidate.end]);
}

function onlyHorizontalWhitespaceAfter(content: string, start: number): boolean {
  for (let index = start; index < content.length; index += 1) {
    if (!isHorizontalWhitespace(content[index])) return false;
  }
  return true;
}

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function findInvalidControl(content: string): number {
  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index);
    if ((code >= 0 && code <= 8) || (code >= 14 && code <= 31) || code === 127) return index;
  }
  return -1;
}

function parseScript(
  context: ParseContext,
  scope: DirectiveScope,
  name: string,
  match: DirectiveCandidate,
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
    const endMatch = scanDirectiveCandidate(content);
    if (endMatch?.name === "endscript" && onlyHorizontalWhitespaceAfter(content, endMatch.end)) {
      bodyEnd = line.start;
      terminator = parseDirective(context, "block", "endscript", endMatch, true);
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
    args.length !== 2 &&
    !/^[0-7]{3,4}$/u.test(first.value)
  ) {
    argumentError(context, "LR1106", "File modes must be three or four octal digits.", first);
  }
  if (
    ["path", "command", "extension", "mail-address", "date-format"].includes(kind) &&
    first.value === ""
  ) {
    argumentError(context, "LR1108", "This argument cannot be empty.", first);
  }
  if (kind === "date-format") {
    const target = resolveTargetVersion(context.options.targetVersion ?? "latest", {
      allowed: context.options.allowVersionDetection === true,
      ...(context.options.detectedVersion === undefined
        ? {}
        : { version: context.options.detectedVersion }),
    });
    const supported = target.definition?.dateFormatConversions;
    if (supported === undefined) {
      return;
    }
    const unsupported = [...first.value.matchAll(/%./gu)].find(
      (match) => match[0] !== "%%" && !supported.includes(match[0]),
    );
    if (unsupported?.index !== undefined) {
      addDiagnostic(context, {
        code: "LR1107",
        severity: "error",
        message: `Date conversion “${unsupported[0]}” is not supported by target logrotate ${target.version}.`,
        source: "logrotate",
        start: first.start + unsupported.index,
        end: first.start + unsupported.index + unsupported[0].length,
      });
    }
  }
}

function projectHeaderForArguments(header: string): string {
  const characters = header.split("");
  let lineStart = 0;
  for (let index = 0; index <= characters.length; index += 1) {
    const character = characters[index];
    if (character !== "\r" && character !== "\n" && index !== characters.length) {
      continue;
    }
    const line = characters.slice(lineStart, index).join("");
    if (line.trimStart().startsWith("#")) {
      for (let cursor = lineStart; cursor < index; cursor += 1) {
        characters[cursor] = " ";
      }
    }
    if (index < characters.length) {
      characters[index] = " ";
      if (character === "\r" && characters[index + 1] === "\n") {
        index += 1;
        characters[index] = " ";
      }
    }
    lineStart = index + 1;
  }
  return characters.join("");
}

function closestDirective(candidate: string): string | undefined {
  const normalized = candidate.toLowerCase();
  const ranked = [...directiveByName.keys()]
    .map((name) => ({ name, distance: editDistance(normalized, name) }))
    .sort((left, right) => left.distance - right.distance || left.name.localeCompare(right.name));
  const first = ranked[0];
  const second = ranked[1];
  const threshold = Math.max(1, Math.floor(normalized.length / 3));
  return first !== undefined &&
    first.distance <= threshold &&
    (second === undefined || first.distance < second.distance)
    ? first.name
    : undefined;
}

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length] ?? Math.max(left.length, right.length);
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
