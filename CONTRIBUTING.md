# Contributing

Thank you for helping make logrotate configuration editing safer. Security reports belong in the
private channel described in [SECURITY.md](SECURITY.md), not a public issue.

## Development setup

The recommended setup is the repository's reproducible development container. Start Docker, open the
repository in Visual Studio Code, and run **Dev Containers: Rebuild and Reopen in Container**. The
container already provides the pinned Node.js and npm versions; do not run `nvm` inside it. Run
`npm run verify` while iterating and `bash .devcontainer/verify.sh` before submitting a change.
Dependencies and generated output stay on container-managed volumes, so Linux and Windows worktrees
do not overwrite one another. See [docs/development-container.md](docs/development-container.md) for
CLI usage and the Docker socket security boundary.

For development directly on the host, use Node.js 24 LTS and the npm version pinned by
`packageManager`. On Debian, the host integration tools are available as system packages:

```sh
sudo apt-get update
sudo apt-get install --yes chromium logrotate python3-venv xvfb
nvm install
nvm use
npm ci
npm --prefix docs-site ci
npm run verify
```

The lockfile is authoritative. Do not use floating dependency ranges, bypass npm's lifecycle-script
allowlist, or commit `dist`, editor test downloads, coverage output, VSIX files, or credentials.

## Change workflow

1. Add or update focused tests before changing observable behavior.
2. Keep `packages/language-core` free of Node, DOM, and VS Code imports.
3. Preserve source spans, newline style, directive order, comments, quoting, and script-body bytes.
4. Keep include traversal lazy, bounded, cancellable, and limited to referenced resources.
5. Run the smallest relevant suite while iterating, then run `npm run verify`.
6. Run `npm run test:integration` for desktop-client changes and `npm run test:web` for browser or
   filesystem-bridge changes.
7. Run `npm run test:remote` for extension-host placement or installed-tool locality changes. It
   requires Docker, OpenSSH, and the packaged VSIX.
8. Make a focused commit only after the relevant gates pass.

Useful commands are listed in [README.md](README.md). The architecture and host boundaries are
documented in [docs/architecture.md](docs/architecture.md).

## Changing language data

`data/directives.yaml` and `data/versions.yaml` are the reviewed sources of truth. Directive changes
must cite an upstream parser or manual location, state valid scopes and arity, include independently
written prose and examples, and update version metadata when needed.

```sh
npm run generate
npm run check:generated
npm run test:grammar
npm run test:core
npm run check:upstream
```

Commit the source data and every generated consumer together. Do not copy upstream manual prose or
fixtures into this repository. Upstream GPL material remains a separate, checkout-only test input.
The review checklist is in [docs/grammar.md](docs/grammar.md).

## Pull requests

Keep pull requests narrow and explain user-visible behavior, security implications, tests run, and
generated changes. CI must be green. Dependency and workflow changes require reviewing release
notes, licenses, lifecycle scripts, immutable action pins, and `npm audit signatures` output.

Contributions are licensed under the MIT License, the repository's license.
