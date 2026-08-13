#!/usr/bin/env bash

set -euo pipefail

readonly workspace_root="$(pwd -P)"
readonly owner="$(id -u):$(id -g)"
readonly upstream_root="/home/vscode/.cache/vscode-logrotate/upstream"
readonly upstream_revision="3be1e9ccffe0c2245ed596183c74913d553f9f18"
readonly isolated_directories=(
  "$workspace_root/node_modules"
  "$workspace_root/dist"
  "$workspace_root/coverage"
  "$workspace_root/.vscode-test"
  "$workspace_root/.vscode-test-web"
  "$workspace_root/packages/language-core/lib"
  "$workspace_root/packages/language-server/lib"
  "$workspace_root/packages/vscode-client/lib"
  "$workspace_root/docs-site/node_modules"
  "$workspace_root/docs-site/dist"
  "$workspace_root/docs-site/.astro"
  "/home/vscode/.npm"
  "/home/vscode/.cache"
)

for directory in "${isolated_directories[@]}"; do
  sudo chown "$owner" "$directory"
done

mkdir -p "$upstream_root" /home/vscode/.cache/ms-playwright

if [[ "$(git -C "$upstream_root" rev-parse HEAD 2>/dev/null || true)" != "$upstream_revision" ]]; then
  find "$upstream_root" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
  git -C "$upstream_root" init --quiet
  git -C "$upstream_root" remote add origin https://github.com/logrotate/logrotate.git
  git -C "$upstream_root" fetch --depth 1 --no-tags origin "$upstream_revision"
  git -C "$upstream_root" checkout --detach --force FETCH_HEAD
fi

test "$(git -C "$upstream_root" rev-parse HEAD)" = "$upstream_revision"

npm ci
npm --prefix docs-site ci

node --version
npm --version
chromium --version
logrotate --version
