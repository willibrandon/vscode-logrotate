import { describe, expect, it } from "vitest";
import { loadGrammar, tokenAt } from "./tokenize.js";

describe("state and Markdown grammars", () => {
  it("scopes state headers, paths, and timestamp fields separately", async () => {
    const grammar = await loadGrammar("source.logrotate.state");
    const source = 'logrotate state -- version 2\n"/var/log/a" 2026-08-11-23:59:58';
    expect(tokenAt(grammar, source, 0, 27).scopes).toContain(
      "constant.numeric.version.logrotate.state",
    );
    expect(tokenAt(grammar, source, 1, 2).scopes).toContain("string.quoted.path.logrotate.state");
    expect(tokenAt(grammar, source, 1, 15).scopes).toContain(
      "constant.numeric.year.logrotate.state",
    );
    const recordLine = source.split("\n")[1];
    expect(recordLine).toBeDefined();
    expect(tokenAt(grammar, source, 1, recordLine?.indexOf("23") ?? -1).scopes).toContain(
      "constant.numeric.hour.logrotate.state",
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
});
