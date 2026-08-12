import { describe, expect, it } from "vitest";
import { decodeArguments } from "../src/index.js";

describe("decodeArguments", () => {
  it.each([
    ["one two", ["one", "two"]],
    ["'one two' three", ["one two", "three"]],
    ['"one # two" tail', ["one # two", "tail"]],
    ["one\\ two escaped\\#hash", ["one two", "escaped#hash"]],
    ["'' \"\"", ["", ""]],
    ["'a'\"b\"c", ["abc"]],
  ])("decodes %s with popt-style quoting and escaping", (source, expected) => {
    const result = decodeArguments(source);
    expect(result.arguments.map(({ value }) => value)).toEqual(expected);
    expect(result.arguments.map(({ raw }) => raw).join(" ")).toBe(source);
    expect(result.diagnostics).toEqual([]);
  });

  it("retains malformed raw spans and reports an unfinished quote", () => {
    const result = decodeArguments("before 'unfinished value");
    expect(result.arguments.map(({ value }) => value)).toEqual(["before", "unfinished value"]);
    expect(result.arguments[1]).toMatchObject({
      raw: "'unfinished value",
      complete: false,
      quoted: true,
      start: 7,
      end: 24,
    });
    expect(result.diagnostics).toMatchObject([{ code: "LR1002", start: 7, end: 24 }]);
  });

  it("reports a trailing backslash without discarding it from the raw span", () => {
    const result = decodeArguments("value\\");
    expect(result.arguments[0]).toMatchObject({ raw: "value\\", value: "value", complete: false });
    expect(result.diagnostics[0]?.code).toBe("LR1003");
  });
});
