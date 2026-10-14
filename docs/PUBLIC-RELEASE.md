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

Create a fresh version tag from the reviewed `main` commit. Never move or reuse a published tag for changed bytes. Prepare release notes with changes, supported platforms, installation instructions, exact signing status and known limitations. `package.json`, both root lockfile versions and the version's CHANGELOG entry must agree with the stable `vMAJOR.MINOR.PATCH` tag.

### Automated publication after owner authorization

The owner creates the protected tag only after the exact source's `main` push workflows pass: **Validate and build NerdSSHell**, **Dependency security audit**, and **CodeQL JavaScript and Actions**. Both build jobs, both audit/secret jobs and both CodeQL languages must complete successfully. A successful workflow with a skipped Windows job is insufficient. Use the existing successful Windows build; do not rebuild release bytes during publication.

The `Publish validated release` workflow runs when an owner-created `v*` tag is pushed. It uses the publisher from protected `main`, verifies the existing tag resolves to validated source on `main`, and copies the Windows installer from that exact source's accepted build artifact. The publisher checks the artifact's lockfile, versioned inventories and installer SHA-256, then prepares seven consumer assets: installer, manual ZIP, license, two inventories, notices and SHA256SUMS. Release notes derive from the corresponding CHANGELOG section and identify source/build evidence and unsigned status.

The workflow's bot **does not create tags**. GitHub creates a missing tag when publishing a release, so publication must never depend on that implicit operation: the creation ruleset permits only the owner. The separate tag update/deletion protections remain in force for every actor.

For recovery, dispatch `Publish validated release` on `main` with the already-created stable tag. The publisher never moves a tag, replaces an asset or retargets a release. Identical draft retries may fill missing assets only; conflicting source, names, size or SHA-256 fail. Published retries verify existing public bytes without rebuilding or changing the release, including its latest designation. On failure, inspect the actionable API response and retained evidence; an incomplete release stays a draft. Re-run only after correcting the specific failure. Build artifacts have finite retention; if an unpublished release's accepted artifact expired, stop and arrange a fresh reviewed validation/build instead of claiming the old bytes were reproduced.

Publication verifies the final release is stable and public. A newer stable version must be returned by the unauthenticated latest-release endpoint; publishing an older historical version preserves the newer latest designation. Published retries never change that designation. The latest endpoint and downloadable installer are also exercised by the separate disposable Windows published-update acceptance workflow.

Creating the owner tag is the release authorization step; **tag creation is not unattended**. No broad personal access token or protection change is required for this process. If unattended tag creation is later approved, use a repository-specific GitHub App with only Contents write and Actions read, short-lived installation tokens, and an exception **only** in the tag-creation ruleset. Do not grant that App a bypass of tag updates/deletion or protected `main`. Approval, App installation, private-key/environment protection and the narrowly scoped ruleset exception are owner configuration tasks; no App or exception is configured by this workflow. GitHub documents [ruleset bypass actors](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository) and [short-lived App installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app).

Attach only intended consumer assets: installer when approved, SHA-256 manifest, dependency inventories and third-party notices. GitHub's source archives are source downloads, rather than installers. Do not upload complete diagnostics bundles containing user paths, private configuration or terminal data.

Verify the published asset names/checksums/signatures and links from README and Help. Test downloads as a visitor, publish matching [Wiki pages](wiki/Publishing-the-Wiki.md), and retain private recovery/diagnostic records outside the tracked repository. Review alerts and security reports throughout the supported release line; upgrades require explicit user approval.
