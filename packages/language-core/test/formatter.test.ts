import { describe, expect, it } from "vitest";
import { applyEdits, format, parse, rotationBlocks } from "../src/index.js";

describe("formatter", () => {
  it("normalizes only safe indentation and spacing while preserving shell bytes and CRLF", () => {
    const body = "    cat <<EOF\r\n  semantic indentation\r\nEOF\r\n";
    const source = `/var/log/a {\r\nsize= 100M\r\npostrotate\r\n${body}endscript\r\n}\r\n`;
    const edits = format(source, { insertSpaces: true, tabSize: 2 });
    const formatted = applyEdits(source, edits);
    expect(formatted).toBe(
      `/var/log/a {\r\n  size 100M\r\n  postrotate\r\n${body}  endscript\r\n}\r\n`,
    );
    const beforeScript = rotationBlocks(parse(source))[0]?.children.find(
      ({ kind }) => kind === "script",
    );
    const afterScript = rotationBlocks(parse(formatted))[0]?.children.find(
      ({ kind }) => kind === "script",
    );
    expect(beforeScript?.kind === "script" ? beforeScript.body : "").toBe(body);
    expect(afterScript?.kind === "script" ? afterScript.body : "").toBe(body);
    expect(format(formatted, { insertSpaces: true, tabSize: 2 })).toEqual([]);
    expect(
      edits.every((edit, index) => {
        const previous = edits[index - 1];
        return previous === undefined || previous.end <= edit.start;
      }),
    ).toBe(true);
  });

  it("returns no edits when malformed syntax makes preservation unsafe", () => {
    expect(format('/var/log/a {\n  dateformat "unfinished\n')).toEqual([]);
  });

  it("range formatting refuses partial nodes", () => {
    const source = "/var/log/a {\nsize 10M\n}\n";
    expect(format(source, { range: { start: 16, end: 18 } })).toEqual([]);
  });

  it("range formatting accepts a complete directive node nested in a stanza", () => {
    const source = "/var/log/a {\nsize= 10M\n}\n";
    const directive = rotationBlocks(parse(source))[0]?.children[0];
    expect(directive).toBeDefined();
    const edits = format(source, {
      insertSpaces: true,
      tabSize: 2,
      range: { start: directive?.start ?? 0, end: directive?.end ?? 0 },
    });
    expect(applyEdits(source, edits)).toBe("/var/log/a {\n  size 10M\n}\n");
    expect(edits.every(({ end, start }) => end - start < "size= 10M".length)).toBe(true);
  });
});
