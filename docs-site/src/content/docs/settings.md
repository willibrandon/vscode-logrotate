---
title: Settings
description:
  Configure validation, target versions, executable discovery, and language server tracing.
---

`logrotate.validation.enable` controls built-in diagnostics. Its default is `true`.

`logrotate.validation.maxProblems` limits diagnostics from one malformed document. Its default is
`100`; accepted values range from `1` through `1000`.

`logrotate.targetVersion` selects the built-in language model. `latest` uses the newest reviewed
syntax. `3.22` pins that model explicitly. `auto` asks an eligible desktop host for the installed
version and otherwise uses the latest reviewed model.

`logrotate.externalValidation.mode` controls optional validation with the installed executable. Its
default is `off`. Set it to `onSave` to validate eligible files after a save.

`logrotate.executablePath` names the executable used for installed validation and version detection.
Its default is `logrotate`. The setting is restricted in untrusted workspaces.

`logrotate.trace.server` controls Language Server Protocol tracing. Its default is `off`. Use
`messages` or `verbose` only while troubleshooting because protocol traces can include document
text.

Settings can be changed in the Visual Studio Code Settings editor or in workspace JSON.
Resource-scoped settings may be changed for one file or folder.
