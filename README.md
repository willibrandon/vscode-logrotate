# Logrotate for Visual Studio Code

Language support for [logrotate](https://github.com/logrotate/logrotate) configuration and state
files in Visual Studio Code desktop, remote, and web extension hosts.

> [!IMPORTANT] This repository is under active development and is not published yet. The language
> model is currently pinned to logrotate `3be1e9ccffe0c2245ed596183c74913d553f9f18` (3.22 and later
> reviewed syntax).

## Target 1.0 feature set

- Immediate TextMate syntax highlighting without extension activation.
- Dedicated highlighting for configuration files, state files, embedded shell script blocks, and
  fenced logrotate examples in Markdown.
- An error-tolerant, lossless TypeScript parser with diagnostics, completion, hover, signature help,
  symbols, folding, selection ranges, links, references, semantic tokens, safe code actions, and
  formatting.
- The same language core and LSP behavior on desktop and in a browser Worker.
- Bounded include analysis through VS Code's filesystem API, including virtual workspaces.
- Optional host validation with an installed `logrotate` executable. This is off by default and
  available only for saved local files in trusted desktop workspaces.

The extension never executes `prerotate`, `postrotate`, `firstaction`, `lastaction`, or `preremove`
scripts. Its formatter preserves the raw bytes of script bodies and does not reorder directives.

## Recognized files

The extension intentionally uses narrow defaults:

- `logrotate.conf`
- files directly under a `logrotate.d` directory
- `*.logrotate` and `*.logrotate.conf`
- extensionless files whose first line is a complete absolute or tilde-prefixed log-path stanza
- `logrotate.status`
- `logrotate/status`
- state files whose first line is `logrotate state -- version 1` or `logrotate state -- version 2`

It does not claim every `.conf`, `.status`, or file named `status`. Associate an unusual project
filename using VS Code's built-in setting:

```json
{
  "files.associations": {
    "deploy/rotation-policy": "logrotate"
  }
}
```

Markdown fences named `logrotate`, `logrotate.conf`, and `logrotate-config` are highlighted:

````markdown
```logrotate
/var/log/application.log {
  weekly
  rotate 4
  compress
}
```
````

## Settings

| Setting                             | Default     | Purpose                                                           |
| ----------------------------------- | ----------- | ----------------------------------------------------------------- |
| `logrotate.validation.enable`       | `true`      | Enable built-in syntax and semantic diagnostics.                  |
| `logrotate.validation.maxProblems`  | `100`       | Limit diagnostics for a malformed document.                       |
| `logrotate.targetVersion`           | `latest`    | Select `latest`, safe `auto`, or an explicitly supported version. |
| `logrotate.externalValidation.mode` | `off`       | Optionally validate with the installed binary on save.            |
| `logrotate.executablePath`          | `logrotate` | Installed executable used by trusted desktop validation.          |
| `logrotate.trace.server`            | `off`       | Set LSP protocol trace detail for deep troubleshooting.           |

Internal validation models the reviewed logrotate language. Optional installed validation uses
`logrotate --debug` and reflects the current host's version, filesystem, accounts, build options,
and include graph. It is a secondary opinion, not the extension parser or formatter.

## Commands

- **Logrotate: Validate Current File with Installed Logrotate**
- **Logrotate: Restart Language Server**
- **Logrotate: Show Language Server Output**
- **Logrotate: Open Directive Documentation**

Installed validation explains why it is unavailable for an unsaved or virtual file, an untrusted
workspace, or a browser extension host.

The **Logrotate Language Server** output channel records extension and server startup, analyzed
document URIs and versions, diagnostic and include counts, configuration changes, restarts, closes,
and failures. Default info logs never include document contents. Explicit protocol tracing can
include document contents, so enable it only while troubleshooting.

## Workspace trust and privacy

Built-in parsing works in Restricted Mode. Executable settings and installed validation are
restricted and checked again immediately before process creation. Browser and virtual workspaces
retain internal language features but cannot run a host executable.

Version 1 has no telemetry and makes no runtime network requests. Documentation links open only
after an explicit user action.

## Development

Requirements:

- Node.js 24 LTS
- npm 11 (the exact package manager version is recorded in `package.json`)
- Chromium and Xvfb for web and headless desktop integration tests
- logrotate 3.22 or later for optional differential and installed-tool tests

```sh
nvm use
npm ci
npm run generate
npm run verify
```

Useful focused commands:

```sh
npm run check:generated
npm run lint
npm run typecheck
npm test
npm run test:grammar
npm run test:lsp
npm run test:integration
npm run test:web
npm run build
npm run package
```

The repository uses native TypeScript 7 for compilation. TypeScript 6 is installed only as the
compatibility API consumed by typed ESLint while TypeScript 7.0 has no programmatic compiler API.
Runtime code uses ESM source, strict host-specific projects, npm workspaces, and four independent
esbuild outputs:

```text
packages/language-core   pure host-independent language implementation
packages/language-server shared handlers plus Node and Worker adapters
packages/vscode-client   desktop and browser clients and filesystem bridge
data                     reviewed directive and version source of truth
syntaxes                 generated TextMate grammars
test                     grammar, architecture, package, and host-level tests
```

`data/directives.yaml` generates the grammar keyword expression, completion and hover tables,
semantic metadata, snippets, and [directive reference](docs/directives.md). Run `npm run generate`
after reviewed data changes and commit every generated consumer. `npm run check:generated` rejects
drift.

The complete product and technical rationale is in [docs/design.md](docs/design.md).

## Status and contributing

The implementation is built phase by phase against the acceptance criteria in `docs/design.md`.
Contributions should preserve browser/desktop parity, lossless script bodies, conservative
diagnostics, bounded resource use, and generated language-data consistency. See
[CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and the
[release checklist](docs/release-checklist.md).

This project is distributed under the [MIT License](LICENSE) by Brandon Williams and publishes as
`willibrandon.logrotate`. Protected release rules and private reporting must be verified before the
first public release.
