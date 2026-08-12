# Logrotate for Visual Studio Code: product and technical design

Status: proposed  
Research and review date: 2026-08-11  
Recommended project name: **Logrotate**  
Recommended repository: `vscode-logrotate`  
Recommended extension identifier: `<verified-publisher>.logrotate`

## 1. Executive decision

Build a focused Visual Studio Code language extension named **Logrotate**. Use the
good architectural idea from `vscode-caddyfile`—declarative TextMate syntax
highlighting plus a separate Language Server Protocol (LSP) implementation—but
do not copy that repository's implementation literally.

The proposed extension has two layers:

1. A TextMate grammar supplies instant, theme-native colorization without
   activating extension code.
2. A bundled, error-tolerant logrotate language service supplies parsing,
   diagnostics, completion, hover, symbols, folding, links, semantic tokens,
   formatting, and safe cross-file include analysis.

The language core is pure TypeScript and is shared by desktop and web extension
hosts. The desktop client uses a Node LSP server; the web client uses the same
server in a Web Worker. An optional invocation of the installed `logrotate`
binary is a secondary, explicitly enabled validation path. It is never the
parser, formatter, or prerequisite for basic language support.

This is superior to either comparison repository by itself:

- It preserves `vscode-caddyfile`'s sound client/server separation and
  no-activation syntax layer, while adding a real parser, browser support,
  virtual-workspace support, trust controls, generated language data, and a
  complete test strategy.
- It preserves `vscode-systemd-unit-file`'s practical recognition of unusual
  configuration filenames, while replacing startup scanning and forced language
  reassignment with declarative file associations and normal user-controlled
  `files.associations` overrides.

The extension should be a separate repository even if it is governed by the
logrotate project. This keeps the C build/release lifecycle independent from the
Node/VS Code lifecycle and makes Marketplace packaging auditable.

## 2. Goals, non-goals, and user promise

### 2.1 Goals

- Correctly colorize `/etc/logrotate.conf`, files under `logrotate.d`, explicitly
  associated project files, logrotate state files, and fenced logrotate examples
  in Markdown.
- Model the syntax actually accepted by logrotate, including its less obvious
  quoting, include, script, ordering, and compile-time behaviors.
- Give useful feedback before a deployment without pretending that static
  analysis can know the target machine's complete filesystem and build options.
- Behave like a modern built-in language feature: fast, quiet, accessible,
  theme-neutral, conservative, and available in desktop, remote, web, and
  virtual workspaces where the feature is technically meaningful.
- Keep one machine-readable directive registry as the source for grammar
  generation, completion, hover, snippets, semantic metadata, and documentation.
- Detect drift from upstream logrotate rather than relying on a manually copied
  keyword list indefinitely.
- Package and publish a reproducible, tested VSIX with a low-trust release path.

### 2.2 Non-goals

- Reimplement rotation, compression, mailing, privilege changes, or script
  execution.
- Execute `prerotate`, `postrotate`, `firstaction`, `lastaction`, or `preremove`
  scripts.
- Take ownership of every `.conf` file, every log file, cron files, or systemd
  units. Those are different languages.
- Require the user's local logrotate executable for highlighting or editing.
- Silently rewrite configuration into a preferred semantic order.
- Provide a sidebar, custom editor, webview, status-bar item, or persistent
  notification when VS Code's normal editor, Problems, Outline, hover, and
  command palette surfaces already solve the problem.
- Ship telemetry in version 1. The default design has no runtime network access
  and collects no usage or content data.

### 2.3 User promise

Opening a recognized file should immediately produce useful highlighting.
Language features should appear shortly afterward and remain responsive while a
file is incomplete. Saving or formatting must never execute configuration
scripts, lose comments, change quoting semantics, or alter shell-body bytes.

## 3. Review baseline and method

This design is based on source inspection, not only README claims.

| Project | Reviewed revision | Purpose |
| --- | --- | --- |
| logrotate | `3be1e9c` on `main` | Authoritative parser, manual, defaults, state format, and test corpus |
| caddyserver/vscode-caddyfile | `9ba30fc` on `master` | Full TextMate + client/server LSP comparison |
| bearmini/vscode-systemd-unit-file | `0dfc69c` on `master` | Thin extension + large TextMate grammar comparison |

The logrotate review covered [`config.c`](../config.c),
[`logrotate.c`](../logrotate.c), [`logrotate.8.in`](../logrotate.8.in), build-time
defaults, CI configuration, and the `test/` corpus. The comparison reviews
covered manifests, grammars, language configurations, TypeScript sources, build
scripts, lockfiles, workflows, and release metadata.

