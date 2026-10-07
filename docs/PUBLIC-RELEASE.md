# Release process

The repository owner controls official source acceptance, version tags and releases. This checklist applies to each release and distinguishes source publication, downloadable Windows artifacts and publisher-signed Windows artifacts. Use [current validation results](VALIDATION.md) for actual evidence.

## Source and repository

- Review the final diff, license/attribution, user documentation and URLs. Preserve upgrade compatibility and synchronize package, lockfile, About/header, installer and CHANGELOG versions.
- Scan current source and reachable history for credentials and private data; review screenshots, logs and artifacts before publication. If a credential is exposed, revoke it and assess history/cache remediation without printing it.
- Keep public bugs, feature requests and fork pull requests available. Official write/merge/release/admin access remains limited to the owner and explicitly authorized maintainers.
- Verify active `main` rules, required checks, force-push/deletion protection and version-tag protection. Protect Wiki editing separately. Do not replace enforced checks with a bypass to complete a release.
- Verify private vulnerability reporting, dependency alerts, secret scanning/push protection and code scanning. Workflow files do not establish that repository settings are active.
- Keep Actions least-privileged, full-SHA pinned and isolated from signing secrets on untrusted PR runs. Review fork-run approval and environment rules.

## Validation

Run a fresh supported install, `npm run check`, `npm test`, disposable SSH integration and Windows package checks on the reviewed source. See [TESTING.md](TESTING.md). Report skipped/manual checks accurately.

Audit both the installed supported graph and complete lockfile. Review every applicable dependency and code-scanning finding, including its source/sink or package reachability. Fix practical issues; document a technical disposition for residual findings rather than mass-dismissal or scanner suppression. No unresolved unexplained critical/high finding should reach a release.

Regenerate dependency inventories and notices, then inspect the actual packaged files. Verify fuse bytes, ASAR integrity, native-provider identity, containment, branding, version metadata and notices. Test valid startup and tampered-resource rejection in disposable copies.

Use a clean Windows 11 x64 profile for normal install, upgrade, backup preservation and uninstall. Exercise authentication/trust cancellation and changed keys, busy multi-host/pane isolation, lifecycle/reconnect, real UAC approval/cancellation and alternate-user behavior, native dialogs/transfers, clipboard, profile ACLs and physical notifications. Bound destructive tests to isolated sessions/files. Record exact source/artifact identity, results and remaining limitations.

## Windows artifacts and signing

An unsigned build must be labeled unsigned; hashes establish byte identity, rather than publisher identity. Never describe unsigned builds as signed or advise disabling Windows/organizational security controls.

For signed distribution, configure the intended publisher identity and protected signing environment first. Limit secrets and deployment to reviewed `main` source with appropriate approval. Build using `npm run dist:signed`, then verify the application and installer with `scripts/Verify-Signed.ps1` and exact-package checks. Signing must not be followed by resource mutations.

Signing enrollment, paid services and publisher identity require the owner's explicit decision. Passing source tests cannot substitute for signing or native acceptance.

## Publish

Create a fresh version tag from the reviewed `main` commit. Never move or reuse a published tag for changed bytes. Prepare release notes with changes, supported platforms, installation instructions, exact signing status and known limitations.

Attach only intended consumer assets: installer when approved, SHA-256 manifest, dependency inventories and third-party notices. GitHub's source archives are source downloads, rather than installers. Do not upload complete diagnostics bundles containing user paths, private configuration or terminal data.

Verify the published asset names/checksums/signatures and links from README and Help. Test downloads as a visitor, publish matching [Wiki pages](wiki/Publishing-the-Wiki.md), and retain private recovery/diagnostic records outside the tracked repository. Review alerts and security reports throughout the supported release line; there is no unattended updater.