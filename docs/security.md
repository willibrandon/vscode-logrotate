# Security review notes

## Trust boundaries

| Input or capability  | Policy                                                                               |
| -------------------- | ------------------------------------------------------------------------------------ |
| Document text        | Untrusted; error-tolerant linear parsing with diagnostic caps                        |
| Include path         | Resolved only from an open or directly referenced document through `workspace.fs`    |
| Include graph        | Depth 16, normalized cycle detection, file/byte caps, UTF-8 validation, cancellation |
| Shell body           | Opaque bytes; never interpreted or executed by the extension                         |
| Installed executable | Desktop + saved local file + trusted workspace; off by default                       |
| Documentation URL    | Opened only after an explicit command or link gesture                                |
| Release input        | Clean protected tag, lockfile, immutable actions, protected environment              |

## External process checklist

The validator invokes `logrotate --debug <absolute-file>` as an argument vector with no shell. The
configured executable is not expanded through a shell. Each request has an abort controller,
timeout, bounded stdout/stderr, sanitized diagnostics, and a process-group kill path. Workspace
trust is checked by policy and again immediately before process creation. Deactivation aborts active
requests.

Host results are labeled with the detected binary version and are always secondary to the internal
parser. The extension does not pass document content through stdin and never requests a rotation.

## Release checklist

Review dependency diffs, licenses, lifecycle scripts, registry signatures, audit results, package
contents, bundle imports, secret scan, SBOM, checksum, provenance, action commits, workflow
permissions, publisher identity, and store artifact identity. The executable-validation default must
remain `off` for stable and pre-release builds.
