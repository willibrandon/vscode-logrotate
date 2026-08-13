#!/usr/bin/env bash

set -euo pipefail

readonly workspace_root="$(git rev-parse --show-toplevel)"
readonly expected_mounts=(
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

test "$(node --version)" = "v24.19.0"
test "$(npm --version)" = "12.0.2"
test "$(node -p 'process.platform')" = "linux"
command -v chromium >/dev/null
command -v logrotate >/dev/null
command -v python3 >/dev/null
command -v xvfb-run >/dev/null
command -v xauth >/dev/null
command -v jq >/dev/null
command -v docker >/dev/null

for directory in "${expected_mounts[@]}"; do
  mountpoint --quiet "$directory"
done

test -S /var/run/docker-host.sock
test "$(git -C "$LOGROTATE_SOURCE" rev-parse HEAD)" = "3be1e9ccffe0c2245ed596183c74913d553f9f18"

readonly temporary_root="$(mktemp -d)"
readonly virtual_environment="$temporary_root/python"
readonly theme_output="$temporary_root/themes"
trap 'rm -rf -- "$temporary_root"' EXIT
python3 -m venv "$virtual_environment"
"$virtual_environment/bin/python" --version

docker version
npm run check:upstream
npm run test:installed-logrotate
npm run verify
npm run test:integration
npm run test:web
npm run package
npm run test:vsix:prepared
npm run test:remote:prepared
LOGROTATE_THEME_OUTPUT_DIR="$theme_output" npm run capture:themes
npm --prefix docs-site run build
