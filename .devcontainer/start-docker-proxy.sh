#!/usr/bin/env bash

set -euo pipefail

readonly source_socket="/var/run/docker-host.sock"
readonly target_socket="/var/run/docker.sock"
readonly pid_file="/tmp/vscode-logrotate-docker-proxy.pid"
readonly log_file="/tmp/vscode-logrotate-docker-proxy.log"

test -S "$source_socket"

if sudo test -f "$pid_file"; then
  readonly existing_pid="$(sudo cat "$pid_file")"
  if sudo kill -0 "$existing_pid" 2>/dev/null; then
    exit 0
  fi
fi

sudo rm -f -- "$target_socket" "$pid_file"
sudo sh -c "nohup socat UNIX-LISTEN:$target_socket,fork,mode=660,user=vscode,group=vscode,backlog=128 UNIX-CONNECT:$source_socket >$log_file 2>&1 & echo \$! >$pid_file"

for _ in {1..50}; do
  if docker version >/dev/null 2>&1; then
    exit 0
  fi
  sleep 0.1
done

sudo cat "$log_file" >&2 || true
exit 1
