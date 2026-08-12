import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { directives } from "../../packages/language-core/src/index.js";
import { loadGrammar, tokenAt } from "./tokenize.js";

describe("configuration TextMate grammar", () => {
  it("scopes every reviewed syntax word in each declared context", async () => {
    const grammar = await loadGrammar("source.logrotate");
    for (const directive of directives) {
      if (directive.name === "endscript") {
        expect(
          tokenAt(grammar, "postrotate\necho done\nendscript\n", 2, 0).scopes,
          directive.name,
        ).toContain("keyword.control.directive.logrotate");
        continue;
      }
      if (directive.scopes.includes("global")) {
        expect(tokenAt(grammar, `${directive.name}\n`, 0, 0).scopes, directive.name).toContain(
          "keyword.control.directive.logrotate",
        );
      }
      if (directive.scopes.includes("block")) {
        expect(
          tokenAt(grammar, `/var/log/example.log {\n  ${directive.name}\n}\n`, 1, 2).scopes,
          directive.name,
        ).toContain("keyword.control.directive.logrotate");
      }
    }
  });

  it("does not scope directive words inside values, paths, comments, or shell bodies", async () => {
    const grammar = await loadGrammar("source.logrotate");
    const source = `/var/log/rotate.log {
  extension rotate
  # rotate
  postrotate
    rotate daily
  endscript
}
`;
    expect(tokenAt(grammar, source, 0, 9).scopes).not.toContain(
      "keyword.control.directive.logrotate",
    );
    expect(tokenAt(grammar, source, 1, 13).scopes).not.toContain(
      "keyword.control.directive.logrotate",
    );
    expect(tokenAt(grammar, source, 2, 4).scopes).toContain("comment.line.number-sign.logrotate");
    expect(tokenAt(grammar, source, 4, 6).scopes).toContain("source.shell");
    expect(tokenAt(grammar, source, 5, 3).scopes).toContain("keyword.control.directive.logrotate");
  });

  it("scopes include paths, sizes, units, modes, users, groups, and braces precisely", async () => {
    const grammar = await loadGrammar("source.logrotate");
    expect(tokenAt(grammar, "include /etc/logrotate.d", 0, 10).scopes).toContain(
      "string.unquoted.path.include.logrotate",
    );
    expect(tokenAt(grammar, "size 100M", 0, 6).scopes).toContain("constant.numeric.logrotate");
    expect(tokenAt(grammar, "size 100M", 0, 8).scopes).toContain("keyword.other.unit.logrotate");
    expect(tokenAt(grammar, "create 0640 user group", 0, 8).scopes).toContain(
      "constant.numeric.mode.logrotate",
    );
    expect(tokenAt(grammar, "create 0640 user group", 0, 13).scopes).toContain(
      "entity.name.user.logrotate",
    );
    expect(tokenAt(grammar, "su user group", 0, 9).scopes).toContain("entity.name.group.logrotate");
    expect(tokenAt(grammar, "/var/log/a {", 0, 11).scopes).toContain(
      "punctuation.section.block.begin.logrotate",
    );
  });

  it("treats hashes as comments only at the first non-whitespace configuration position", async () => {
    const grammar = await loadGrammar("source.logrotate");
    const source = `  # full-line comment
extension .gz#retained
"/var/log/#literal path.log" {
  postrotate
    printf '%s\\n' '# shell comment semantics belong to shell'
  endscript
}
`;

    expect(tokenAt(grammar, source, 0, 3).scopes).toContain("comment.line.number-sign.logrotate");
    expect(
      tokenAt(grammar, source, 1, source.split("\n")[1]?.indexOf("#") ?? -1).scopes,
    ).not.toContain("comment.line.number-sign.logrotate");
    expect(tokenAt(grammar, source, 2, source.split("\n")[2]?.indexOf("#") ?? -1).scopes).toContain(
      "string.quoted.path.logrotate",
    );
    expect(tokenAt(grammar, source, 4, source.split("\n")[4]?.indexOf("#") ?? -1).scopes).toContain(
      "source.shell",
    );
  });

  it("scopes multiline absolute, tilde, glob, and quoted header paths without promoting values", async () => {
    const grammar = await loadGrammar("source.logrotate");
    const source = `/var/log/application-*.log
~/logs/current.log
"/var/log/application output.log" '/var/log/second output.log'
{
  extension /var/log/rotate.log
}
`;

    expect(tokenAt(grammar, source, 0, 5).scopes).toContain("string.unquoted.path.logrotate");
    expect(tokenAt(grammar, source, 1, 2).scopes).toContain("string.unquoted.path.logrotate");
    expect(tokenAt(grammar, source, 2, 2).scopes).toContain("string.quoted.path.logrotate");
    expect(tokenAt(grammar, source, 3, 0).scopes).toContain(
      "punctuation.section.block.begin.logrotate",
    );
    expect(tokenAt(grammar, source, 4, 21).scopes).not.toContain(
      "keyword.control.directive.logrotate",
    );
  });

  it.each(["firstaction", "lastaction", "postrotate", "preremove", "prerotate"])(
    "owns exactly one opaque shell region for %s",
    async (starter) => {
      const grammar = await loadGrammar("source.logrotate");
      const source = `${starter}
daily { # directive-like shell content
endscript
rotate 4`;

      expect(tokenAt(grammar, source, 0, 0).scopes).toContain(
        "keyword.control.directive.logrotate",
      );
      expect(tokenAt(grammar, source, 1, 0).scopes).toContain("source.shell");
      expect(tokenAt(grammar, source, 1, 0).scopes).not.toContain(
        "keyword.control.directive.logrotate",
      );
      expect(tokenAt(grammar, source, 2, 0).scopes).toContain(
        "keyword.control.directive.logrotate",
      );
      expect(tokenAt(grammar, source, 3, 0).scopes).not.toContain("source.shell");
      expect(tokenAt(grammar, source, 3, 0).scopes).toContain(
        "keyword.control.directive.logrotate",
      );
    },
  );

  it("keeps incomplete scripts bounded to the remaining document and rejects invalid starters", async () => {
    const grammar = await loadGrammar("source.logrotate");
    const incomplete = "postrotate\ndaily { # still shell\n";
    const invalid = "postrotate unexpected\ndaily\n";

    expect(tokenAt(grammar, incomplete, 1, 0).scopes).toContain("source.shell");
    expect(tokenAt(grammar, invalid, 0, 0).scopes).toContain("keyword.control.directive.logrotate");
    expect(tokenAt(grammar, invalid, 1, 0).scopes).not.toContain("source.shell");
  });

  it("tokenizes pathological long lines and script bodies within the grammar budget", async () => {
    const grammar = await loadGrammar("source.logrotate");
    const longPath = `/var/log/${"quoted-#-path-".repeat(2_000)}.log {`;
    const scriptBody = `postrotate\n${"daily { # shell } ".repeat(2_000)}\nendscript`;
    const start = performance.now();

    expect(tokenAt(grammar, longPath, 0, longPath.length - 2).scopes).toContain(
      "string.unquoted.path.logrotate",
    );
    expect(
      tokenAt(grammar, scriptBody, 1, scriptBody.split("\n")[1]?.length ?? 0).scopes,
    ).toContain("source.shell");
    expect(performance.now() - start).toBeLessThan(500);
  });
});
