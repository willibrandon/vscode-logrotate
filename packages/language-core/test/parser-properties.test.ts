import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parse } from "../src/index.js";
import type { DocumentNode } from "../src/index.js";

describe("parser properties", () => {
  it("terminates and keeps token, node, and diagnostic spans bounded for arbitrary Unicode", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 4096 }), (source) => {
        const document = parse(source, { maxProblems: 17 });
        expect(document.tokens.map(({ raw }) => raw).join("")).toBe(source);
        expect(document.tokens.every((token) => validSpan(token, source.length))).toBe(true);
        expect(ordered(document.tokens)).toBe(true);
        expect(document.children.every((node) => validSpan(node, source.length))).toBe(true);
        expect(ordered(document.children)).toBe(true);
        expect(document.diagnostics.length).toBeLessThanOrEqual(17);
        expect(
          document.diagnostics.every((diagnostic) => validSpan(diagnostic, source.length)),
        ).toBe(true);
        assertNestedSpans(document.children, source.length);
      }),
      { numRuns: 500 },
    );
  });

  it("keeps reconstruction exact for binary-like code units", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 2048 }), (bytes) => {
        const source = String.fromCharCode(...bytes);
        expect(
          parse(source)
            .tokens.map(({ raw }) => raw)
            .join(""),
        ).toBe(source);
      }),
      { numRuns: 200 },
    );
  });
});

function validSpan(
  span: { readonly start: number; readonly end: number },
  length: number,
): boolean {
  return span.start >= 0 && span.start <= span.end && span.end <= length;
}

function ordered(spans: readonly { readonly start: number; readonly end: number }[]): boolean {
  return spans.every((span, index) => {
    const previous = spans[index - 1];
    return previous === undefined || previous.end <= span.start;
  });
}

function assertNestedSpans(nodes: readonly DocumentNode[], sourceLength: number): void {
  for (const node of nodes) {
    if (node.kind !== "rotation-block") continue;
    expect(node.children.every((child) => validSpan(child, sourceLength))).toBe(true);
    expect(ordered(node.children)).toBe(true);
    assertNestedSpans(node.children, sourceLength);
  }
}
