import type { LineInfo, Token, TokenKind } from "./model.js";
import { SourceMap } from "./source-map.js";

export function lex(source: string): readonly Token[] {
  const map = new SourceMap(source);
  const tokens: Token[] = [];
  for (const line of map.lines) {
    lexLine(source, line, tokens);
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
    if (character === " " || character === "\t" || character === "\v" || character === "\f") {
      const start = cursor;
      do {
        cursor += 1;
      } while (/^[\t\v\f ]$/u.test(source[cursor] ?? ""));
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
    while (cursor < line.contentEnd && !/[\t\v\f {}='"\\]/u.test(source[cursor] ?? "")) {
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

function token(kind: TokenKind, source: string, start: number, end: number): Token {
  return { kind, start, end, raw: source.slice(start, end) };
}
