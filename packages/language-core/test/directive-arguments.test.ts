import { describe, expect, it } from "vitest";
import { directives, parse } from "../src/index.js";
import type { DirectiveDefinition } from "../src/index.js";

describe("directive argument validation", () => {
  it.each([
    ["su :not-a-number :1000", "LR1109", ":not-a-number"],
    ["su :1000 :not-a-number", "LR1110", ":not-a-number"],
    ["su :2147483647 :1000", "LR1109", ":2147483647"],
    ["su :1000 :2147483647", "LR1110", ":2147483647"],
    ["create 0640 :bad :1000", "LR1109", ":bad"],
    ["create 0640 :1000 :bad", "LR1110", ":bad"],
    ["createolddir :bad :1000", "LR1109", ":bad"],
    ["createolddir :1000 :bad", "LR1110", ":bad"],
  ])("diagnoses host-independent identity error in %s", (line, code, invalid) => {
    const diagnostic = parse(`${line}\n`).diagnostics.find((candidate) => candidate.code === code);

    expect(diagnostic).toMatchObject({
      code,
      severity: "error",
      start: line.indexOf(invalid),
      end: line.indexOf(invalid) + invalid.length,
    });
  });

  it.each([
    "su :1000 :1000",
    "su \"service user\" 'service group'",
    "create :1000 :1000",
    "create 0640 :1000 :1000",
    "createolddir :1000 :1000",
    "createolddir 0755 :1000 :1000",
  ])("accepts environment-independent identity form %s", (line) => {
    expect(
      parse(`${line}\n`).diagnostics.filter(({ code }) => /^LR11(?:09|10)$/u.test(code)),
    ).toEqual([]);
  });

  it("diagnoses whitespace inside a decoded mail address", () => {
    const source = '/var/log/app.log {\n  mail "admin team@example.com"\n}\n';
    const value = "admin team@example.com";
    const start = source.indexOf(value);

    expect(parse(source).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "LR1111",
        severity: "error",
        start,
        end: start + value.length,
      }),
    );
  });

  it.each(["tabooext +", "taboopat +"])(
    "requires a list after the append operator in %s",
    (source) => {
      const operator = source.indexOf("+");
      expect(parse(`${source}\n`).diagnostics).toContainEqual(
        expect.objectContaining({
          code: "LR1112",
          severity: "error",
          start: operator,
          end: operator + 1,
        }),
      );
    },
  );

  it.each(["tabooext +.bak", "taboopat +*.disabled", "tabooext .bak + .old"])(
    "accepts upstream taboo-list replacement and append form %s",
    (source) => {
      expect(parse(`${source}\n`).diagnostics.filter(({ code }) => code === "LR1112")).toEqual([]);
    },
  );

  it.each(
    directives
      .filter(({ arguments: argument }) => maximumArity(argument.kind, argument.maximumArity) < 4)
      .map((directive) => [directive.name, directive] as const),
  )("%s diagnoses tokens beyond its maximum arity", (_name, directive) => {
    const maximum = maximumArity(directive.arguments.kind, directive.arguments.maximumArity);
    const extraArguments = Array.from({ length: maximum + 1 }, () => "extra").join(" ");
    const source = sourceForDirective(directive, `${directive.name} ${extraArguments}`);

    expect(parse(source).diagnostics.map(({ code }) => code)).toContain("LR1102");
  });
});

function maximumArity(kind: string, declared: number | undefined): number {
  if (declared !== undefined) return declared;
  if (kind === "remainder" || kind === "taboo-list") return Number.POSITIVE_INFINITY;
  return kind === "none" || kind === "script" || kind === "terminator" ? 0 : 1;
}

function sourceForDirective(directive: DirectiveDefinition, line: string): string {
  if (directive.scopes.includes("global")) return `${line}\n`;
  const terminator = directive.arguments.kind === "script" ? "endscript\n" : "";
  return `/var/log/example.log {\n${line}\n${terminator}}\n`;
}