Current-platform recommendations were checked against official documentation on
2026-08-11. At that point the current stable VS Code release was 1.132, released
2026-08-05 ([VS Code 1.132 release notes](https://code.visualstudio.com/updates/v1_132)).
Exact development dependency patch versions in this document are therefore a
dated bootstrap snapshot, not a promise to freeze dependencies forever.

## 4. Upstream logrotate review

### 4.1 Repository character

Logrotate is a mature C project with roughly 14,200 lines in the reviewed source
tree and more than 1,100 commits. The two central implementation files are large:
`config.c` is the configuration parser and `logrotate.c` contains rotation and
state behavior. The manual source is `logrotate.8.in`; `logrotate.conf.5` is only
a manual-page redirect and must not be treated as the documentation source.

The repository is disciplined about portability and systems behavior. Its CI
tests GCC and Clang, macOS, analyzers, sanitizers, C89 compatibility, formatting
constraints, and CodeQL. The tests include more than one hundred generated
configuration fixtures as well as state, script, include, permission, and error
cases. This is valuable conformance evidence for an editor parser.

The stable README at the reviewed revision still names 3.22.0 (2024-06-01), while
`main` contains subsequent behavior, including additional `dateformat`
conversions. The extension therefore needs a versioned language-data model; a
single timeless keyword list will drift.

### 4.2 The actual configuration language

The parser is a hand-written, line-oriented state machine. It is not an INI,
shell, Caddyfile, or generic key/value grammar. Important consequences follow:

- Directive names are lowercase and case-sensitive. The parser's directive
  token is alphabetic; punctuation does not simply become part of a key.
- A directive value follows whitespace and may also follow an optional `=`.
- A normal comment begins when `#` is the first non-whitespace character of a
  configuration line. An apparent inline comment can instead be part of a value
  and should not be globally colored or removed as a comment.
- The log-path list before `{` may span lines. This header has its own
  accumulation and comment behavior and accepts multiple absolute, quoted, or
  build-conditionally tilde-prefixed paths/globs.
- Single quotes, double quotes, and backslash escaping use popt-style argument
  parsing. A robust editor parser must not approximate this with `split(' ')`.
- Global options are inherited into later stanzas. A later definition overrides
  an earlier definition, but a global directive placed after an `include` does
  not retroactively affect files already included.
- Includes are processed inline. Directory entries are ordered alphabetically,
  taboo patterns are applied, non-regular files are skipped, and nesting is
  bounded to 16 levels.
- Some directives are global-only or stanza-only. `tabooext` and `taboopat`, for
  example, are enforced as global-only. Script blocks are stanza behavior.
- Script bodies are raw `/bin/sh` input terminated by `endscript`. They are not
  logrotate directives and must remain opaque to the logrotate formatter.
- Size suffixes are not generic human-size syntax: accepted suffixes are raw
  bytes or `k`/`K`, `M`, and `G`; lowercase `m` and `g` are not equivalent.
- Several numeric arguments have directive-specific ranges and meanings. For
  example, `rotate` permits `-1`, `minutes` must be positive, and modes are
  octal.
- User and group arguments can be quoted. Numeric identifiers prefixed with `:`
  force numeric UID/GID interpretation even when no account exists.
- `tabooext` and `taboopat` lists replace the default list unless prefixed with
  `+`.
- Tilde expansion and several defaults depend on how logrotate was built. The
  language service must distinguish syntax facts from target-host assumptions.

### 4.3 Directive inventory

The reviewed parser recognizes 68 normal directive names plus the `endscript`
terminator. `errors` remains recognized but is deprecated and ignored.

| Category | Directives |
| --- | --- |
| Rotation criteria and retention | `hourly`, `minutes`, `daily`, `weekly`, `monthly`, `yearly`, `size`, `minsize`, `maxsize`, `minage`, `maxage`, `rotate`, `start` |
| Compression | `compress`, `nocompress`, `delaycompress`, `nodelaycompress`, `compresscmd`, `uncompresscmd`, `compressext`, `compressoptions` |
| Copy and rename behavior | `copy`, `nocopy`, `copytruncate`, `nocopytruncate`, `renamecopy`, `norenamecopy`, `allowhardlink`, `noallowhardlink` |
| Creation and directories | `create`, `nocreate`, `createolddir`, `nocreateolddir`, `olddir`, `noolddir`, `su` |
| Names and dates | `dateext`, `nodateext`, `dateformat`, `dateyesterday`, `nodateyesterday`, `datehourago`, `nodatehourago`, `extension`, `addextension` |
| Presence and empty-file handling | `missingok`, `nomissingok`, `ifempty`, `notifempty`, `ignoreduplicates` |
| Mail | `mail`, `nomail`, `mailfirst`, `maillast` |
| Secure removal | `shred`, `noshred`, `shredcycles` |
| Scripts | `firstaction`, `lastaction`, `prerotate`, `postrotate`, `preremove`, `sharedscripts`, `nosharedscripts`, `endscript` |
| Inclusion and taboo matching | `include`, `tabooext`, `taboopat` |
| Deprecated compatibility | `errors` |

This inventory is a reviewed baseline, not a hand-maintenance strategy. The
implementation must store each directive with its argument grammar, valid scope,
negated counterpart, interactions, version information, deprecation state,
documentation link, completion shape, and examples.

### 4.4 Scripts are embedded shell, with a hard preservation rule

The five script-start directives introduce shell content and `endscript`
terminates it. TextMate may embed `source.shell` inside a
`meta.embedded.block.shell` region so themes and basic shell editing work. The
manifest's `embeddedLanguages` mapping should map that region to `shellscript`,
following the official embedded-language guidance
([syntax highlighting guide](https://code.visualstudio.com/api/language-extensions/syntax-highlight-guide),
[embedded languages guide](https://code.visualstudio.com/api/language-extensions/embedded-languages)).

The formatter must preserve every character between the newline after the
script-start directive and the start of the terminating `endscript` line.
Indentation inside a shell here-document can be semantic, so even apparently
harmless reindentation is unsafe. The same preservation rule applies when the
shell text is invalid or incomplete.

### 4.5 State files are a related but separate language

The state file starts with `logrotate state -- version 1` or `version 2`, followed
by quoted/escaped path and timestamp records. It is machine-managed data, not a
configuration file. Model it as a separate language ID, `logrotate-state`, with:

- restrained highlighting;
- record and timestamp validation;
- hover explaining that edits can affect rotation history;
- no formatter, snippets, or mutation-oriented code actions.

Recognition should use the exact first line plus narrowly scoped known names such
as `logrotate.status` and `**/logrotate/status`. It must not claim every file
named `status`.

### 4.6 External validation is useful but not authoritative

`logrotate --debug` performs no rotation and does not run configuration scripts,
which makes it an appropriate optional second opinion. It still reads
configuration and include paths, expands globs, examines filesystem metadata,
and may read state, so it is not a harmless pure parser.

External validation must therefore:

- default to off;
- run only for a saved local-file document in a trusted workspace;
- use an argument array with `shell: false`, never shell concatenation;
- use an isolated state path such as `/dev/null` where supported;
- impose cancellation, timeout, output-size, and process-tree limits;
- never run on every keystroke;
- label diagnostics as target-host results and include the detected logrotate
  version;
- remain optional because commands, defaults, paths, and compile-time features
  vary across platforms.

### 4.7 Upstream test corpus and licensing

The upstream fixture corpus is the best available compatibility oracle. CI
should test the extension parser against a pinned logrotate revision and run a
scheduled drift job against upstream `main`. Negative fixtures must remain
negative; a test suite made only from valid examples will miss the hardest
parser behavior.

Logrotate is GPL-2.0-only, while this extension is MIT licensed. The language
implementation, hover prose, and shipped fixtures therefore remain independently
authored, and upstream GPL content is not copied into the VSIX. Upstream is used
only as a separately checked-out, pinned CI compatibility oracle; its corpus is
not vendored into this repository.

## 5. Comparison review: vscode-caddyfile

Reviewed source: [caddyserver/vscode-caddyfile at `9ba30fc`](https://github.com/caddyserver/vscode-caddyfile/tree/9ba30fc).

### 5.1 What it gets right

- The manifest contributes TextMate grammars and language configuration, so
  colorization is available independently of the TypeScript extension runtime.
- A client package and server package separate VS Code integration from language
  analysis.
- The server uses LSP rather than directly coupling every feature to the VS Code
  API.
- Markdown injection recognizes fenced Caddyfile examples.
- Formatting delegates to a well-known language tool with an argument array and
  cancellation support.
- Build output is bundled instead of publishing a full development dependency
  tree.

These are the Caddyfile ideas this design deliberately adopts: layered language
support, explicit client/server ownership, Markdown support, and bundled output.

### 5.2 What should not be copied

The reviewed package is version 0.4.0 and its architecture has aged. Its manifest
targets VS Code 1.67 and Node 16-era tooling. Its LSP dependencies are 6.x,
whereas VS Code exposed LSP 3.18 in the 1.125 timeframe and the corresponding
language-client/server packages are now 10.x
([VS Code 1.125 release notes](https://code.visualstudio.com/updates/v1_125)).

Specific implementation issues found during review:

- Explicit `onLanguage` activation and broad `workspaceContains` patterns are
  redundant or overly eager for a modern extension. Contributed languages and
  commands automatically generate activation events for current engine targets
  ([activation events](https://code.visualstudio.com/api/references/activation-events)).
- The selector is local-file-centric and there is no browser entry point,
  virtual-workspace declaration, or untrusted-workspace design.
- The parser largely splits lines and spaces rather than producing a lossless,
  recoverable syntax tree. Completion is mostly global, hover tokenization is
  brittle, and validation behavior is incomplete.
- Validation runs on every change without the debouncing, version checks, and
  cancellation expected of an editor language service.
- Sample-server remnants and a broad file watcher remain in production code.
- The TextMate rules are broad, use unusual scope naming, and have no token-scope
  golden tests.
- The external formatter path lacks a complete timeout/output/race strategy and
  can produce repetitive notifications. A custom process-killing package adds
  maintenance surface.
- There are no substantive unit, grammar, LSP, integration, web, or package
  tests. The workflows do not provide a full lint/typecheck/test/package gate.
- Packaging relies on a POSIX `mkdir` sequence that is not idempotent or
  cross-platform.

### 5.3 Caddyfile conclusion

Use the architecture, not the implementation. Logrotate should have a more
accurate parser than the Caddyfile server, a first-class web build, no mandatory
external formatter, and generated rather than manually duplicated directive
metadata.

## 6. Comparison review: vscode-systemd-unit-file

Reviewed source: [bearmini/vscode-systemd-unit-file at `0dfc69c`](https://github.com/bearmini/vscode-systemd-unit-file/tree/0dfc69c).

### 6.1 What it gets right

- The extension is small and recognizes that system configuration files often
  lack useful extensions.
- Its grammar covers a wide set of known section keys and values.
- Configurable suffixes acknowledge project-specific naming conventions.
- The grammar source comments link many tokens to upstream documentation.

### 6.2 Problems revealed by the review

- The extension activates at startup, scans open documents, logs routine file
  activity, and programmatically changes a document's language. That can override
  user intent or another extension and does not cleanly reverse when settings
  change.
- Most standard names are not declared as manifest file associations, so code is
  doing work that VS Code can do without activation.
- The manifest advertises a very old VS Code engine while the emitted JavaScript
  and installed API types assume a much newer environment.
- There is no meaningful automated test or CI/release system.
- The large hand-written alternations contain visible spelling mistakes and are
  structurally under-anchored; known words can be colored as keys when they occur
  in values.
- Scope names are inconsistent and overly generic, making theme behavior and
  embedded use harder to reason about.

### 6.3 Systemd conclusion

Support unconventional logrotate filenames declaratively. Contribute exact
filenames and narrow `filenamePatterns`, document user-controlled
`files.associations`, and never use `setTextDocumentLanguage` to seize arbitrary
documents. Generate keyword expressions from reviewed data and test scopes at
specific positions.

## 7. Current VS Code platform guidance

The platform divides language support into declarative and programmatic
features. TextMate grammars are the primary syntax tokenizer; semantic tokens
augment them rather than replace them. Programmatic features can be implemented
in an LSP server and reused across clients
([language extensions overview](https://code.visualstudio.com/api/language-extensions/overview),
[semantic highlighting guide](https://code.visualstudio.com/api/language-extensions/semantic-highlight-guide),
[language server guide](https://code.visualstudio.com/api/language-extensions/language-server-extension-guide)).

This leads to the following 2026 baseline:

- Declare languages, grammars, snippets, configuration, and Markdown injection
  in `package.json`; do not activate code to perform static registration.
- Use standard TextMate scopes and standard semantic token types/modifiers so
  existing themes, including high-contrast themes, work without bundled colors.
- Activate lazily only when a `logrotate` or `logrotate-state` document needs
  programmatic features.
- Bundle runtime entry points. Run TypeScript type checking separately because
  esbuild transpilation does not type-check
  ([bundling extensions](https://code.visualstudio.com/api/working-with-extensions/bundling-extension)).
- Supply a `browser` entry and Worker-based language server. A web extension
  cannot depend on Node APIs or child processes
  ([web extensions](https://code.visualstudio.com/api/extension-guides/web-extensions)).
- Use `workspace.fs` through a client bridge for virtual resources and declare
  honest virtual-workspace capability
  ([virtual workspaces](https://code.visualstudio.com/api/extension-guides/virtual-workspaces)).
- Keep internal analysis usable in Restricted Mode, but block and hide external
  process execution and protect executable-path settings
  ([workspace trust](https://code.visualstudio.com/api/extension-guides/workspace-trust)).
- Test desktop extensions with `@vscode/test-cli` and
  `@vscode/test-electron`, and test the browser build with `@vscode/test-web`
  ([extension testing](https://code.visualstudio.com/api/working-with-extensions/testing-extension)).
- Keep settings few, documented, and placed in the normal Settings UI. Do not
  use notifications for ordinary success, activation, or missing optional tools
  ([settings UX](https://code.visualstudio.com/api/ux-guidelines/settings),
  [notification UX](https://code.visualstudio.com/api/ux-guidelines/notifications)).
- Publish the VSIX with current `@vscode/vsce` using the narrowly scoped
  `VSCE_PAT` GitHub Actions secret for the `willibrandon` publisher
  ([VSCE repository](https://github.com/microsoft/vscode-vsce),
  [publishing extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)).

The target engine should be `^1.100.0` unless implementation proves a later API
is required. It is new enough for the intended runtime and web patterns without
arbitrarily requiring the newest editor. CI must exercise that floor, current
stable, and Insiders. The development runtime should be Node 24 LTS on the
review date, not the short-lived current release
([Node release schedule](https://nodejs.org/en/about/previous-releases)).

## 8. Product identity and manifest design

### 8.1 Name

Use **Logrotate**. It is short, searchable, unsurprising, and matches how users
will search the Marketplace and command palette. Avoid a clever brand that hides
the language being supported.

The repository is public and the Visual Studio Marketplace publisher is
`willibrandon`. The selected values are:

| Field | Value |
| --- | --- |
| Display name | `Logrotate` |
| Extension name | `logrotate` |
| Repository | `vscode-logrotate` |
| Language ID | `logrotate` |
| State language ID | `logrotate-state` |
| Main scope | `source.logrotate` |
| State scope | `source.logrotate.state` |
| Configuration prefix | `logrotate` |

Ship the reviewed `media/icon.png`: one high-contrast rotation arrow around
three log lines on a full-bleed blue background. The simple mark remains legible
at small size and has no transparent or dark outer corners.

### 8.2 Manifest outline

The exact JSON is an implementation artifact, but it should express these
decisions:

- `engines.vscode`: `^1.100.0` initially.
- `main`: bundled desktop extension entry.
- `browser`: bundled browser extension entry.
- `extensionKind`: prefer the workspace extension host so include paths and the
  optional tool resolve near remote files.
- `capabilities.virtualWorkspaces`: supported with the documented limitation
  that optional host-process validation is unavailable.
- `capabilities.untrustedWorkspaces`: supported in limited mode; restrict the
  executable path and external-validation settings.
- No explicit `activationEvents` are needed for contributed languages and
  commands at this engine floor.
- No wildcard `workspaceContains` activation.
- No extension dependencies for shell syntax. Embed the standard `source.shell`
  scope and language mapping; gracefully retain logrotate coloring if a richer
  shell provider is absent.

### 8.3 Language associations

Contribute narrow defaults:

- exact filename `logrotate.conf`;
- filename pattern `**/logrotate.d/*`;
- filename patterns `**/*.logrotate` and `**/*.logrotate.conf`;
- exact state filename `logrotate.status`;
- state pattern `**/logrotate/status`;
- state `firstLine` matching `^logrotate state -- version [12]$`.

Do not claim generic `.conf`, `.status`, files named `status`, syslog output, cron
files, or systemd units. README examples should show how users add unusual names
with the built-in `files.associations` setting. This is clearer and safer than a
custom suffix setting plus startup document reassignment.

### 8.4 Markdown injection

Contribute a grammar injection for fenced code blocks whose info string is one
of:

- `logrotate`
- `logrotate.conf`
- `logrotate-config`

Test both backtick and tilde fences and ensure the closing fence is never
consumed as configuration. Do not introduce a custom Markdown renderer.

## 9. Technical architecture

### 9.1 Component model

```text
package.json contributions
  ├─ TextMate grammar ─────────────── instant syntax colorization
  ├─ language configuration ──────── comments, brackets, indentation
  ├─ Markdown injection ──────────── fenced examples
  └─ snippets ────────────────────── conservative authoring templates

VS Code client (desktop or browser)
  ├─ starts the matching LSP server transport
  ├─ bridges workspace.fs and trust state
  ├─ hosts optional trusted desktop validation
  └─ exposes a small set of explicit commands
                │
                ▼
Shared LSP server
  ├─ document lifecycle and cancellation
  ├─ diagnostics and language features
  ├─ bounded include graph
  └─ protocol adaptation
                │
                ▼
Pure language core
  ├─ lexer and popt-compatible argument decoding
  ├─ lossless CST + semantic model
  ├─ directive registry
  ├─ formatter and source mapping
  └─ version-aware rules
```

TextMate and semantic tokens are complementary. TextMate supplies a stable base
even if activation fails. Semantic tokens refine context only where the parser
has better knowledge—for example, a user/group, mode, date conversion, path,
deprecated `errors`, or a directive shadowed by later configuration.

### 9.2 Repository layout

Use npm workspaces rather than inheriting the Caddyfile repository's older pnpm
and Turbo setup. `vsce` explicitly supports the conventional npm packaging path,
and this project does not need a monorepo task orchestrator.

```text
vscode-logrotate/
  .github/
    workflows/
  packages/
    language-core/          # pure TS; no vscode, Node, or DOM dependency
    language-server/        # shared LSP handlers; node/browser adapters
    vscode-client/          # desktop/browser activation and FS bridge
  data/
    directives.yaml         # reviewed source of truth
    versions.yaml
  syntaxes/
    logrotate.tmLanguage.json          # generated where practical
    logrotate-state.tmLanguage.json
    logrotate-markdown.tmLanguage.json
  language-configuration.json
  snippets/
    logrotate.json
  scripts/
    generate-language-data.mjs
    check-upstream-drift.mjs
  test/
    corpus/
    grammar/
    integration/
    web/
  docs/
    architecture.md
    grammar.md
    contributing-language-data.md
  media/
  package.json
  package-lock.json
  tsconfig.base.json
  eslint.config.mjs
  esbuild.mjs
```

Use one lockfile and a pinned `packageManager` field. Package only bundled code,
grammars, language configuration, snippets, localization data, icon, license,
README, changelog, and notices. A VSIX content test must fail if sources,
fixtures, caches, or development dependencies leak into the package.

### 9.3 Runtime entries

Produce four independently bundled runtime entries:

- desktop extension client;
- browser extension client;
- Node language server;
- browser Worker language server.

Keep protocol messages and analysis deterministic between transports. The web
server receives file reads and directory listings through explicit client
requests implemented with `workspace.fs`; it must not fabricate a Node filesystem
inside a Worker. The same abstraction should be available to desktop tests.

### 9.4 Dependency baseline

The bootstrap should use current stable majors on implementation day and commit
exact resolutions. The registry snapshot on 2026-08-11 included TypeScript 7.0,
esbuild 0.28, ESLint 10, `@vscode/vsce` 3.9,
`vscode-languageclient`/`vscode-languageserver` 10.1,
`@vscode/test-electron` 3.1, and Node 24 LTS. Re-resolve patch releases when the
repository is scaffolded, because this document is not a lockfile.

Use a dependency update service, require passing CI, and group low-risk
development updates. Do not automatically merge LSP, compiler, bundler, or VS
Code engine-floor changes without package and integration tests.

## 10. Language model and parsing

### 10.1 Why a custom parser is appropriate

Tree-sitter is not required for version 1. Logrotate is compact and line-oriented,
but its states, quoting, included files, and opaque scripts make regular
expressions alone inadequate. A purpose-built incremental-friendly parser is
smaller, easier to align with `config.c`, easier to recover during editing, and
can retain every source token for safe formatting.

Do not transliterate `config.c` line-for-line. Specify observable grammar and
semantic behavior, use independently structured TypeScript, and validate it
against upstream tests.

### 10.2 Processing stages

1. Normalize line offsets without normalizing newline bytes.
2. Lex whitespace, line boundaries, braces, directive candidates, quoted text,
   escapes, comments in the correct context, and raw script regions.
3. Decode directive arguments using a popt-compatible token routine that retains
   raw spans and decoded values.
4. Build a lossless concrete syntax tree (CST), including comments, whitespace,
   malformed tokens, and missing-node placeholders.
5. Build a semantic model of global directives, stanzas, path patterns, scripts,
   and includes.
6. Apply directive-specific argument and interaction rules selected for the
   configured target logrotate version.
7. Resolve includes through a bounded filesystem abstraction when available.

Every diagnostic and edit must map back to original UTF-16 LSP positions without
re-lexing ad hoc substrings.

### 10.3 CST outline

```text
Document
  ├─ GlobalDirective
  ├─ IncludeDirective
  ├─ RotationBlock
  │    ├─ PathHeader
  │    │    └─ PathPattern+
  │    ├─ OpenBrace
  │    ├─ LocalDirective*
  │    ├─ ScriptBlock*
  │    │    ├─ ScriptStartDirective
  │    │    ├─ RawShellBody
  │    │    └─ EndScriptDirective
  │    └─ CloseBrace
  ├─ Comment
  └─ ErrorNode
```

The parser must recover at the next plausible line-level directive, brace, or
script terminator. It should diagnose an unfinished quote, block, or script but
continue to provide completion and folding for the rest of the document.

### 10.4 Directive registry

`data/directives.yaml` is reviewed code, not merely documentation. Each record
contains at least:

```yaml
- name: rotate
  category: retention
  scopes: [global, block]
  arguments:
    kind: integer
    minimum: -1
  since: "unknown-or-earliest-supported"
  deprecated: false
  related: [maxage, minage]
  documentation: "https://github.com/logrotate/logrotate/blob/.../logrotate.8.in"
  summary: "Retain count rotated logs; -1 prevents automatic removal."
```

A generator should emit:

- anchored TextMate directive-name patterns;
- completion and snippet tables;
- hover lookup data;
- semantic-token metadata;
- the directive reference used in contributor documentation.

Generated files carry a banner and are checked by `npm run check:generated`.
The source record still needs semantic review; generation prevents spelling
drift but cannot infer meaning.

### 10.5 Version model

Support these target modes:

- `latest` (default): the extension's newest reviewed upstream grammar;
- `auto`: use the safely detected local binary version only when external
  tooling is available and allowed, otherwise fall back to latest;
- a supported explicit version, beginning with `3.22` and later reviewed
  releases.

Every version-sensitive diagnostic should say which target caused it. Unknown
older syntax should be treated conservatively; do not claim a directive is
unsupported without registry evidence.

## 11. Syntax highlighting design

### 11.1 Scope policy

Use established TextMate scopes with the language suffix where appropriate:

| Element | Preferred scope |
| --- | --- |
| Directive | `keyword.control.directive.logrotate` |
| Deprecated directive | base directive scope; semantic `deprecated` modifier |
| Path or glob | `string.unquoted.path.logrotate` or quoted string scopes |
| Include path | `string.unquoted.path.include.logrotate` |
| Number | `constant.numeric.logrotate` |
| Size suffix | `keyword.other.unit.logrotate` |
| Mode | `constant.numeric.mode.logrotate` |
| User/group | `entity.name.user.logrotate`, `entity.name.group.logrotate` |
| Brace | `punctuation.section.block.*.logrotate` |
| Comment | `comment.line.number-sign.logrotate` |
| Script region | `meta.embedded.block.shell` with `source.shell` |
| Invalid syntax | `invalid.illegal.logrotate` only for high-confidence lexical errors |

Do not ship a color theme or hard-code foreground colors. Test the grammar under
VS Code Dark+, Light+, a high-contrast theme, and several popular third-party
themes as a visual smoke check. Accessibility depends primarily on standard
scope and semantic classifications, not bespoke colors
([VS Code accessibility](https://code.visualstudio.com/docs/configure/accessibility/accessibility)).

### 11.2 Structural rules

- Anchor directive recognition at a logical line start in global or block
  context. Do not color directive words that merely appear in paths or values.
- Treat `#` as a comment only in parser-valid comment positions. Do not use the
  common but incorrect `#.*$` rule everywhere.
- Make script begin/end rules own the whole embedded region.
- Keep header path patterns distinct from directive arguments.
- Ensure regexes are Oniguruma-compatible, bounded where possible, and protected
  by pathological-line tests.
- Keep state-file scopes and grammar separate from the configuration grammar.

TextMate cannot perfectly reproduce all parser state. When a tradeoff is needed,
prefer stable, non-misleading colorization; semantic tokens may refine parsed
documents later.

### 11.3 Language configuration

Configure `{`/`}` brackets and conservative indentation around stanza braces.
Do not declare a global line-comment toggle that inserts inline `#` after
selected content; VS Code's line-comment command should insert `#` at the first
non-whitespace position. Test comment toggling on directive, header, blank, and
script lines. Within embedded script content, shell behavior should prevail when
VS Code can provide it.

## 12. Language-server features

### 12.1 Diagnostics

Diagnostics are grouped and source-labeled so users understand their certainty.

**Lexical and structural errors**

- unknown or incorrectly cased directive, with edit-distance suggestion;
- malformed quote or escape;
- missing or unexpected brace;
- directive in an invalid global/block context;
- missing or unexpected `endscript`;
- tokens after an argument form that cannot accept them.

**Argument errors**

- invalid integer, range, size suffix, mode, day, interval, UID/GID, or arity;
- invalid `dateformat` conversion for the selected version;
- missing mail address, include path, command, extension, or path;
- invalid `tabooext`/`taboopat` list operator.

**High-confidence semantic warnings**

- `delaycompress` without compression;
- `dateformat`, `dateyesterday`, or `datehourago` without applicable date
  extension behavior;
- `create` being ineffective with an overriding copy behavior;
- conflicting `copy`, `copytruncate`, and `renamecopy` choices;
- `mailfirst`/`maillast` without mail configuration;
- `shredcycles` without shredding;
- deprecated and ignored `errors`;
- a directive known to be unavailable for the selected target version.

**Cross-file or environment-dependent observations**

- missing include target, cycle, depth beyond 16, unreadable resource, or
  ignored directory entry;
- paths whose resolution cannot be checked in a virtual or untrusted workspace;
- behavior depending on a compile-time feature or local account.

Environment-dependent findings should usually be information or hints, not red
errors. Legal last-one-wins configuration is not automatically an error; report
only likely mistakes and point to both definitions when shadowing is important.

Default diagnostics should be conservative and capped per document. Publish an
empty array when stale results are invalidated, tag unnecessary/deprecated
findings using standard LSP tags, debounce semantic analysis, and discard results
whose document version no longer matches.

### 12.2 Completion and snippets

Completion must be state-aware:

- global position: only globally valid and shared directives;
- stanza position: only locally valid and shared directives;
- script region: no logrotate directives except an appropriately positioned
  `endscript` aid;
- arguments: values appropriate to that directive, including enum-like choices,
  units, modes, booleans, and safe snippets;
- include/header: path completion through the client filesystem abstraction when
  supported.

Snippets should cover a minimal stanza, size-based rotation, time-based rotation,
compression, and script blocks. They must use placeholders and avoid pretending
that a distro-specific owner, group, or service command is universal.

### 12.3 Hover and signature help

Hover shows a concise summary, argument shape, valid scope, default when stable,
version/deprecation status, interaction notes, and an upstream manual link. Prose
must be independently written and short; do not reproduce GPL manual paragraphs
verbatim into a differently licensed artifact.

Signature help is useful for multi-argument directives such as `create`,
`createolddir`, and `su`. It should highlight the active argument based on the
decoded token spans, not whitespace counting.

### 12.4 Navigation, symbols, and folding

- Document symbols: one symbol per path stanza, nested script blocks, and useful
  include entries.
- Workspace symbols: loaded stanzas and included files only; never scan the whole
  workspace merely to populate symbols.
- Document links: include targets and documentation links where appropriate.
- Definition: include path to target file/directory; optionally trace an
  effective inherited directive to its definition.
- References: all loaded assignments of a selected directive or all include
  sites of a loaded file.
- Folding: stanzas, script bodies, and long multiline path headers.
- Selection ranges: token → directive → stanza → document, with embedded shell
  ranges kept intact.

### 12.5 Semantic tokens

Use only standard token types and modifiers unless a compelling interoperability
gap is proven. Good refinements include `keyword`, `string`, `number`, `operator`,
`comment`, `variable` or `parameter` for user/group positions, and `deprecated`.
Provide `semanticTokenScopes` mappings so themes without explicit semantic rules
fall back to appropriate TextMate scopes.

Semantic tokens must not recolor entire lines or compete with the shell grammar.
Support full and delta results only after measurements show delta correctness and
value; correctness is more important than protocol cleverness.

### 12.6 Code actions

Safe initial code actions:

- replace an unknown directive with a uniquely close known spelling;
- add a missing closing brace or `endscript` at an unambiguous insertion point;
- quote a path that contains whitespace;
- enable the paired prerequisite for a high-confidence warning;
- open the upstream documentation for a diagnostic.

Do not offer bulk reordering, automatic account substitution, recursive include
creation, or executable-script fixes. Preferred and disabled code-action states
must clearly communicate applicability.

## 13. Formatting

### 13.1 Formatter principles

Unlike Caddy, logrotate has no canonical formatter command that should be invoked
as an extension prerequisite. Implement formatting over the lossless CST.

The formatter may:

- normalize indentation of logrotate directives and braces;
- normalize safe spacing between a directive and its arguments;
- preserve deliberate blank lines and comments;
- optionally wrap a long stanza header only at parsed path boundaries;
- format only the requested range when that range aligns with complete syntax
  nodes.

The formatter must not:

- reorder directives, because order and inheritance can matter;
- normalize quotes or escapes without proof of decoded-value equivalence;
- change case, units, numeric base, modes, usernames, groups, or glob text;
- move comments;
- modify the raw shell-body span at all;
- format a tree with an ambiguity that makes preservation uncertain.

On an unsafe or severely malformed region, return no edit and optionally expose
a trace-level explanation; do not pop a warning notification on routine format.

### 13.2 Formatter correctness tests

Every formatter test must assert:

1. parse before and after;
2. semantic equivalence of all understood nodes;
3. byte-for-byte identity of every raw script body;
4. idempotence after one formatting pass;
5. non-overlapping, minimal LSP edits;
6. newline-style preservation.

Property tests should vary quoting, whitespace, comments, header line breaks, and
malformed endings. The upstream corpus supplies real-world edge cases but does
not replace dedicated formatting tests.

## 14. Include graph and filesystem behavior

Resolve includes lazily from open or directly referenced documents. Mirror
upstream semantics that are observable without executing rotation:

- relative/tilde behavior only when supported and clearly identified;
- alphabetic directory ordering;
- taboo pattern filtering;
- non-regular entry filtering where resource metadata is available;
- inline order and inherited option snapshots;
- maximum depth 16;
- cycle detection using normalized resource identifiers.

Impose resource limits, initially configurable only as internal constants:

- no unprompted whole-workspace scan;
- maximum files per root analysis;
- maximum bytes per file and total graph;
- cancellation between directory entries and parse stages;
- cache keyed by URI, version/mtime/etag, target version, and inherited state;
- invalidation when an open document changes or a watched loaded resource
  changes.

Avoid broad file watchers. Watch only currently loaded local include resources
when the host supports it. In web/virtual workspaces, rely on open-document
events, `workspace.fs`, and explicit refresh where providers cannot watch.

## 15. Settings and commands

Keep public configuration small and stable:

| Setting | Default | Scope | Purpose |
| --- | --- | --- | --- |
| `logrotate.validation.enable` | `true` | resource | Internal parser/semantic diagnostics |
| `logrotate.validation.maxProblems` | `100` | resource | Bound noisy malformed files |
| `logrotate.targetVersion` | `latest` | resource | Version-aware syntax and hover |
| `logrotate.externalValidation.mode` | `off` | resource | `off` or explicitly `onSave` |
| `logrotate.executablePath` | `logrotate` | machine-overridable | Trusted desktop tool path |
| `logrotate.trace.server` | `off` | window | Explicit LSP protocol trace detail for troubleshooting |

Mark the executable and external-validation settings as restricted. Validate
types and ranges in the manifest and explain limitations in setting descriptions.
Do not add custom file-association settings; VS Code already owns that feature.

Commands:

- `Logrotate: Validate Current File with Installed Logrotate`
- `Logrotate: Restart Language Server`
- `Logrotate: Show Language Server Output`
- `Logrotate: Open Directive Documentation`

The external validation command should explain why it is unavailable when the
document is unsaved, virtual, untrusted, or running in a browser. The default
Info output should record client/server startup, initialization, analyzed URI
and version, diagnostic and include counts, configuration changes, restart,
close, and failures. It must sanitize control characters, cap fields, and never
write document contents. Explicit protocol tracing can contain document
contents and must be described as a temporary troubleshooting mode.

## 16. Security, privacy, and trust

### 16.1 Threat model

Configuration content and include graphs are untrusted input. Threats include
catastrophic regex backtracking, huge files, include cycles, path traversal
outside the workspace, crafted output from a substituted executable, process
hangs, command injection, and accidental logging of sensitive paths or script
content.

Mitigations:

- bounds and cancellation in lexer, parser, graph, output, and formatting paths;
- fuzzing and pathological-regex tests;
- no `eval`, shell command construction, or execution of embedded scripts;
- spawn an explicit executable with explicit arguments and `shell: false`;
- runtime trust check immediately before process creation, not only a UI
  `when` clause;
- no automatic download of logrotate or other binaries;
- no following includes merely to provide colorization;
- omit document text from default logs, cap logged fields, neutralize control
  characters, and disclose that explicit protocol traces can contain content;
- dispose clients, output channels, watchers, and processes on deactivation;
- pin CI actions by full commit SHA and grant minimum job permissions.

GitHub recommends full-length action pins and least-privilege workflow tokens
([secure use of GitHub Actions](https://docs.github.com/en/actions/reference/security/secure-use)).

### 16.2 Privacy

Version 1 has no telemetry and no runtime network requests. Documentation links
open only after a user gesture. If telemetry is ever proposed, it requires a
separate design review, data inventory, `telemetry.json`, central VS Code
telemetry controls, and a no-content/no-path policy
([extension telemetry guidance](https://code.visualstudio.com/api/extension-guides/telemetry)).

## 17. Performance and reliability budgets

Budgets are measured on supported CI hardware and tracked over time:

| Operation | Initial target |
| --- | --- |
| TextMate highlighting | No extension activation; no catastrophic-regex cases |
| Client activation to ready | p95 under 150 ms excluding first server process startup |
| Parse 10,000-line document | p95 under 20 ms in the pure core benchmark |
| First internal diagnostics | under 300 ms after document settles |
| Incremental reanalysis | under 50 ms p95 for a local single-line edit |
| Completion response | under 100 ms p95 from warm server |
| Formatter | under 200 ms for 10,000 lines |
| Include graph | bounded and cancellable; never blocks syntax coloring |

These are engineering guardrails, not Marketplace marketing claims until measured.
Use debouncing for diagnostics, cancellation for superseded work, document
versions for result freshness, and parse/cache reuse. A performance regression
test should include very long path headers, quotes, thousands of directives,
deep includes, and shell bodies containing brace- and keyword-like text.

## 18. Test strategy

### 18.1 Pure core tests

- lexer token/span and UTF-16 position tests;
- popt-compatible quote/escape table tests;
- valid, invalid, and incomplete CST golden tests;
- directive argument/range/scope tests for every registry record;
- effective-setting and inline-include-order tests;
- state format versions 1 and 2;
- property and fuzz tests asserting termination and source-span invariants;
- parser differential tests against accepted/rejected upstream fixtures where
  the external binary is available.

### 18.2 Grammar tests

Use `vscode-textmate` with `vscode-oniguruma` to assert scopes at exact character
positions. Snapshot tests alone are not sufficient. Cover:

- all directive names in global and local contexts;
- the same words in paths, values, comments, and shell bodies;
- quoting and `#` context differences;
- multiline headers;
- every script starter and terminator;
- Markdown fences and closing boundaries;
- state headers and records;
- long malicious lines and regex timeout budgets.

### 18.3 LSP tests

Run the server against an in-memory transport and filesystem abstraction. Test
initialization capabilities, synchronization, diagnostics lifecycle,
cancellation, completion contexts, hover, symbols, folding, selection, links,
semantic full/delta behavior if enabled, code actions, and formatting edits.
Execute the same behavior suite against Node and browser bundles where feasible.

### 18.4 Integration matrix

Desktop integration uses the official VS Code test tooling on:

- Linux, Windows, and macOS for the declared engine floor;
- current stable VS Code;
- Insiders as allowed-to-fail early warning, promoted to required before a
  release if it exposes an imminent break.

Browser integration uses `@vscode/test-web` in Chromium and verifies syntax,
language-server startup, virtual filesystem reads, trust limitations, and absence
of Node built-ins. Add targeted SSH/dev-container smoke tests when the project has
infrastructure, because `extensionKind` and executable locality matter remotely.

### 18.5 Upstream compatibility jobs

- Required PR job: pinned known logrotate revision.
- Scheduled job: upstream `main`, reporting newly accepted directives,
  `dateformat` conversions, parser branches, manual sections, and changed test
  expectations.
- Release job: supported stable logrotate binaries on Linux, exercising only
  `--debug` validation, never rotation.

A drift report should open an issue or produce an artifact; it must not silently
rewrite reviewed language data.

### 18.6 Package tests

- Build from a clean checkout.
- Run `vsce ls` and compare to an allowlisted package manifest.
- Produce the VSIX once, calculate its checksum, and install that exact artifact
  into a clean VS Code test instance.
- Assert bundle and total VSIX size budgets.
- Scan for secrets, source maps containing private paths, unexpected licenses,
  native binaries, development fixtures, and duplicate dependency copies.
- Smoke-test offline installation and first activation.

## 19. Build, CI, and release

### 19.1 Local scripts

Expose conventional commands:

```text
npm ci
npm run generate
npm run check:generated
npm run lint
npm run typecheck
npm test
npm run test:grammar
npm run test:integration
npm run test:web
npm run build
npm run package
```

Use strict TypeScript settings, including strict null checks, no unchecked
indexed access, and exact optional-property behavior where ecosystem typings
permit. ESLint uses flat configuration. Formatting enforcement should be
mechanical and separate from semantic linting.

### 19.2 Pull-request CI

Run generated-file verification, lint, typecheck, pure tests, grammar tests, LSP
tests, bundle checks, license/security checks, and VSIX package smoke tests.
Parallelize independent jobs but make the package job consume outputs proven by
the same commit. Use dependency review and CodeQL where supported.

All actions are pinned to full SHAs, workflow permissions start at read-only, and
publishing permissions exist only in the release workflow. Dependabot or
Renovate updates actions and npm dependencies through reviewed pull requests.

### 19.3 Release flow

1. Require a clean protected tag that matches `package.json` and changelog.
2. Re-run required CI and build a single VSIX in a protected environment.
3. Generate checksum, SPDX or CycloneDX SBOM, provenance/attestation, and release
   notes.
4. Publish the same bytes to the VS Code Marketplace using the `VSCE_PAT`
   repository or protected-environment secret.
5. Attach the VSIX, checksum, SBOM, and provenance to the GitHub release.
6. Verify Marketplace installation before announcing the release.

GitHub artifact attestations can establish build provenance and should accompany
the release artifact
([artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations)).

Maintain stable and pre-release channels. Pre-releases are appropriate for new
parser/formatter behavior; stable upgrades must not silently enable external
process execution.

## 20. Documentation and maintenance

Ship and maintain:

- `README.md`: scope, features, associations, screenshots, Restricted Mode/web
  limitations, settings, commands, and troubleshooting;
- `CHANGELOG.md`: Keep a Changelog structure with Semantic Versioning;
- `CONTRIBUTING.md`: reproducible setup, generation, test tiers, directive-data
  review, and upstream drift workflow;
- `SECURITY.md`: private vulnerability reporting and support window;
- `SUPPORT.md`, code of conduct, license, and third-party notices;
- architecture and grammar notes explaining parser differences from generic
  key/value syntax;
- localization metadata for manifest strings and user-facing commands/settings.

Hovers and diagnostics should use plain language and include stable help codes.
The README should be explicit that internal validation models reviewed logrotate
versions, while the optional installed-binary check reflects one host.

## 21. Delivery plan

### Phase 0: specification and project bootstrap

- Confirm public repository ownership, the `willibrandon` Marketplace publisher,
  and the independently authored MIT licensing boundary.
- Scaffold npm workspaces, strict TypeScript, bundle entries, CI, and package
  allowlist.
- Pin an upstream logrotate compatibility revision.
- Write the grammar/CST specification and directive registry.

Exit criteria: clean installation of an empty desktop/web extension, generated
data reproducibility, and protected CI/release skeleton.

### Phase 1: dependable colorization

- Configuration and state language contributions.
- Narrow file associations and language configuration.
- TextMate grammar, embedded shell blocks, and Markdown injection.
- Scope-level grammar corpus and theme/accessibility smoke checks.
- Initial README and association guidance.

Exit criteria: every reviewed upstream fixture opens without grammar failure;
tokens are structurally correct in positive and negative scope tests; no
TypeScript activation is required for colorization.

### Phase 2: core parser and essential LSP

- Lossless lexer/CST, directive registry, recovery, and version model.
- Diagnostics, completion, hover, symbols, folding, selection ranges, and links.
- Desktop and browser LSP transports.
- Pinned upstream conformance and fuzz tests.

Exit criteria: feature parity across desktop and browser for in-document
analysis, bounded performance, and no known parser divergence on the classified
upstream corpus.

### Phase 3: safe editing and cross-file intelligence

- Lossless formatter and format tests.
- Include graph over the filesystem bridge.
- Definitions/references and cross-file diagnostics.
- Semantic tokens and safe code actions.
- Trust-gated, opt-in installed-binary validation.

Exit criteria: formatter preservation/idempotence gates, virtual/trust tests,
include resource limits, and external-process security review.

### Phase 4: release hardening and 1.0

- Full OS/editor matrix, remote smoke tests, package audit, SBOM/provenance.
- Documentation, accessibility, localization readiness, and performance report.
- Marketplace pre-release, feedback triage, then stable 1.0.

Exit criteria: no critical/high defects, supported-version table published,
reproducible attested VSIX, and a documented maintenance owner.

## 22. Acceptance criteria for 1.0

The extension is ready for 1.0 only when all of the following are true:

- Syntax colorization works before activation and uses standard scopes without a
  bundled color theme.
- All 69 reviewed syntax words are represented by the registry and drift check.
- Configuration, script bodies, state files, and Markdown fences have dedicated
  scope tests.
- The parser is lossless, error-tolerant, cancelable, and classified against the
  pinned upstream corpus.
- Desktop, web, trusted, untrusted, local, remote, and virtual capabilities match
  the manifest's claims.
- Formatting is idempotent and preserves shell-body bytes, comments, quote
  semantics, newline style, and directive order.
- External validation is off by default, never shell-mediated, and impossible in
  Restricted Mode or a browser.
- There is no startup scan, forced language reassignment, automatic download,
  telemetry, runtime network call, sidebar, or routine notification.
- CI tests the declared VS Code floor, stable, web, all three desktop operating
  systems, grammar scopes, package contents, and dependency/security policy.
- The Marketplace and GitHub release artifact is the same tested, checksummed,
  attested VSIX.

## 23. Risks and explicit decisions

| Risk | Decision or mitigation |
| --- | --- |
| Editor parser diverges from C parser | Pinned corpus, scheduled upstream drift, versioned registry, optional host validation |
| TextMate cannot express exact comment/header state | Conservative structural scopes; semantic refinement; scope tests |
| Formatter damages shell or ordering semantics | Lossless CST, opaque byte-preserved shell spans, no reordering, equivalence/idempotence gates |
| Include analysis becomes slow or invasive | Lazy bounded graph, no workspace scan, cancellation, loaded-resource watches only |
| A malicious workspace substitutes an executable | Off by default, machine setting, trust gate, no shell, runtime recheck, timeout/output bounds |
| Browser and desktop behavior drift | Shared core/server handlers and transport parity tests |
| Static directive list rots | Single registry, generated consumers, source drift automation |
| Broad file recognition conflicts with other extensions | Exact/narrow associations and user-owned `files.associations`; no forced reassignment |
| Licensing contaminates the MIT VSIX | Independently authored implementation and docs; upstream remains a checkout-only CI oracle |
| Tooling snapshot becomes stale | Lockfile, scheduled dependency PRs, release-time current-major review, engine-floor testing |

## 24. Final recommendation

Proceed with the modernized Caddyfile approach. It is the right conceptual model
for a language extension that must provide both immediate colorization and deep,
portable language intelligence. The winning design is not a grammar-only clone
and not a literal fork of `vscode-caddyfile`: it is a TextMate-first extension
backed by a tested, shared logrotate language core and dual desktop/web LSP
servers.

Name the project **Logrotate**, keep its extension ID predictable, make internal
analysis work everywhere, keep host execution explicitly optional, and treat the
upstream C parser and fixture corpus as the compatibility authority.

## 25. Primary references

- [VS Code 1.132 release notes](https://code.visualstudio.com/updates/v1_132)
- [Language extensions overview](https://code.visualstudio.com/api/language-extensions/overview)
- [Syntax highlighting guide](https://code.visualstudio.com/api/language-extensions/syntax-highlight-guide)
- [Semantic highlighting guide](https://code.visualstudio.com/api/language-extensions/semantic-highlight-guide)
- [Language server extension guide](https://code.visualstudio.com/api/language-extensions/language-server-extension-guide)
- [Contribution points reference](https://code.visualstudio.com/api/references/contribution-points)
- [Extension manifest reference](https://code.visualstudio.com/api/references/extension-manifest)
- [Web extension guide](https://code.visualstudio.com/api/extension-guides/web-extensions)
- [Virtual workspace guide](https://code.visualstudio.com/api/extension-guides/virtual-workspaces)
- [Workspace trust guide](https://code.visualstudio.com/api/extension-guides/workspace-trust)
- [Bundling extensions](https://code.visualstudio.com/api/working-with-extensions/bundling-extension)
- [Testing extensions](https://code.visualstudio.com/api/working-with-extensions/testing-extension)
- [Publishing extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Official VS Code extension samples](https://github.com/microsoft/vscode-extension-samples)
- [VSCE repository](https://github.com/microsoft/vscode-vsce)
- [Node.js release schedule](https://nodejs.org/en/about/previous-releases)
- [Secure use of GitHub Actions](https://docs.github.com/en/actions/reference/security/secure-use)
- [GitHub artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations)
- [Logrotate source repository](https://github.com/logrotate/logrotate)
- [vscode-caddyfile reviewed comparison](https://github.com/caddyserver/vscode-caddyfile/tree/9ba30fc)
- [vscode-systemd-unit-file reviewed comparison](https://github.com/bearmini/vscode-systemd-unit-file/tree/0dfc69c)
