---
title: Recognized files
description: Understand the extension's file detection and add a project-specific association.
---

The extension recognizes `logrotate.conf`, files directly under a `logrotate.d` directory,
`*.logrotate`, and `*.logrotate.conf`. It also recognizes an open text file when the first line is a
complete log-path stanza, such as `/var/log/application.log {`.

## Includes and project filenames

Files reached through an `include` directive are assigned the Logrotate language after the open root
configuration is analyzed. The extension does not claim every `.conf` file or guess from a project
filename alone.

Use Visual Studio Code's `files.associations` setting for a project-specific name:

```json
{
  "files.associations": {
    "deploy/rotation-policy": "logrotate"
  }
}
```

## State files

State files use a separate, read-only-oriented language mode. The recognized names are
`logrotate.status` and `logrotate/status`. A file is also recognized when its first line is exactly
`logrotate state -- version 1` or `logrotate state -- version 2`.

## Markdown

Markdown fences named `logrotate`, `logrotate.conf`, and `logrotate-config` receive syntax
highlighting without changing the Markdown language mode.
