# Development container

This directory defines the reproducible Debian development environment for the repository. The
container installs the pinned Node.js and npm versions, Chromium, logrotate, Python virtual
environment support, Xvfb, and a Docker client connected to the host engine.

Start it with Visual Studio Code's **Dev Containers: Reopen in Container** command or from the
repository root:

```sh
devcontainer up --workspace-folder . --frozen-lockfile
```

Node.js and npm are already pinned and active. Do not run `nvm` in the container. Run the normal
development workflow inside the container:

```sh
node --version
npm --version
npm ci
npm run verify
```

The version commands must report `v24.19.0` and `12.0.2`.

Use the current Visual Studio Code Dev Containers extension or Dev Container CLI 0.80.3 or later.
Older clients generate an invalid empty base-image argument before they build the repository
Dockerfile.

Run the same complete check used by the container workflow:

```sh
devcontainer exec --workspace-folder . bash .devcontainer/verify.sh
```

This validates the pinned upstream source and installed logrotate binary, runs repository
verification, desktop and web editor tests, packaged extension tests, the Remote SSH test, theme
capture, and the documentation build. Theme images produced during this check are written to
temporary container storage.

Named volumes hold dependencies, generated files, test editor downloads, coverage, the reviewed
logrotate source corpus, and caches. They are keyed by the Dev Container identity, so Linux
container output does not overwrite files produced by a Windows or Linux host checkout.

The container is unprivileged and uses the non-root `vscode` user. It does mount the host Docker
socket for Remote SSH tests. Treat access to the container as administrative access to that Docker
host and review lifecycle script changes before rebuilding.

The Debian base, Node.js toolchain, and Docker CLI images are pinned by digest in the Dockerfile.
Dependabot reviews available image updates.

CI scans the repository and the complete image with Picket. The repository `.picketignore` contains
exact fingerprints for reviewed upstream image false positives; new signatures remain reportable.

See [Development container](../docs/development-container.md) for the full setup and isolation
details.
