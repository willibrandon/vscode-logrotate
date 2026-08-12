import type { LineInfo, Token, TokenKind } from "./model.js";
import { SourceMap } from "./source-map.js";

const scriptStarters = new Set([
  "firstaction",
  "lastaction",
  "prerotate",
  "postrotate",
  "preremove",
]);

export function lex(source: string, cancelled?: () => boolean): readonly Token[] {
  return lexLines(source, new SourceMap(source).lines, cancelled);
}

export function lexLines(
  source: string,
  lines: readonly LineInfo[],
  cancelled?: () => boolean,
): readonly Token[] {
  const tokens: Token[] = [];
  let inScript = false;
  for (const line of lines) {
    if (cancelled?.() === true) {
      break;
    }
    const content = source.slice(line.start, line.contentEnd);
    if (inScript && !/^\s*endscript\s*$/u.test(content)) {
      if (line.contentEnd > line.start) {
        tokens.push(token("raw-shell", source, line.start, line.contentEnd));
      }
    } else {
      lexLine(source, line, tokens);
      const directive = /^\s*([a-z]+)(?:\s|=|$)/u.exec(content)?.[1];
      if (inScript) {
        inScript = false;
      } else if (directive !== undefined && scriptStarters.has(directive)) {
        inScript = true;
      }
    }
    if (line.newline !== "") {
      tokens.push(token("newline", source, line.contentEnd, line.end));
    }
  }
  return tokens;
}

function lexLine(source: string, line: LineInfo, tokens: Token[]): void {
  let cursor = line.start;
  while (cursor < line.contentEnd) {
    const character = source[cursor];
    if (isHorizontalWhitespace(character)) {
      const start = cursor;
      do {
        cursor += 1;
      } while (isHorizontalWhitespace(source[cursor]));
      tokens.push(token("whitespace", source, start, cursor));
      continue;
    }
    if (character === "#" && source.slice(line.start, cursor).trim() === "") {
      tokens.push(token("comment", source, cursor, line.contentEnd));
      return;
    }
    if (character === "{") {
      tokens.push(token("open-brace", source, cursor, cursor + 1));
      cursor += 1;
      continue;
    }
    if (character === "}") {
      tokens.push(token("close-brace", source, cursor, cursor + 1));
      cursor += 1;
      continue;
    }
    if (character === "=") {
      tokens.push(token("equals", source, cursor, cursor + 1));
      cursor += 1;
      continue;
    }
    if (character === "'" || character === '"') {
      const start = cursor;
      const quote = character;
      cursor += 1;
      while (cursor < line.contentEnd) {
        if (source[cursor] === "\\") {
          cursor = Math.min(cursor + 2, line.contentEnd);
        } else if (source[cursor] === quote) {
          cursor += 1;
          break;
        } else {
          cursor += 1;
        }
      }
      tokens.push(token("quoted", source, start, cursor));
      continue;
    }
    if (character === "\\") {
      const end = Math.min(cursor + 2, line.contentEnd);
      tokens.push(token("escape", source, cursor, end));
      cursor = end;
      continue;
    }
    const start = cursor;
    while (cursor < line.contentEnd && !isDelimiter(source[cursor])) {
      cursor += 1;
    }
    tokens.push(
      token(cursor === start ? "unknown" : "word", source, start, Math.max(cursor, start + 1)),
    );
    if (cursor === start) {
      cursor += 1;
    }
  }
}

function isHorizontalWhitespace(character: string | undefined): boolean {
  return character === " " || character === "\t" || character === "\v" || character === "\f";
}

function isDelimiter(character: string | undefined): boolean {
  return (
    character === undefined ||
    isHorizontalWhitespace(character) ||
    character === "{" ||
    character === "}" ||
    character === "=" ||
    character === "'" ||
    character === '"' ||
    character === "\\"
  );
}

function token(kind: TokenKind, source: string, start: number, end: number): Token {
  return { kind, start, end, raw: source.slice(start, end) };
}
