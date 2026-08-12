import { describe, expect, it } from "vitest";
import { parseState } from "../src/index.js";

describe("state parser", () => {
  it.each([1, 2] as const)("parses version %i quoted paths and timestamps", (version) => {
    const source = `logrotate state -- version ${version}\n"/var/log/app\\ name.log" 2026-8-11-23:59:58\n`;
    const state = parseState(source);
    expect(state.version).toBe(version);
    expect(state.records).toEqual([
      expect.objectContaining({
        path: "/var/log/app name.log",
        year: 2026,
        month: 8,
        day: 11,
        hour: 23,
        minute: 59,
        second: 58,
      }),
    ]);
    expect(state.diagnostics).toEqual([]);
  });

  it("reports malformed header, unquoted path, timestamp shape, and field ranges", () => {
    expect(parseState("wrong\n").diagnostics[0]?.code).toBe("LRS1001");
    expect(parseState("logrotate state -- version 2\n/path 2026-8-11\n").diagnostics[0]?.code).toBe(
      "LRS1003",
    );
    expect(parseState('logrotate state -- version 2\n"/path" today\n').diagnostics[0]?.code).toBe(
      "LRS1004",
    );
    expect(
      parseState('logrotate state -- version 2\n"/path" 2026-13-32-24:60:60\n').diagnostics[0]
        ?.code,
    ).toBe("LRS1005");
  });

  it("models upstream year/day compatibility and rejects malformed quoting and comments", () => {
    expect(parseState('logrotate state -- version 1\n"/path" 1900-1-0\n').diagnostics).toEqual([]);
    expect(
      parseState('logrotate state -- version 2\n"/path" 1969-1-1\n').diagnostics[0]?.code,
    ).toBe("LRS1005");
    expect(
      parseState('logrotate state -- version 2\n"unfinished 2026-1-1\n').diagnostics[0]?.code,
    ).toBe("LRS1006");
    expect(parseState("logrotate state -- version 2\n# comment\n").diagnostics[0]?.code).toBe(
      "LRS1003",
    );
  });
});
