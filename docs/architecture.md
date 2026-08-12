# Architecture

The extension has three source workspaces and four independently bundled runtime entries:

```text
VS Code desktop ── desktop client ── IPC ── Node language server ─┐
VS Code web ────── browser client ── Worker ─ browser server ─────┤
                                                                ├─ pure language core
workspace.fs bridge ─────────────────────────────────────────────┘
```

## Boundaries

`packages/language-core` owns source mapping, lexing, lossless parsing, version selection, semantic
analysis, formatting, state parsing, and bounded include traversal. It may not import Node, DOM, or
VS Code APIs. Time, cancellation, and resources enter through explicit values or interfaces.

`packages/language-server` owns deterministic LSP handlers. `server.ts` is transport-neutral;
`node.ts` and `browser.ts` are small adapters. A shared JSON-RPC contract suite exercises the real
message boundary, including diagnostics lifecycle and virtual filesystem requests.

`packages/vscode-client` owns activation, commands, workspace configuration, `workspace.fs`, trust,
and the optional desktop process. The web client starts the same server in a Worker and never
imports Node built-ins. The desktop process host uses explicit arguments, `shell: false`, process
groups, timeouts, output caps, cancellation, and a trust callback checked immediately before
spawning.

## Data and generation

The reviewed YAML registry generates TypeScript metadata, grammars, snippets, and directive
documentation. `npm run check:generated` performs generation in memory and fails on any difference.
The upstream logrotate checkout is a pinned CI input, never shipped or vendored.

## Resource lifecycle

Clients, output channels, JSON-RPC request registrations, diagnostics, timers, Workers, abort
controllers, and process groups are owned by an extension or server lifecycle and disposed on stop.
Diagnostics are version-checked after debounce; shutdown waits for active jobs. Include traversal is
depth-first in inline source order with resource and cancellation limits.

## Packaging

Only the four minified bundles, static language assets, localization, and user/legal documents enter
the VSIX. Source, tests, caches, source maps, native binaries, and development dependencies are
denied by an exact package allowlist and negative scanner.
