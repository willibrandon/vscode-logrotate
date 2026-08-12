# Performance budgets

The budgets are engineering regression gates measured on supported CI hardware, not marketing
claims.

| Operation                               | Initial gate                             |
| --------------------------------------- | ---------------------------------------- |
| Parse a mixed 10,000-line configuration | p95 under 20 ms                          |
| Format the same configuration           | p95 under 200 ms                         |
| Settled internal diagnostics            | under 300 ms                             |
| Local single-line reanalysis            | p95 under 50 ms                          |
| Warm completion                         | p95 under 100 ms                         |
| TextMate highlighting                   | no catastrophic regular-expression cases |

`npm run test:performance` runs isolated single-worker core and in-memory JSON-RPC benchmarks after
warmup. Grammar tests bound pathological lines. LSP diagnostics are debounced, version checked,
cancellable, and capped. Include work is bounded separately and never blocks static syntax
highlighting. The parser gate uses five independently warmed sample windows and the best p95, while
printing every trial. This estimates uncontended parser throughput on a shared runner without
raising the 20 ms budget; a regression must miss the budget in every trial. Every run prints its
p95, sample count, and Node version to the build log.

## Recorded baseline

The 2026-08-12 development baseline used Debian 13 under WSL, Node 24.19.0, and one Vitest worker.
CI enforces the same thresholds on `ubuntu-latest`; the desktop matrix separately covers the three
supported operating systems.

| Operation                         | Samples | Recorded p95 |
| --------------------------------- | ------: | -----------: |
| Client/server initialize          |      20 |      1.89 ms |
| First diagnostics with debounce   |      20 |    152.47 ms |
| Single-line incremental diagnosis |      30 |      9.22 ms |
| Warm completion                   |      50 |      0.32 ms |
| Parse 10,000 lines                |      25 |      6.87 ms |
| Format 10,000 lines               |      10 |     40.06 ms |
| Analyze a depth-16 include graph  |      10 |     13.08 ms |

The 10,000-line corpus deliberately combines very long and quoted path headers, thousands of
directives, and shell bodies containing directive words and braces. The include benchmark adds the
same root corpus to a depth-16 graph with another 1,600 directives. These are regression gates, not
claims about every machine or filesystem provider.

Record CI runner class, Node version, sample count, p95, and corpus description when changing a
budget. Do not raise a gate to hide contention or a regression; optimize the hot path or document a
reviewed platform reason.
