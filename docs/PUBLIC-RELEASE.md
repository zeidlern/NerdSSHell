# Public-release gates

**Current repository:** [clean public migration — October 6, 2026](CLEAN-PUBLIC-MIGRATION-2026-10-06.md). The [earlier publication audit](PUBLICATION-AUDIT-2026-10-06.md) describes the separate private development repository. For GitHub click-by-click instructions, use the [maintainer checklist](wiki/Maintainer-Publication.md).

The owner selected one source-visible NerdSSHell repository and a 1.0.0 source line. This does not itself publish a release, sign an installer, protect a branch or approve disclosure of all historical personal information. Source publication and general consumer binary distribution are separate decisions.

## 1. Privacy, ownership and access

- [ ] Review current files, all reachable branches/tags and old blobs, commit authors/committers/messages, PR text/comments/attachments, logs and downloadable artifacts. Classify scanner matches rather than calling every match a secret or every clean scan clearance.
- [x] Owner selected independent clean public history. The parentless reviewed baseline and controlled clean documentation are the only imported source history; old PR/cache/development records remain in the private historical repository. No GitHub Support purge is required to keep those separate records private. Do not push old clones or make the historical repository public.
- [ ] Review screenshots, original/generated artwork and binary metadata for personal content. Review rights/attribution for recognizable third-party marks and custom-license terms; do not imply endorsement.
- [ ] Revoke any real exposed credential before removing it from history, and review remote PR references/caches separately where relevant.
- [ ] Use privacy-preserving commit identity for future work, strong account authentication, minimal collaborator/app write grants and verified recovery procedures.
- [x] A project LICENSE and contribution policy are committed. Third-party licenses remain separate; package.json `private:true` prevents accidental npm publication, not GitHub source viewing.
- [x] Legacy application ID, package/data/IPC/tmux identities remain stable. Their old names are deliberate compatibility choices.

## 2. Checks and repository controls

- [ ] Require the exact final source/unit/SSH integration/Windows package checks through an **active** main ruleset. Verify enforcement and target branch; CI configuration alone is not protection.
- [ ] Run fresh supported-build and full-lock dependency audits. The supported graph omits optional packages but includes development/build tools. Full-lock findings are informational under the existing policy, not automatically fixed or approved.
- [ ] Verify optional lockfile placements are absent after `npm ci --omit=optional`. Do not change the install command and continue relying on the narrower audit.
- [ ] Run full-reachable-history Gitleaks and review redacted privacy triage. Neither covers every binary/image, unusual secret format or off-Git surface.
- [ ] Actually run and inspect CodeQL JavaScript and Actions analysis or an equivalent review. A skipped private-repository job is not a pass. The corrected workflow uses event visibility and a public-event trigger; its enabled execution still needs verification.
- [ ] Enable/verify available secret scanning and push protection, dependency alerts and private vulnerability reporting. Verify the private reporting route and maintenance responsibility. Never solicit exploit details in a public issue.
- [ ] Protect main and release tags, restrict bypass, keep Wiki editing collaborators-only and use collaborator-only PR creation when unsolicited proposals are unwanted.
- [x] Workflows use full-SHA-pinned actions and read-only default tokens. Keep fork code away from signing secrets and self-hosted release workstations; review actual account/repository settings separately.
- [x] A manual main-only signing-candidate workflow and fail-closed signing verifier are prepared. This is not evidence of enrolled signing, a protected environment or a published artifact.

### Dependency history, not current clearance

The October 3 checkpoint reported eight propagated high findings from build-time `http-cache-semantics`. A later compatible lockfile update selected 4.3.0; the earlier issue count is historical, not the current status of every future build.

The October 6 scan observed moderate `sprintf-js` findings through the optional `@electron/get 3.x -> global-agent -> roarr` graph. Supported builds already use `npm ci --omit=optional`. The scoped gate therefore can pass while the complete lockfile still reports advisories. This distinction is documented, and the new installed-graph check tests the omission rather than merely assuming it. Do not use `audit fix --force`, downgrade packaging blindly, weaken a gate or call the full graph clean without actual evidence.

