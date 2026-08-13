#!/usr/bin/env bash

set -euo pipefail

readonly install_directory="${1:?usage: install-picket.sh <install-directory>}"
readonly version="0.2.11"
readonly archive="picket-v${version}-linux-x64.tar.gz"
readonly expected_sha256="c1d694a56c2eb7844b0145ac31696952c7cf31198ff26b7cf50eb2a3131c3b54"
readonly download_url="https://github.com/willibrandon/picket/releases/download/v${version}/${archive}"

mkdir -p "$install_directory"
curl --fail --location --proto '=https' --tlsv1.2 "$download_url" \
  --output "$install_directory/$archive"
printf '%s  %s\n' "$expected_sha256" "$install_directory/$archive" | sha256sum --check --strict
tar --extract --gzip --file "$install_directory/$archive" --directory "$install_directory"
test -x "$install_directory/picket"
