# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use semantic versioning.

## [Unreleased]

## [0.1.8] - 2026-08-12

### Fixed

- Strong first-line content detection restores Logrotate when an already-open configuration has a
  competing language association, including generic `.conf` files.
- Included-file matching is case-insensitive on native Windows, and diagnostics refresh after VS
  Code assigns the Logrotate language.
- Desktop integration waits for a new diagnostic event in the active included editor. A workbench
  smoke test opens `included.conf` directly, forces a competing language, and verifies the visible
  LR1001 squiggle without navigation.

## [0.1.7] - 2026-08-12

### Fixed

- Marketplace release verification now waits for service validation and retries only transient
  installation-feed propagation failures.
- Native Windows verification uses Git for Windows Bash for workflow syntax checks and expects the
  platform's `NUL` device during installed-validator tests.
- Files resolved through `include` are assigned the Logrotate language when opened.
- Native process-tree coverage is deterministic across Windows and Unix, successful web tests now
  end with an explicit confirmation, and `npm run test:vsix` builds its required package first.
- The Remote SSH smoke test supports native Windows with Docker Desktop's Linux engine and uses
  host-specific VS Code launch and OpenSSH behavior.

## [0.1.6] - 2026-08-12

### Added

- Initial logrotate configuration and state-file language support.
- Generated TextMate grammars, snippets, and directive reference for 69 reviewed directives.
- Shared lossless parser, diagnostics, formatter, include analysis, and Node/Web language server.
- Desktop, remote, virtual-workspace, Restricted Mode, and browser Worker support.
- Optional trust-gated validation with an installed `logrotate --debug` process.
- A reviewed Marketplace icon and structured, content-safe language server output logging.
- Cross-analysis include caching and narrow loaded-resource refresh watchers.
- Trust-gated local version detection for the `auto` target with a safe reviewed-version fallback.
- Safe quick fixes for spelling, prerequisites, missing terminators, and explicitly selected paths,
  with pinned upstream documentation actions for diagnostics.
- Unit, property, grammar, JSON-RPC contract, performance, desktop, web, and package tests.

### Fixed

- Build host validation against the pinned logrotate 3.22.0 release with its version tag available.
- Release verification excludes checked-out upstream source trees from repository formatting.
- The 20 ms parser gate now rejects regressions across five independent sample windows instead of
  failing a release because of one contended shared-runner window.
- Release metadata is recorded with shell-safe command substitution before attestation and
  publishing.
- Reproducible CycloneDX output includes a deterministic RFC 4122 serial number accepted by GitHub
  SBOM attestation.
- Provenance and SBOM attestation bundles use distinct release asset names.

## [0.1.5] - 2026-08-12

No artifacts were published. Release automation stopped while assembling the draft GitHub release;
the partial draft was removed before Marketplace publishing.

## [0.1.4] - 2026-08-12

No artifacts were published. Release automation stopped during SBOM attestation, before release
creation or Marketplace publishing.

## [0.1.3] - 2026-08-12

No artifacts were published. Release automation stopped after publisher verification and artifact
building, before attestation or publishing.

## [0.1.2] - 2026-08-12

No artifacts were published. Release verification stopped before publisher access or artifact
creation.

## [0.1.1] - 2026-08-12

No artifacts were published. Release verification stopped before publisher access or artifact
creation.

## [0.1.0] - 2026-08-12

No artifacts were published. Release validation stopped before publisher access or artifact
creation.

[Unreleased]: https://github.com/willibrandon/vscode-logrotate/compare/v0.1.8...HEAD
[0.1.8]: https://github.com/willibrandon/vscode-logrotate/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/willibrandon/vscode-logrotate/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/willibrandon/vscode-logrotate/releases/tag/v0.1.6
[0.1.5]: https://github.com/willibrandon/vscode-logrotate/releases/tag/v0.1.5
[0.1.4]: https://github.com/willibrandon/vscode-logrotate/releases/tag/v0.1.4
[0.1.3]: https://github.com/willibrandon/vscode-logrotate/releases/tag/v0.1.3
[0.1.2]: https://github.com/willibrandon/vscode-logrotate/releases/tag/v0.1.2
[0.1.1]: https://github.com/willibrandon/vscode-logrotate/releases/tag/v0.1.1
[0.1.0]: https://github.com/willibrandon/vscode-logrotate/releases/tag/v0.1.0
