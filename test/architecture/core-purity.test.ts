import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { glob } from "glob";
import { describe, expect, it } from "vitest";

describe("language-core architecture", () => {
  it("has no Node, DOM, VS Code, process, environment, or network dependency", async () => {
    const root = resolve(import.meta.dirname, "../..");
    const files = await glob("packages/language-core/src/**/*.ts", { cwd: root, absolute: true });
    const violations: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (
        /from\s+["'](?:node:|vscode)|\b(?:process\.env|process\.cwd|window\.|fetch\(|XMLHttpRequest|WebSocket)\b/u.test(
          source,
        )
      ) {
        violations.push(file.slice(root.length + 1));
      }
    }
    expect(violations).toEqual([]);
  });
});
