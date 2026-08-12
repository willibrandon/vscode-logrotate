import { describe, expect, it } from "vitest";
import { lex } from "../src/index.js";

describe("lexer", () => {
  it("partitions normal source exactly and treats only leading hashes as comments", () => {
    const source = "  # comment\ninclude /etc/path#literal\nrotate = 4\r\n";
    const tokens = lex(source);
    expect(tokens.map(({ raw }) => raw).join("")).toBe(source);
    expect(tokens.filter(({ kind }) => kind === "comment").map(({ raw }) => raw)).toEqual([
      "# comment",
    ]);
  });

  it("makes script bodies opaque while retaining starter and terminator tokens", () => {
    const source = "/var/log/a {\npostrotate\n  rotate = 99 # shell\n  { shell; }\nendscript\n}\n";
    const tokens = lex(source);
    expect(tokens.map(({ raw }) => raw).join("")).toBe(source);
    expect(tokens.filter(({ kind }) => kind === "raw-shell").map(({ raw }) => raw)).toEqual([
      "  rotate = 99 # shell",
      "  { shell; }",
    ]);
    expect(tokens.filter(({ kind }) => kind === "comment")).toEqual([]);
  });

  it("stops promptly when cancellation is requested", () => {
    let checks = 0;
    const tokens = lex("daily\n".repeat(10_000), () => {
      checks += 1;
      return checks > 2;
    });
    expect(checks).toBe(3);
    expect(tokens.length).toBeLessThan(10);
  });
});
