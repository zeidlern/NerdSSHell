# Clean baseline and connection fixes: development progress

This checkpoint document is kept in Git at the owner's explicit request so another session can recover the work. Application version and the existing v1.0.3 release remain unchanged until the owner chooses the next version.

## Authoritative development environment

- Repository: https://github.com/zeidlern/NerdSSHell.git
- Active local directory: D:\Dev\NerdSSHell
- Starting main/tag commit: d7884293464fd2d7e9c53eede9a705080c40d2b6
- Branch: codex/clean-baseline-connection-fixes
- Baseline package: 1.0.3; Electron: 44.5.1. No speculative dependency update.
- GitHub verification found only main, no unfinished-session branch/commit, and the current immutable v1.0.3 release. Its recorded installer digest is f96dd91ee4b0d269c16281476cfda6d81bc8810f8e973b5c271e19b29085ef7f. The release/tag/assets must remain intact.
- Fresh clone, clean tracked tree and entirely fresh npm ci --omit=optional. No application source, tests, node_modules, build output or Git history was copied from retired checkouts. Earlier session changes were abandoned.
- Retired development material was privately archived; D:\Dev\BetterSSH has only redirect instructions. Codex's saved project path and its text trust entry now identify the active directory. The display label still says BetterSSH and can be renamed through Edit project. No obsolete active-development references were found in the official source; legitimate legacy compatibility names remain.
- NerdSSHell.code-workspace uses this repository's directory, without an obsolete absolute source path.

## Completed baseline validation

- Fresh supported installation: 287 packages installed; installed audit reports zero vulnerabilities.
- npm run check: passed source/publication/metadata/branding/UI references and five tool regressions.
- npm test on Windows x64 / Node 24.19.0: 853 passed, 0 failed, 1 skipped of 854 tests. The file-symlink privilege case is unavailable locally; it is not a new regression.
- npm run dist: fresh unsigned Windows x64 NSIS installer built from untouched 1.0.3.
- npm run verify:package and Verify-Notices: passed real fuses, ASAR integrity, native hashes/containment/identity and project/third-party notices.
- Baseline packaged password restart/Forget/rejection acceptance: 49 checks passed. Baseline packaged renderer/SSH/SFTP/CMD/PS5/PS7 acceptance: 165 checks passed. Real UAC/pickers/physical clipboard/notification acceptance is outside these fixtures. Baseline artifacts were moved to excluded .local/baseline-dist so later builds start without old build output.

## Remaining work, in order

1. Reinspect the clean architecture and primary protocol/library sources. Confirm observable baud behavior before deciding whether to add a control; investigate per-window and tmux limits.
2. Investigate first-use host approval and implement secure mouse/keyboard interaction, preserving remembered-password consent and changed/revoked-key blocking.
3. Add About backdrop dismissal with inside-click, Escape, focus-return and no-click-through coverage.
4. Reproduce any pending-prompt/command cleanup defects against this baseline; implement focused fixes and at least 100-cycle stress tests with sanitized resource/latency metrics.
5. Run source/full regression, real disposable integrations where practical, actual UI pointer/keyboard and fresh exact-package Windows acceptance. Distinguish passes, skips and manual limits.
6. Recheck main, reconcile advances safely, push tested checkpoints and open a PR. Do not merge, tag, release or upload an installer.

## Recovery

Read AGENTS.md and the required architecture/security/release documents. Confirm origin and branch before editing. Use only this fresh checkout. Read .local/USER-MISSION.txt for the owner's complete request when available; all public decisions and measured results belong in this document/PR. Re-run unfinished checks, never convert an interrupted command into a pass. Source scripts derive paths from their repository root.

Latest pushed checkpoint: d29b6f3 (verified clean environment and baseline). The initial clean-environment checkpoint contains no application changes. Next: fresh architecture research and focused implementation.

## Preimplementation research checkpoint

- Added a research-only regression to the existing disposable Linux integration suite: independent PTY rates on one transport, observable stty speed and tmux independence. Runtime/UI baud changes await this evidence.
- Existing build workflow supports Linux-only manual dispatch for this research; normal PR validation still includes Windows. Installer artifact upload is limited to main, keeping the feature-branch development installer off GitHub until review. No release/tag changes.
- Fresh baseline reproduction found stacked native first-use trust modals outside prompt serialization, a 180-second stale login prompt after transport loss, retained exec collectors and a temporary readiness listener. Reports are sanitized in excluded .local files; fixes remain in progress and are not claimed complete.
