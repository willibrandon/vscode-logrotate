#!/usr/bin/env bash

set -euo pipefail

readonly install_directory="${1:?usage: install-picket.sh <install-directory>}"
readonly version="0.2.9"
readonly archive="picket-v${version}-linux-x64.tar.gz"
readonly expected_sha256="af7f2cd7605d36e469223007bde5a91653de50bb65af0bc95ac85b7b41c28f7a"
readonly download_url="https://github.com/willibrandon/picket/releases/download/v${version}/${archive}"

mkdir -p "$install_directory"
curl --fail --location --proto '=https' --tlsv1.2 "$download_url" \
  --output "$install_directory/$archive"
printf '%s  %s\n' "$expected_sha256" "$install_directory/$archive" | sha256sum --check --strict
tar --extract --gzip --file "$install_directory/$archive" --directory "$install_directory"
test -x "$install_directory/picket"
