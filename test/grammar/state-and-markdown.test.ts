import { describe, expect, it } from "vitest";
import { loadGrammar, tokenAt } from "./tokenize.js";

describe("state and Markdown grammars", () => {
  it.each([1, 2])(
    "scopes state version %i headers, escaped paths, and timestamp fields separately",
    async (version) => {
      const grammar = await loadGrammar("source.logrotate.state");
      const source = `logrotate state -- version ${version}\n"/var/log/a\\ name.log" 2026-08-11-23:59:58`;
      expect(tokenAt(grammar, source, 0, 27).scopes).toContain(
        "constant.numeric.version.logrotate.state",
      );
      expect(tokenAt(grammar, source, 1, 2).scopes).toContain("string.quoted.path.logrotate.state");
      const recordLine = source.split("\n")[1] ?? "";
      expect(tokenAt(grammar, source, 1, recordLine.indexOf("2026")).scopes).toContain(
        "constant.numeric.year.logrotate.state",
      );
      expect(tokenAt(grammar, source, 1, recordLine.indexOf("23")).scopes).toContain(
        "constant.numeric.hour.logrotate.state",
      );
    },
  );

  it("scopes date-only records and restrains malformed records to an invalid record scope", async () => {
    const grammar = await loadGrammar("source.logrotate.state");
    const source = 'logrotate state -- version 2\n"/var/log/a" 2026-8-11\n/path 2026-13-40';

    expect(tokenAt(grammar, source, 1, 14).scopes).toContain(
      "constant.numeric.year.logrotate.state",
    );
    expect(tokenAt(grammar, source, 2, 1).scopes).toContain(
      "invalid.illegal.record.logrotate.state",
    );
    expect(tokenAt(grammar, source, 2, 1).scopes).not.toContain(
      "string.quoted.path.logrotate.state",
    );
  });

  it.each(["logrotate", "logrotate.conf", "logrotate-config"])(
    "injects %s backtick fences without consuming the closer",
    async (info) => {
      const grammar = await loadGrammar("source.logrotate.markdown");
      const source = `\`\`\`${info}\ndaily\n\`\`\``;
      expect(tokenAt(grammar, source, 1, 1).scopes).toContain(
        "keyword.control.directive.logrotate",
      );
      expect(tokenAt(grammar, source, 2, 1).scopes).not.toContain("meta.embedded.block.logrotate");
    },
  );

  it("injects tilde fences and excludes their closing delimiter", async () => {
    const grammar = await loadGrammar("source.logrotate.markdown");
    const source = "~~~logrotate\nrotate 4\n~~~";
    expect(tokenAt(grammar, source, 1, 1).scopes).toContain("keyword.control.directive.logrotate");
    expect(tokenAt(grammar, source, 2, 1).scopes).not.toContain("meta.embedded.block.logrotate");
  });

  it.each(["`", "~"])(
    "accepts a longer %s closing fence but not a shorter or mismatched delimiter",
    async (delimiter) => {
      const grammar = await loadGrammar("source.logrotate.markdown");
      const other = delimiter === "`" ? "~" : "`";
      const source = `${delimiter.repeat(4)}logrotate
daily
${delimiter.repeat(3)}
rotate 4
${other.repeat(5)}
weekly
${delimiter.repeat(5)}
outside`;

      expect(tokenAt(grammar, source, 2, 1).scopes).toContain("meta.embedded.block.logrotate");
      expect(tokenAt(grammar, source, 3, 0).scopes).toContain(
        "keyword.control.directive.logrotate",
      );
      expect(tokenAt(grammar, source, 4, 1).scopes).toContain("meta.embedded.block.logrotate");
      expect(tokenAt(grammar, source, 5, 0).scopes).toContain(
        "keyword.control.directive.logrotate",
      );
      expect(tokenAt(grammar, source, 6, 1).scopes).toContain("punctuation.definition.markdown");
      expect(tokenAt(grammar, source, 6, 1).scopes).not.toContain("meta.embedded.block.logrotate");
      expect(tokenAt(grammar, source, 7, 0).scopes).not.toContain("meta.embedded.block.logrotate");
    },
  );
});
