---
title: Validation
description:
  Distinguish built-in analysis from optional validation by an installed logrotate executable.
---

Built-in validation is the normal editor analysis. It runs without a local logrotate executable and
checks the document against the reviewed language model. This is the source of regular Logrotate
diagnostics.

Installed validation is an optional second opinion from the current host. Run **Logrotate: Validate
Current File with Installed Logrotate** or set `logrotate.externalValidation.mode` to `onSave`. The
command uses `logrotate --debug` with isolated state, a time limit, bounded output, and no shell
command string.

Logrotate debug mode does not rotate logs or run configuration scripts. It can still read included
configuration, expand paths, and inspect filesystem metadata. For that reason, installed validation
is available only for a saved local file in a trusted desktop workspace.

Host findings are labeled with the installed logrotate version. They can differ from built-in
findings because users, groups, paths, defaults, and build options belong to the machine where the
command runs.

Browser, virtual, untrusted, unsaved, and unavailable host configurations keep built-in validation
and skip the installed executable.
