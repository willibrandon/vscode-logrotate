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

`npm run test:performance` runs the isolated single-worker core benchmark after warmup. Grammar
tests bound pathological lines. LSP diagnostics are debounced, version checked, cancellable, and
capped. Include work is bounded separately and never blocks static syntax highlighting.

Record CI runner class, Node version, sample count, p95, and corpus description when changing a
budget. Do not raise a gate to hide contention or a regression; optimize the hot path or document a
reviewed platform reason.
