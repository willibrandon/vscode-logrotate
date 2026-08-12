import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { glob } from "glob";
import { describe, expect, it } from "vitest";
import { parse } from "../../packages/language-core/src/index.js";

const root = resolve(import.meta.dirname, "../..");
const upstream = resolve(process.env["LOGROTATE_SOURCE"] ?? resolve(root, "../logrotate"));
const classification = JSON.parse(
  await readFile(resolve(import.meta.dirname, "upstream-classification.json"), "utf8"),
) as {
  readonly revision: string;
  readonly accepted: readonly string[];
  readonly rejected: readonly string[];
};
const baseline = JSON.parse(
  await readFile(resolve(root, "data/upstream-baseline.json"), "utf8"),
) as {
  readonly configTemplates: Readonly<Record<string, string>>;
};

describe.skipIf(!existsSync(resolve(upstream, "config.c")))("pinned upstream parser corpus", () => {
  it("classifies every template at the exact reviewed revision", () => {
    const revision = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: upstream,
      encoding: "utf8",
    }).trim();
    expect(revision).toBe(classification.revision);
    expect(new Set([...classification.accepted, ...classification.rejected])).toEqual(
      new Set(Object.keys(baseline.configTemplates)),
    );
    expect(classification.accepted).toHaveLength(98);
    expect(classification.rejected).toHaveLength(10);
  });

  it("keeps accepted templates free of parser errors", async () => {
    const failures: string[] = [];
    for (const name of classification.accepted) {
      const source = materialize(await readFile(resolve(upstream, "test", name), "utf8"));
      const document = parse(source, { maxProblems: 1000 });
      assertSpans(document, source.length);
      const errors = document.diagnostics.filter(({ severity }) => severity === "error");
      if (errors.length > 0) {
        failures.push(`${name}: ${errors.map(({ code }) => code).join(", ")}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("keeps rejected syntax templates negative", async () => {
    for (const name of classification.rejected) {
      const source = materialize(await readFile(resolve(upstream, "test", name), "utf8"));
      const document = parse(source, { maxProblems: 1000 });
      assertSpans(document, source.length);
      expect(
        document.diagnostics.some(({ severity }) => severity === "error"),
        `${name} unexpectedly parsed without an error`,
      ).toBe(true);
    }
  });

  it("does not vendor byte-identical upstream fixtures", async () => {
    const upstreamHashes = new Set(Object.values(baseline.configTemplates));
    const localFiles = await glob("test/**/*", { cwd: root, nodir: true });
    const copied: string[] = [];
    for (const path of localFiles) {
      const digest = createHash("sha256")
        .update(await readFile(resolve(root, path)))
        .digest("hex");
      if (upstreamHashes.has(digest)) copied.push(path);
    }
    expect(copied).toEqual([]);
  });
});

function materialize(source: string): string {
  return source
    .replaceAll("&DIR&", "/tmp/logrotate-conformance")
    .replaceAll("&USER&", '"logrotate-user"')
    .replaceAll("&GROUP&", '"logrotate-group"')
    .replaceAll("&ROOTGROUP&", '"root"');
}

function assertSpans(value: unknown, sourceLength: number): void {
  if (Array.isArray(value)) {
    for (const item of value) assertSpans(item, sourceLength);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const record = value as Readonly<Record<string, unknown>>;
  if (typeof record["start"] === "number" && typeof record["end"] === "number") {
    expect(record["start"]).toBeGreaterThanOrEqual(0);
    expect(record["end"]).toBeGreaterThanOrEqual(record["start"]);
    expect(record["end"]).toBeLessThanOrEqual(sourceLength);
  }
  for (const nested of Object.values(record)) assertSpans(nested, sourceLength);
}
