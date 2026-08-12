# Remote extension-host smoke check

The required `Remote SSH host` CI job consumes the exact release-candidate VSIX. It creates a
one-job SSH key and a pinned Debian container, connects through VS Code Remote SSH, and installs the
candidate only in the remote VS Code Server. No repository secret or persistent host is used.

A test-only workspace extension records evidence from inside that remote extension host. It proves
that `vscode.env.remoteName` is `ssh-remote`, the candidate and extension-host executable live under
the remote `.vscode-server`, and `nodeServer.cjs` runs there. It opens the remote configuration,
follows its include, and requires the expected `LR1001` diagnostic from the included resource.

The remote workspace pins `/usr/sbin/logrotate` and selects the `auto` target. The test requires
remote detection of logrotate 3.22.0 and invokes installed validation through the extension. Its
`LRHOST` diagnostic must contain the real unknown `rotote` option, proving that executable discovery
and execution occurred beside the remote files.

The job uploads `result.json`, the Logrotate output log, and a version record as the
`remote-ssh-smoke` artifact. A separate 2026-08-12 manual WSL review observed the same placement,
include behavior, extensionless content detection, and remote logrotate version.
