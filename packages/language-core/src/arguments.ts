import type { CoreDiagnostic, DecodedArgument } from "./model.js";

export interface DecodeResult {
  readonly arguments: readonly DecodedArgument[];
  readonly diagnostics: readonly CoreDiagnostic[];
}

export function decodeArguments(
  source: string,
  start: number = 0,
  end: number = source.length,
): DecodeResult {
  const decoded: DecodedArgument[] = [];
  const diagnostics: CoreDiagnostic[] = [];
  let cursor = start;

  while (cursor < end) {
    while (cursor < end && isHorizontalWhitespace(source[cursor])) {
      cursor += 1;
    }
    if (cursor >= end) {
      break;
    }

    const argumentStart = cursor;
    let value = "";
    let quote: "'" | '"' | undefined;
    let quoted = false;
    let complete = true;

    while (cursor < end) {
      const character = source[cursor];
      if (quote === undefined && isHorizontalWhitespace(character)) {
        break;
      }
      if (character === "\\") {
        if (cursor + 1 >= end) {
          complete = false;
          diagnostics.push({
            code: "LR1003",
            severity: "error",
            message: "A trailing backslash does not escape a character.",
            source: "logrotate",
            start: cursor,
            end: cursor + 1,
          });
          cursor += 1;
          break;
        }
        value += source[cursor + 1] ?? "";
        cursor += 2;
        continue;
      }
      if (character === "'" || character === '"') {
        if (quote === undefined) {
          quote = character;
          quoted = true;
          cursor += 1;
          continue;
        }
        if (quote === character) {
          quote = undefined;
          cursor += 1;
          continue;
        }
      }
      value += character ?? "";
      cursor += 1;
    }

    if (quote !== undefined) {
      complete = false;
      diagnostics.push({
        code: "LR1002",
        severity: "error",
        message: `The ${quote === '"' ? "double" : "single"}-quoted argument is not terminated.`,
        source: "logrotate",
        start: argumentStart,
        end: cursor,
      });
    }

    decoded.push({
      start: argumentStart,
      end: cursor,
      raw: source.slice(argumentStart, cursor),
      value,
      quoted,
      complete,
    });
  }

  return { arguments: decoded, diagnostics };
}

function isHorizontalWhitespace(character: string | undefined): boolean {
  return character === " " || character === "\t" || character === "\v" || character === "\f";
}