## 3. Exact packaged Windows artifact

- [ ] Sign the application executable and installer with the intended verified publisher identity and timestamp. Verify Authenticode on a clean Windows system. Hashes do not authenticate a publisher; do not disable OS warnings or organizational controls.
- [ ] Use a genuinely protected release/signing environment with reviewed SHA, limited secrets, main-only deployment and appropriate approval. Repository/environment settings are not created by committing the workflow.
- [ ] Recheck Electron fuse bytes, embedded Windows ASAR integrity, only-load-from-ASAR behavior, native component identity/ACL assumptions and JS containment on the exact signed artifact.
- [ ] Test tampered resources, unexpected app directories, environment/debug switches, malformed inputs and valid clean startup. Preserve existing rejection assertions, not just configuration flags.
- [ ] Regenerate final SBOMs and retain exact third-party notices, Electron/Chromium licenses, checksum manifest and provenance evidence. Do not replace these with a stale earlier build's report.
- [ ] Publish only reviewed consumer artifacts and documentation, not a complete CI diagnostics ZIP with screenshots/logs/private paths. Never reuse a public tag for changed bytes.

The candidate verifier already checks hardening and containment, and earlier disposable ASAR tampering tests demonstrated rejection at their recorded revisions. Those results do not establish that a new signed release has passed the same checks. There is no unattended auto-updater to keep installed clients current automatically.

## 4. Product and adversarial acceptance

- [ ] Clean Windows 11 x64 user/VM with no maintainer profiles, keys or overrides: normal install, launch, upgrade, backup preservation and uninstall behavior.
- [ ] Actual password, key, agent and keyboard-interactive flows; first-use fingerprint verification, cancel, changed/revoked keys, deliberate key rotation and recovery without repeated trust prompts.
- [ ] Genuine UAC approval/cancellation and alternate-account behavior, not merely a no-UAC broker fixture or an already elevated CI runner.
- [ ] Multi-host/session isolation during layout changes, reconnect and concurrent prompt races, including investigation of the historical pane-content-mismatch observation.
- [ ] Four busy terminals, bounded views, oversized/fragmented/empty protocol responses, large snapshots, escape sequences and sustained-output/resource limits.
- [ ] Real native file dialogs and GUI-driven transfer bytes; SFTP hangs/cancel/disconnect, symlinks, path/control-character handling, no-overwrite races, ownership-safe cleanup and channel limits.
- [ ] Actual Windows data ACLs, disk-full/error handling, retention/export/deletion behavior. Recording stays off by default; archives/notes/backups are plaintext and potentially synchronized by Windows policies.
- [ ] A verified recording-deletion workflow. The current application has no visible archival-deletion or Data folder control; do not invent one in documentation or remove user recordings without consent.
- [ ] Persistent Close/Disconnect/Quit leaves remote work running, discovery/reconnect does not launch or replay commands, and End is deliberate. Standard/local closure consequences are confirmed. Server reboot is loss of a process, not resurrection on reconnect.
- [ ] Physical Windows notification/taskbar/audio behavior, keyboard/IME/accessibility and representative display/layout conditions, with failures and limitations recorded.

## Publication decision

Only mark a gate complete with evidence for a specific commit, configuration and artifact. A source version of 1.0.0 is not a security certification. Source may be published before a signed download only after the distinct source/history/privacy/reporting decisions are resolved; general users should not be directed to bypass security controls for an unsigned candidate.

Historical evidence remains in [ACCEPTANCE-RESULTS.md](ACCEPTANCE-RESULTS.md), [SECURITY-REVIEW.md](SECURITY-REVIEW.md) and the [implementation log](NERDSSHELL-IMPLEMENTATION.md). Read their dates and scopes; old counts, skipped checks and incomplete manual acceptance are not relabeled as current successes.
