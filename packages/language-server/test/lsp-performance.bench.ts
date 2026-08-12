import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it } from "vitest";
import type { CompletionItem } from "vscode-languageserver";
import type { TimerHost } from "../src/server.js";
import { createServerHarness, type ServerHarness } from "./harness.js";

const uri = "file:///workspace/performance.logrotate";
const productionTimers: TimerHost = {
  setTimeout(callback, milliseconds): ReturnType<typeof setTimeout> {
    return setTimeout(callback, milliseconds);
  },
  clearTimeout(handle): void {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};
const incrementalCorpus = Array.from(
  { length: 500 },
  (_, index) => `/var/log/application-${index}.log {\n  daily\n  rotate 4\n}\n`,
).join("");

describe("language-server performance budgets", () => {
  const active = new Set<ServerHarness>();

  afterEach(async () => {
    await Promise.all([...active].map(async (harness) => harness.dispose()));
    active.clear();
  });

  it("initializes below the 150 ms p95 client-ready budget", async () => {
    const warmup = await createServerHarness();
    await warmup.dispose();
    const samples = await measureAsync(20, async () => {
      const harness = await createServerHarness();
      await harness.dispose();
    });
    const p95 = percentile95(samples);
    report("initialize", p95, samples.length);
    expect(p95, `initialize p95 was ${p95.toFixed(2)} ms`).toBeLessThan(150);
  });

  it("publishes first diagnostics below 300 ms with the production debounce", async () => {
    const samples = await measureAsync(20, async () => {
      const harness = await createServerHarness({}, productionTimers);
      active.add(harness);
      await harness.open(uri, "logrotate", "rotate nope\n");
      await harness.waitForDiagnostics(
        uri,
        (diagnostics, publication) =>
          publication.version === 1 && diagnostics.some(({ code }) => code === "LR1104"),
      );
      active.delete(harness);
      await harness.dispose();
    });
    const p95 = percentile95(samples);
    report("first-diagnostics", p95, samples.length);
    expect(p95, `first diagnostics p95 was ${p95.toFixed(2)} ms`).toBeLessThan(300);
  });

  it("reanalyzes a local single-line incremental edit below 50 ms p95", async () => {
    const harness = await createServerHarness();
    active.add(harness);
    await harness.open(uri, "logrotate", incrementalCorpus);
    await harness.waitForDiagnostics(uri, (_diagnostics, publication) => publication.version === 1);

    let version = 1;
    const samples = await measureAsync(30, async (index) => {
      version += 1;
      const value = index % 2 === 0 ? "5" : "4";
      await harness.changeIncremental(
        uri,
        {
          start: { line: 2, character: "  rotate ".length },
          end: { line: 2, character: "  rotate 4".length },
        },
        value,
        version,
      );
      await harness.waitForDiagnostics(
        uri,
        (_diagnostics, publication) => publication.version === version,
      );
    });
    const p95 = percentile95(samples);
    report("incremental-diagnostics", p95, samples.length);
    expect(p95, `incremental diagnostics p95 was ${p95.toFixed(2)} ms`).toBeLessThan(50);
  });

  it("returns warm completion below 100 ms p95", async () => {
    const harness = await createServerHarness();
    active.add(harness);
    await harness.open(uri, "logrotate", "/var/log/application.log {\n  co\n}\n");
    await harness.waitForDiagnostics(uri);
    const request = async (): Promise<CompletionItem[]> =>
      harness.client.sendRequest("textDocument/completion", {
        textDocument: { uri },
        position: { line: 1, character: 4 },
      });
    for (let index = 0; index < 10; index += 1) await request();

    const samples = await measureAsync(50, request);
    const p95 = percentile95(samples);
    report("warm-completion", p95, samples.length);
    expect(p95, `warm completion p95 was ${p95.toFixed(2)} ms`).toBeLessThan(100);
  });
});

async function measureAsync(
  iterations: number,
  action: (index: number) => Promise<unknown>,
): Promise<readonly number[]> {
  const samples: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now();
    await action(index);
    samples.push(performance.now() - start);
  }
  return samples;
}

function percentile95(samples: readonly number[]): number {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
}

function report(operation: string, p95: number, samples: number): void {
  process.stdout.write(
    `[performance] ${operation}: p95=${p95.toFixed(2)} ms, samples=${samples}, node=${process.version}\n`,
  );
}
