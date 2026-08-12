import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { buildIncludeGraph, format, parse } from "../../packages/language-core/src/index.js";
import type { FileSystemProvider, ResourceStat } from "../../packages/language-core/src/index.js";

const corpus = Array.from({ length: 1000 }, (_, index) => {
  const suffix = "x".repeat(96);
  return [
    `"/var/log/application ${index}.log"`,
    `/var/log/${suffix}-${index}-*.log {`,
    "  weekly 7",
    "  rotate 4",
    "  dateext",
    "  postrotate",
    '    if test "${rotate:-no}"; then # shell body',
    "      echo '{ daily }'",
    "  endscript",
    "}",
  ].join("\n");
}).join("\n");

describe("pure-core performance budgets", () => {
  it("parses a mixed 10,000-line document below the 20 ms p95 budget", () => {
    expect(corpus.split("\n")).toHaveLength(10_000);
    for (let warmup = 0; warmup < 20; warmup += 1) parse(corpus);
    const p95 = percentile95(measure(25, () => parse(corpus)));
    report("parse-10k", p95, 25);
    expect(p95, `parse p95 was ${p95.toFixed(2)} ms`).toBeLessThan(20);
  });

  it("formats the same document below the 200 ms p95 budget", () => {
    for (let warmup = 0; warmup < 3; warmup += 1) format(corpus);
    const p95 = percentile95(measure(10, () => format(corpus)));
    report("format-10k", p95, 10);
    expect(p95, `formatter p95 was ${p95.toFixed(2)} ms`).toBeLessThan(200);
  });

  it("analyzes the intersected 10,000-line and depth-16 include corpus within the diagnostic work budget", async () => {
    const fileSystem = deepIncludeFileSystem();
    const source = `include depth-1.conf\n${corpus}`;
    for (let warmup = 0; warmup < 3; warmup += 1) {
      await buildIncludeGraph("file:///workspace/root.conf", source, fileSystem);
    }
    const samples = await measureAsync(10, () =>
      buildIncludeGraph("file:///workspace/root.conf", source, fileSystem),
    );
    const graph = await buildIncludeGraph("file:///workspace/root.conf", source, fileSystem);
    const p95 = percentile95(samples);
    report("include-depth-16", p95, 10);

    expect(graph.cancelled).toBe(false);
    expect(graph.files.size).toBe(17);
    expect(graph.rotations).toHaveLength(1000);
    expect(p95, `include-graph p95 was ${p95.toFixed(2)} ms`).toBeLessThan(150);
  });
});

function measure(iterations: number, action: () => unknown): readonly number[] {
  return Array.from({ length: iterations }, () => {
    const start = performance.now();
    action();
    return performance.now() - start;
  });
}

function percentile95(samples: readonly number[]): number {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
}

async function measureAsync(
  iterations: number,
  action: () => Promise<unknown>,
): Promise<readonly number[]> {
  const samples: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now();
    await action();
    samples.push(performance.now() - start);
  }
  return samples;
}

function deepIncludeFileSystem(): FileSystemProvider {
  const files = new Map<string, string>();
  for (let depth = 1; depth <= 16; depth += 1) {
    const next = depth === 16 ? "" : `include depth-${depth + 1}.conf\n`;
    const directives = Array.from({ length: 100 }, (_, index) => `rotate ${index}\n`).join("");
    files.set(`file:///workspace/depth-${depth}.conf`, `${next}${directives}`);
  }
  return {
    readFile(uri: string): Promise<string> {
      const source = files.get(uri);
      if (source === undefined) throw new Error(`Missing benchmark resource ${uri}`);
      return Promise.resolve(source);
    },
    readDirectory(): Promise<readonly string[]> {
      throw new Error("The deep include benchmark contains no directory includes.");
    },
    stat(uri: string): Promise<ResourceStat> {
      const source = files.get(uri);
      if (source === undefined) throw new Error(`Missing benchmark resource ${uri}`);
      return Promise.resolve({ type: "file", size: source.length, mtime: 1 });
    },
    resolve(baseUri: string, target: string): string {
      return new URL(target, baseUri).toString();
    },
    join(baseDirectoryUri: string, entry: string): string {
      return new URL(entry, `${baseDirectoryUri.replace(/\/$/u, "")}/`).toString();
    },
    normalize(value: string): string {
      return new URL(value).toString();
    },
  };
}

function report(operation: string, p95: number, samples: number): void {
  process.stdout.write(
    `[performance] ${operation}: p95=${p95.toFixed(2)} ms, samples=${samples}, node=${process.version}\n`,
  );
}
