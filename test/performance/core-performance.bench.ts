import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { format, parse } from "../../packages/language-core/src/index.js";

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
    for (let warmup = 0; warmup < 5; warmup += 1) parse(corpus);
    const p95 = percentile95(measure(25, () => parse(corpus)));
    expect(p95, `parse p95 was ${p95.toFixed(2)} ms`).toBeLessThan(20);
  });

  it("formats the same document below the 200 ms p95 budget", () => {
    for (let warmup = 0; warmup < 3; warmup += 1) format(corpus);
    const p95 = percentile95(measure(10, () => format(corpus)));
    expect(p95, `formatter p95 was ${p95.toFixed(2)} ms`).toBeLessThan(200);
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
