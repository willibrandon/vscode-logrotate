import { describe, expect, it } from "vitest";
import { analyze, parse, rotationBlocks } from "../src/index.js";

describe("configuration parser", () => {
  it("parses globals, optional equals, inline hash values, and a multiline path block", () => {
    const source = `weekly
rotate = 4
include /etc/logrotate.d#literal
"/var/log/app one.log"
/var/log/app-*.log {
  size 100M
  create 0640 "service user" :1000
}
`;
    const document = parse(source);
    expect(document.diagnostics).toEqual([]);
    expect(document.children.slice(0, 3).map(({ kind }) => kind)).toEqual([
      "directive",
      "directive",
      "include",
    ]);
    const include = document.children[2];
    expect(include?.kind === "include" ? include.target?.value : undefined).toBe(
      "/etc/logrotate.d#literal",
    );
    const block = rotationBlocks(document)[0];
    expect(block?.header.paths.map(({ value }) => value)).toEqual([
      "/var/log/app one.log",
      "/var/log/app-*.log",
    ]);
    expect(block?.children.filter(({ kind }) => kind === "directive")).toHaveLength(2);
    expect(document.tokens.map(({ raw }) => raw).join("")).toBe(source);
  });

  it("preserves every raw script-body byte and ignores directive-like shell text", () => {
    const body = '  if test "# literal"; then\r\n    rotate=not-a-directive { }\r\n  fi\r\n';
    const source = `/var/log/app.log {\r\n  postrotate\r\n${body}  endscript\r\n}\r\n`;
    const document = parse(source);
    const block = rotationBlocks(document)[0];
    const script = block?.children.find(({ kind }) => kind === "script");
    expect(script?.kind === "script" ? script.body : undefined).toBe(body);
    expect(
      script?.kind === "script" ? source.slice(script.bodySpan.start, script.bodySpan.end) : "",
    ).toBe(body);
    expect(document.diagnostics).toEqual([]);
  });

  it("recovers after case, scope, size, mode, date, and brace errors", () => {
    const source = `Weekly
tabooext + .bak
/var/log/app.log {
  include /etc/forbidden
  size 1m
  create 0988 root root
  dateformat -%Q
  daily
`;
    const document = parse(source);
    expect(document.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["LR1007", "LR1008", "LR1103", "LR1106", "LR1107", "LR1006"]),
    );
    const block = rotationBlocks(document)[0];
    expect(block?.children.some((node) => node.kind === "directive" && node.name === "daily")).toBe(
      true,
    );
  });

  it("keeps multiline path spans aligned to original UTF-16 source", () => {
    const source = `"/var/log/😀 one.log"
  # header comment
/var/log/two.log {
  daily
}
`;
    const block = rotationBlocks(parse(source))[0];
    expect(block?.header.paths.map(({ value }) => value)).toEqual([
      "/var/log/😀 one.log",
      "/var/log/two.log",
    ]);
    for (const path of block?.header.paths ?? []) {
      expect(source.slice(path.start, path.end)).toBe(path.raw);
    }
    expect(source.slice(block?.header.paths[1]?.start, block?.header.paths[1]?.end)).toBe(
      "/var/log/two.log",
    );
  });

  it("suggests only a uniquely close directive and rejects malformed separation", () => {
    const source = "rotat 4\nzzzz 1\nrotate! 4\n";
    const diagnostics = parse(source).diagnostics;
    expect(diagnostics.find(({ start }) => start === 0)).toMatchObject({
      code: "LR1001",
      data: { suggestion: "rotate" },
    });
    const unrelated = diagnostics.find(({ start }) => start === 8);
    expect(unrelated).toMatchObject({ code: "LR1001" });
    expect(unrelated).not.toHaveProperty("data");
    expect(diagnostics.map(({ code }) => code)).toContain("LR1010");
  });

  it("diagnoses unmatched terminators, brace trailers, empty paths, and empty values", () => {
    const source = `endscript
{} trailing
/var/log/a { trailing
  mail ""
} trailing
`;
    expect(parse(source).diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["LR1008", "LR1012", "LR1013", "LR1014", "LR1108"]),
    );
  });

  it("uses the configured known target and stays conservative for unknown old targets", () => {
    const source = "/var/log/a {\n  dateformat -%Q\n}\n";
    expect(parse(source, { targetVersion: "3.22" }).diagnostics[0]?.message).toContain("3.22");
    expect(parse(source, { targetVersion: "3.10" }).diagnostics).toEqual([]);
  });

  it("diagnoses a missing script terminator without changing its body", () => {
    const source = "/var/log/a {\n  prerotate\n    echo data\n";
    const document = parse(source);
    expect(document.diagnostics.map(({ code }) => code)).toContain("LR1009");
    const script = rotationBlocks(document)[0]?.children.find(({ kind }) => kind === "script");
    expect(script?.kind === "script" ? script.body : "").toBe("    echo data\n");
  });

  it("reports semantic prerequisite and conflict intersections with related spans", () => {
    const source = `/var/log/a {
  delaycompress
  dateformat -%Y%m%d
  mailfirst
  shredcycles 3
  create
  copy
  copytruncate
}
`;
    const diagnostics = analyze(parse(source));
    expect(diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["LR2002", "LR2003", "LR2004", "LR2005", "LR2006", "LR2007"]),
    );
    expect(diagnostics.find(({ code }) => code === "LR2007")?.related).toHaveLength(1);
  });

  it("evaluates prerequisites in order with inherited globals and negations", () => {
    const inherited = analyze(
      parse(`compress
/var/log/a {
  delaycompress
}
nocompress
/var/log/b {
  delaycompress
  compress
}
`),
    ).filter(({ code }) => code === "LR2002");
    expect(inherited).toEqual([]);

    const notRetroactive = analyze(
      parse(`/var/log/a {
  delaycompress
}
compress
`),
    ).filter(({ code }) => code === "LR2002");
    expect(notRetroactive).toHaveLength(1);
    expect(notRetroactive[0]?.start).toBe(15);
  });

  it("honors later negative forms and caps semantic diagnostics", () => {
    const source = `/var/log/a {
  compress
  nocompress
  delaycompress
  copy
  nocopy
  create
  dateformat -%Y
  mailfirst
  shredcycles 2
}
`;
    const diagnostics = analyze(parse(source, { maxProblems: 2 }));
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map(({ code }) => code)).toEqual(["LR2002", "LR2003"]);
  });

  it("caps diagnostics and honors cancellation", () => {
    const source = `${"UNKNOWN\n".repeat(20)}daily\n`;
    expect(parse(source, { maxProblems: 3 }).diagnostics).toHaveLength(3);
    expect(parse(source, { cancelled: () => true }).children).toEqual([]);
    expect(parse(source, { cancelled: () => true }).tokens).toEqual([]);
  });
});
