# Release checklist

No release is authorized until every item has evidence. The package identity is
`willibrandon.logrotate`; release evidence must prove that exact identity.

## External ownership blockers

- [x] Confirm `willibrandon` as the publisher ID.
- [x] Verify the public GitHub repository and protected `main`/`v*` tag rules.
- [x] Verify the `willibrandon` Marketplace publisher and configured `VSCE_PAT` release secret.
- [x] Verify the `willibrandon` Open VSX namespace and configured `OVSX_PAT` repository secret.
- [x] Enable GitHub private vulnerability reporting.
- [x] Confirm the MIT license and independently authored boundary remain intact.

## Candidate evidence

The unchecked boxes in this section are intentionally reset for each release candidate.

- [ ] Tag is exactly `v<package.json version>`, protected and immutable, and points to a clean
      commit.
- [ ] `CHANGELOG.md` contains that version and release date.
- [ ] Required CI, CodeQL, dependency review, pinned-upstream conformance, desktop matrix, and web
      jobs passed for the commit.
- [ ] Dependency licenses, lifecycle scripts, audit, and registry signatures were reviewed.
- [ ] Package allowlist, secret/native/source-map scan, size limits, and clean-profile install
      passed.
- [ ] The single VSIX, SHA-256 checksum, reproducible CycloneDX SBOM, and GitHub provenance
      attestation are attached to the protected release.
- [ ] Marketplace, Open VSX, and GitHub consumed the same checksum-addressed VSIX bytes.
- [ ] Offline install and first activation were verified from the attached artifact.
- [ ] Stable/pre-release channel and installed-validation default (`off`) were checked.
- [x] Remote extension-host placement and executable locality have automated SSH evidence plus a
      dated WSL review in [remote-smoke.md](remote-smoke.md).
- [ ] Post-release Marketplace installation and Open VSX publication were verified before
      announcement.

The release job verifies both publisher credentials before building, waits for the exact version and
channel to appear in both registries, checks both copies against the release checksum, installs the
Marketplace version into a clean VS Code profile, and runs the desktop activation suite before it
makes the GitHub release public.

The release workflow enforces machine-checkable preconditions. Store identities, environment
protection rules, contacts, and final governance remain human approvals and cannot be inferred by
CI.

## Completed releases

Evidence for v0.1.6 is available in the [GitHub pre-release], [Visual Studio Marketplace listing],
[required CI run], and [CodeQL run]. The Marketplace verifier follow-up was merged in [PR #11].

[GitHub pre-release]: https://github.com/willibrandon/vscode-logrotate/releases/tag/v0.1.6
[Visual Studio Marketplace listing]:
  https://marketplace.visualstudio.com/items?itemName=willibrandon.logrotate
[required CI run]: https://github.com/willibrandon/vscode-logrotate/actions/runs/31625236303
[CodeQL run]: https://github.com/willibrandon/vscode-logrotate/actions/runs/31625236262
[PR #11]: https://github.com/willibrandon/vscode-logrotate/pull/11
