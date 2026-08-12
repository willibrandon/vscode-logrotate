import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyEdits, format, parse, rotationBlocks } from "../src/index.js";
import type { ParsedDocument } from "../src/index.js";

describe("formatter properties", () => {
  it("preserves semantics, scripts, order, newlines, and idempotence across safe layouts", () => {
    fc.assert(
      fc.property(
        fc.record({
          newline: fc.constantFrom("\n", "\r\n", "\r"),
          indentation: fc.constantFrom("", " ", "    ", "\t"),
          separator: fc.constantFrom(" ", "  ", " = ", "=  "),
          paths: fc.constantFrom(
            "/var/log/app.log",
            '"/var/log/app one.log"',
            "/var/log/app-*.log",
          ),
          frequency: fc.constantFrom("daily", "weekly", "monthly"),
          body: fc.constantFrom("  echo ok", "\tcat <<EOF", "  rotate=not-a-directive { # shell"),
        }),
        ({ newline, indentation, separator, paths, frequency, body }) => {
          const source = [
            "# retained comment",
            `${paths} {`,
            `${indentation}${frequency}`,
            `${indentation}rotate${separator}4`,
            `${indentation}postrotate`,
            body,
            `${indentation}endscript`,
            "}",
            "",
          ].join(newline);
          const before = parse(source);
          expect(before.diagnostics).toEqual([]);
          const edits = format(source, { insertSpaces: true, tabSize: 2 });
          const afterSource = applyEdits(source, edits);
          const after = parse(afterSource);
          expect(after.diagnostics).toEqual([]);
          expect(semanticFingerprint(after)).toEqual(semanticFingerprint(before));
          expect(scriptBodies(after)).toEqual(scriptBodies(before));
          expect(format(afterSource, { insertSpaces: true, tabSize: 2 })).toEqual([]);
          expect(
            edits.every((edit, index) => {
              const previous = edits[index - 1];
              return (
                edit.start <= edit.end &&
                source.slice(edit.start, edit.end) !== edit.newText &&
                (previous === undefined || previous.end <= edit.start)
              );
            }),
          ).toBe(true);
          expect(after.newline).toBe(newline);
          expect(afterSource.replaceAll(newline, "")).not.toMatch(/[\r\n]/u);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("never formats an arbitrary unfinished quote", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 256 }), (prefix) => {
        const source = `/var/log/a {\n  dateformat "${prefix.replaceAll("\n", " ")}\n`;
        expect(format(source)).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});

function semanticFingerprint(document: ParsedDocument): unknown {
  return rotationBlocks(document).map((block) => ({
    paths: block.header.paths.map(({ value }) => value),
    directives: block.children.map((node) => {
      if (node.kind === "directive") {
        return [node.name, node.arguments.map(({ value }) => value)];
      }
      if (node.kind === "script") {
        return [node.starter.name, node.body];
      }
      return node.kind;
    }),
  }));
}

function scriptBodies(document: ParsedDocument): readonly string[] {
  return rotationBlocks(document).flatMap((block) =>
    block.children.flatMap((node) => (node.kind === "script" ? [node.body] : [])),
  );
}
