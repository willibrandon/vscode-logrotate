# Security Policy

## Supported versions

Before the first public release, only the current `main` branch receives security fixes. After a
stable release, the latest stable line and any explicitly listed maintained pre-release line are
supported. This table is updated as releases are made.

| Version                 | Supported           |
| ----------------------- | ------------------- |
| `main`                  | Yes                 |
| `<1.0` published builds | No public build yet |

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability
reporting form at `https://github.com/willibrandon/vscode-logrotate/security/advisories/new`.
Include affected versions, impact, reproduction steps, and any suggested mitigation. Do not include
real configuration files, usernames, paths, tokens, or other sensitive data unless essential and
explicitly redacted.

Maintainers should acknowledge a report within seven days, keep the reporter informed, and
coordinate disclosure after a fix is available. Private vulnerability reporting must be enabled and
tested before the first public release.

## Security model

- Configuration text and include resources are treated as untrusted input.
- Syntax highlighting never follows includes or activates the extension.
- Include analysis uses the editor filesystem API with depth, file-count, byte, UTF-8, cycle, and
  cancellation limits; it never scans the workspace.
- External validation is off by default and requires a saved local file, a desktop host, and a
  trusted workspace. It invokes an explicit executable and argument vector without a shell, bounds
  time and output, and rechecks trust immediately before process creation.
- The extension never executes logrotate script bodies and has no telemetry or background network
  requests.
- Release dependencies are locked, registry signatures are checked, workflows use immutable action
  commits and least-privilege permissions, and released artifacts include checksums, an SBOM, and
  provenance.

See [docs/security.md](docs/security.md) for maintainer review details.
