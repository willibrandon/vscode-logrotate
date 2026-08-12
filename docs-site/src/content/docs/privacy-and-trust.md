---
title: Privacy and trust
description: Learn what the extension reads, runs, records, and sends.
---

The extension has no telemetry and makes no runtime network requests. Normal language features
analyze documents and included resources through Visual Studio Code. Documentation links open only
after an explicit command or quick-fix action.

## Built-in analysis

Built-in analysis does not start external programs. It works in Restricted Mode and in browser or
virtual workspaces, subject to the filesystem capabilities provided by Visual Studio Code.

## External processes

Installed validation and automatic version detection are desktop-only features. They require a
trusted workspace and recheck trust immediately before starting the configured executable. Process
arguments are passed without a shell. Execution has cancellation, timeout, output-size, and
process-tree limits.

## Logs and traces

The Logrotate Language Server output channel records startup, document identifiers and versions,
diagnostic counts, include counts, configuration changes, restarts, closes, and failures. Default
logs do not include document contents.

Protocol tracing is separate and can include document text. Keep `logrotate.trace.server` set to
`off` unless a protocol trace is needed for a short troubleshooting session.
