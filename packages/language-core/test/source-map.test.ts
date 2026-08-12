import { describe, expect, it } from "vitest";
import { SourceMap } from "../src/index.js";

describe("SourceMap", () => {
  it("roundtrips UTF-16 offsets across LF, CRLF, astral, and combining text", () => {
    const source = "ascii\n😀é\r\nlast\r";
    const map = new SourceMap(source);
    for (let offset = 0; offset <= source.length; offset += 1) {
      if (source[offset - 1] === "\r" && source[offset] === "\n") continue;
      expect(map.offsetAt(map.positionAt(offset))).toBe(offset);
    }
    expect(map.lines.map(({ newline }) => newline)).toEqual(["\n", "\r\n", "\r", ""]);
    expect(map.positionAt(source.indexOf("e"))).toEqual({ line: 1, character: 2 });
  });

  it("clamps positions and offsets to the source", () => {
    const map = new SourceMap("one\ntwo");
    expect(map.positionAt(-10)).toEqual({ line: 0, character: 0 });
    expect(map.positionAt(100)).toEqual({ line: 1, character: 3 });
    expect(map.offsetAt({ line: 99, character: 99 })).toBe(7);
  });
});
