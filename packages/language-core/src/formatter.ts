import { parse } from "./parser.js";
import type { DocumentNode, ParsedDocument, TextEdit } from "./model.js";
import { SourceMap } from "./source-map.js";

export interface FormatOptions {
  readonly insertSpaces?: boolean;
  readonly tabSize?: number;
  readonly range?: { readonly start: number; readonly end: number };
}

export function format(source: string, options: FormatOptions = {}): readonly TextEdit[] {
  const document = parse(source);
  if (document.diagnostics.some(({ severity }) => severity === "error")) {
    return [];
  }
  const editableLines = collectEditableLines(document, options.range);
  const map = new SourceMap(source);
  const edits: TextEdit[] = [];
  const indentation = options.insertSpaces === false ? "\t" : " ".repeat(options.tabSize ?? 2);
  for (const item of editableLines) {
    const line = map.lines.find(({ start }) => start === item.start);
    if (line === undefined) {
      continue;
    }
    const original = source.slice(line.start, line.contentEnd);
    const content = original.trimStart();
    let desired = content;
    if (item.depth > 0 && content !== "}") {
      desired = `${indentation.repeat(item.depth)}${content}`;
    }
    if (item.node.kind === "directive" || item.node.kind === "include") {
      desired = normalizeDirectiveSpacing(desired);
    }
    if (desired !== original) {
      edits.push({ start: line.start, end: line.contentEnd, newText: desired });
    }
  }
  return edits;
}

export function applyEdits(source: string, edits: readonly TextEdit[]): string {
  let result = source;
  for (const edit of [...edits].sort((left, right) => right.start - left.start)) {
    result = `${result.slice(0, edit.start)}${edit.newText}${result.slice(edit.end)}`;
  }
  return result;
}

interface EditableLine {
  readonly start: number;
  readonly depth: number;
  readonly node: DocumentNode;
}

function collectEditableLines(
  document: ParsedDocument,
  range: FormatOptions["range"],
): readonly EditableLine[] {
  const lines: EditableLine[] = [];
  const visit = (nodes: readonly DocumentNode[], depth: number): void => {
    for (const node of nodes) {
      if (!withinRange(node, range)) {
        continue;
      }
      if (node.kind === "rotation-block") {
        lines.push({ start: node.header.start, depth: Math.max(0, depth - 1), node: node.header });
        visit(node.children, depth + 1);
        if (node.closeBrace !== undefined) {
          lines.push({
            start: lineStart(document.source, node.closeBrace.start),
            depth: Math.max(0, depth - 1),
            node,
          });
        }
      } else if (node.kind === "script") {
        lines.push({ start: node.starter.start, depth, node: node.starter });
        if (node.terminator !== undefined) {
          lines.push({ start: node.terminator.start, depth, node: node.terminator });
        }
      } else if (node.kind === "directive" || node.kind === "include") {
        lines.push({ start: node.start, depth, node });
      }
    }
  };
  visit(document.children, 0);
  return lines;
}

function withinRange(node: DocumentNode, range: FormatOptions["range"]): boolean {
  return range === undefined || (node.start >= range.start && node.end <= range.end);
}

function lineStart(source: string, offset: number): number {
  const lf = source.lastIndexOf("\n", offset - 1);
  const cr = source.lastIndexOf("\r", offset - 1);
  return Math.max(lf, cr) + 1;
}

function normalizeDirectiveSpacing(value: string): string {
  const match = /^(\s*)([A-Za-z]+)(?:\s*=\s*|[\t ]+)(.*)$/u.exec(value);
  return match === null
    ? value
    : `${match[1] ?? ""}${match[2] ?? ""}${(match[3] ?? "") === "" ? "" : ` ${match[3]}`}`;
}
