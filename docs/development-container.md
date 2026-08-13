# Development container

The repository includes a development container for Visual Studio Code and the Dev Container CLI. It
provides the pinned Node.js and npm toolchain, Chromium, logrotate, Python virtual environments,
Xvfb, and access to the host Docker engine for the Remote SSH smoke test.

## Start the container

Start Docker, open the repository in Visual Studio Code, and run **Dev Containers: Rebuild and
Reopen in Container**. Container creation installs both npm lockfiles before the editor connects.
Node.js and npm are already pinned and active, so do not run `nvm` in the container.

In the container, verify the toolchain and normal development workflow:

```sh
node --version
npm --version
npm ci
npm run verify
```

The version commands must report `v24.19.0` and `12.0.2`.

The same environment can be started from a terminal:

```sh
devcontainer up --workspace-folder . --frozen-lockfile
devcontainer exec --workspace-folder . bash .devcontainer/verify.sh
```

Use the current Visual Studio Code Dev Containers extension or Dev Container CLI 0.80.3 or later.
Older clients generate an invalid empty base-image argument before they build the repository
Dockerfile.

The verification command checks the installed tools and mounts, validates the pinned upstream source
and installed logrotate binary, runs repository verification, exercises desktop, web, packaged, and
Remote SSH extension hosts, captures every theme in temporary container storage, and builds the
documentation site. All corpus tests run against the logrotate checkout prepared when the container
is created.

## Isolated output

The source checkout remains a bind mount so edits and commits behave normally. Platform-specific
dependencies and generated output use named volumes keyed by the Dev Container identity. Separate
worktrees therefore do not share these volumes.

The isolated paths include both `node_modules` trees, extension bundles, coverage, TypeScript
output, Astro output, npm cache data, the reviewed logrotate source corpus, and downloaded Visual
Studio Code and Playwright test installations. Running Linux builds in the container does not
replace Windows dependencies or leave Linux output in a Windows worktree.

## Docker access

The container uses the host Docker socket for the Remote SSH smoke test. Access to that socket is
equivalent to administrative access to the Docker host. Open the container only for trusted source
and review changes to lifecycle scripts before rebuilding it.

The container is not privileged, runs editor and lifecycle commands as the non-root `vscode` user,
and pins its Debian base, Node.js toolchain, and Docker CLI images by digest. Dependabot tracks
those images, GitHub Actions, and npm dependencies.

CI scans the complete repository with the Picket GitHub Action, builds the container, runs its
verification script, and scans the built Docker image with a checksum-verified Picket release
binary. The image scan runs for changes, weekly, and on request. Its redacted SARIF report is
retained as a workflow artifact, and the job fails on findings. `.picketignore` contains only exact
fingerprints for reviewed false positives in upstream image content. It does not exclude paths,
rules, or complete files.
