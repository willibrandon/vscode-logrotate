---
title: Troubleshooting
description:
  Resolve file recognition, delayed diagnostics, includes, validation, and tracing problems.
---

If a configuration opens as plain text, check the language mode in the status bar. A file with an
unusual name needs a `files.associations` entry unless its first line is a complete recognized
stanza or it was reached through an analyzed include.

## Language server

If highlighting appears but diagnostics do not, run **Logrotate: Show Language Server Output**.
Confirm that the visible file URI was opened and analyzed. Then run **Logrotate: Restart Language
Server** if the extension host or remote filesystem changed.

## Includes

If an included file has no language features, keep the root configuration open long enough for its
`include` directive to be analyzed. The output channel reports the loaded resources and any
filesystem failure.

## Installed validation

If installed validation is unavailable, save the file and confirm that the workspace is trusted, the
URI uses the local `file` scheme, and the desktop extension host can find the configured executable.
Browser and virtual workspaces cannot start it.

If `auto` cannot detect an installed version, the editor continues with the latest reviewed language
model. This fallback does not disable diagnostics or formatting.

## Reporting a problem

For a reproducible problem, include the extension version, Visual Studio Code version, host type,
relevant settings, and sanitized Language Server output in a
[GitHub issue](https://github.com/willibrandon/vscode-logrotate/issues). Do not attach a verbose
protocol trace until it has been checked for document contents.
