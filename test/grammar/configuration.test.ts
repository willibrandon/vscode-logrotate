import { describe, expect, it } from "vitest";
import { directiveNames } from "../../packages/language-core/src/index.js";
import { loadGrammar, tokenAt } from "./tokenize.js";

describe("configuration TextMate grammar", () => {
  it("scopes every reviewed syntax word as a directive at a logical line start", async () => {
    const grammar = await loadGrammar("source.logrotate");
    for (const name of directiveNames) {
      const source = name === "endscript" ? "postrotate\necho done\nendscript\n" : `${name}\n`;
      const line = name === "endscript" ? 2 : 0;
      expect(tokenAt(grammar, source, line, 0).scopes, name).toContain(
        "keyword.control.directive.logrotate",
      );
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
});
