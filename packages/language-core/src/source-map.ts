import type { LineInfo, TextPosition } from "./model.js";

export class SourceMap {
  readonly #source: string;
  readonly #lines: readonly LineInfo[];

  public constructor(source: string) {
    this.#source = source;
    this.#lines = Object.freeze(scanLines(source));
  }

  public get source(): string {
    return this.#source;
  }

  public get lines(): readonly LineInfo[] {
    return this.#lines;
  }

  public positionAt(offset: number): TextPosition {
    const bounded = Math.max(0, Math.min(offset, this.#source.length));
    let low = 0;
    let high = this.#lines.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const line = this.#lines[middle];
      if (line === undefined) {
        break;
      }
      if (bounded < line.start) {
        high = middle - 1;
      } else if (bounded >= line.end && line.line < this.#lines.length - 1) {
        low = middle + 1;
      } else {
        return { line: line.line, character: bounded - line.start };
      }
    }
    const last = this.#lines.at(-1);
    return last === undefined
      ? { line: 0, character: 0 }
      : { line: last.line, character: bounded - last.start };
  }

  public offsetAt(position: TextPosition): number {
    const lineIndex = Math.max(0, Math.min(position.line, this.#lines.length - 1));
    const line = this.#lines[lineIndex];
    if (line === undefined) {
      return 0;
    }
    return Math.min(line.contentEnd, line.start + Math.max(0, position.character));
  }
}

function scanLines(source: string): LineInfo[] {
  const lines: LineInfo[] = [];
  let start = 0;
  let line = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character !== "\n" && character !== "\r") {
      continue;
    }
    const isCrLf = character === "\r" && source[index + 1] === "\n";
    const newline: "\n" | "\r\n" | "\r" = isCrLf ? "\r\n" : character;
    const end = index + newline.length;
    lines.push({ line, start, contentEnd: index, end, newline });
    line += 1;
    start = end;
    if (isCrLf) {
      index += 1;
    }
  }
  lines.push({ line, start, contentEnd: source.length, end: source.length, newline: "" });
  return lines;
}
