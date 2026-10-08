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

## Original work sequence (completed; checkpoint history follows)

1. Reinspect the clean architecture and primary protocol/library sources. Confirm observable baud behavior before deciding whether to add a control; investigate per-window and tmux limits.
2. Investigate first-use host approval and implement secure mouse/keyboard interaction, preserving remembered-password consent and changed/revoked-key blocking.
3. Add About backdrop dismissal with inside-click, Escape, focus-return and no-click-through coverage.
4. Reproduce any pending-prompt/command cleanup defects against this baseline; implement focused fixes and at least 100-cycle stress tests with sanitized resource/latency metrics.
5. Run source/full regression, real disposable integrations where practical, actual UI pointer/keyboard and fresh exact-package Windows acceptance. Distinguish passes, skips and manual limits.
6. Recheck main, reconcile advances safely, push tested checkpoints and open a PR. Do not merge, tag, release or upload an installer.

## Recovery

Read AGENTS.md and the required architecture/security/release documents. Confirm origin and branch before editing. Use only this fresh checkout. Read .local/USER-MISSION.txt for the owner's complete request when available; all public decisions and measured results belong in this document/PR. Re-run unfinished checks, never convert an interrupted command into a pass. Source scripts derive paths from their repository root.

Latest completed runtime checkpoint: 89f9fd1 (shared interactive app confirmations with passing local Windows acceptance). The following history preserves actual scopes and superseded in-progress states. Current remaining work is the hosted Windows SDK-loader rerun, final CI/release-identity receipt and owner review; use git log and the final sections of this document when resuming.

## Preimplementation research checkpoint

- Added a research-only regression to the existing disposable Linux integration suite: independent PTY rates on one transport, observable stty speed and tmux independence. Runtime/UI baud changes await this evidence.
- Existing build workflow supports Linux-only manual dispatch for this research; normal PR validation still includes Windows. Installer artifact upload is limited to main, keeping the feature-branch development installer off GitHub until review. No release/tag changes.
- Fresh baseline reproduction found stacked native first-use trust modals outside prompt serialization, a 180-second stale login prompt after transport loss, retained exec collectors and a temporary readiness listener. Reports are sanitized in excluded .local files; fixes remain in progress and are not claimed complete.

## Current implementation and measured evidence

- Research run [37708662908](https://github.com/zeidlern/NerdSSHell/actions/runs/37708662908) at e18266f passed 831 Linux regressions and all nine disposable OpenSSH/tmux/SFTP integrations, with zero failures/skips. Its Windows job was deliberately skipped in Linux-only dispatch and provides no Windows evidence. Real Linux PTYs reported 9600 and 115200 independently on one transport; omitted modes retained 38400 in that fixture. tmux pane speed stayed independent.
- Based on that evidence, an advanced saved connection rate and a new-Standard-window override are being implemented. Existing windows need a new PTY; Persistent/local windows cannot use this override. This is a terminal compatibility attribute, not bandwidth throttling or serial hardware setup.
- First-use trust now uses the existing serialized in-app prompt with Cancel focused and explicit Trust and connect. Fresh baseline VM evidence showed concurrent pending native trust requests outside app serialization/registry cleanup; it did not reproduce the reported physical mouse failure. Fresh Chromium UI passed 56 interaction checks with no errors/external requests. About pointer clicks, drags, focus return, Close/Escape and no background click-through are covered. Extended actual packaged host/pin/password acceptance is prepared but has not yet run for changed code.
- Fresh lifecycle proof reproduced a 180-second stale sign-in prompt, pending command promises/response collectors after disconnect and a retained temporary sign-in listener. Cleanup now cancels those owned operations and invalidates old views without replaying input or launching persistent work.
- Fresh focused lifecycle/security/password/SFTP validation passed 128 tests. Stress covered 120 synthetic lifecycle cycles and 100 verified real loopback SSH transports. Baseline/current comparison: 20/20 pending commands after disconnect versus 0/20; two retained completed-command collectors versus zero; both have zero live sockets/channels after cleanup. General establishment latency was essentially unchanged (median about 2.3 ms); Node-only steady-state memory samples do not prove a renderer leak or performance improvement. Persistent control behavior in the loopback stress fixture is modeled; the separate Linux integrations execute real tmux.
- Existing reviewable diagnostics now expose bounded runtime version and operation/channel counts, never raw credential or command data. The original lengthy-session lag remains unreproduced and is not attributed to Electron.
- In-progress full Windows suite passed 860 tests, zero failures and the one baseline symlink skip, plus two actual baud wire tests. Subsequent baud implementation requires a new full result before completion.

Next: finish baud regressions, freeze/review the combined diff, full source/regression checks, fresh Windows package build and actual packaged acceptance. Then push the tested implementation, recheck main and release identity, open PR and verify final CI. No version/tag/release/installer publication is authorized yet.

## Final validation checkpoint in progress

- Complete source checks and Windows suite passed 896 tests, zero failures and the same one baseline symlink skip of 897 registered tests. A same-key rekey compatibility case was subsequently added; final counts will be recorded after rerunning.
- The exact packaged rate/About/SSH/SFTP/native console fixture passed 186 checks before the final shared authentication adapter/state revision. Those results retain that scope; a fresh package and relevant gates are being rebuilt.
- Additional ordinary delayed/rejected/closed-transport authentication controls and supported password/key/agent sequencing checks passed. Independent boundary review completed; source-based protocol-order concerns are covered with synthetic event-order tests, while no hostile out-of-order wire test is claimed.
- No dependency graph, lockfile, version or release change. Inventories were regenerated and compared: only creation timestamps differed, so the existing unchanged dependency inventory was retained.
- The final candidate is an unsigned local development build, not the published 1.0.3 installer. No installation or user-data change occurred.

## Tested implementation checkpoint

- Final combined source checks passed. Windows suite: 897 passed, zero failures and the one existing file-symlink privilege skip of 898 tests. Current browser UI: 59 checks passed.
- Fresh rebuilt Windows package verification/notices passed; all 75 shipped source/assets and 54 runtime source files match the tested ASAR. Electron remains44.5.1; app/package version stays1.0.3 pending owner version choice. Both app and installer are NotSigned. This is a local development candidate, not a replacement release.
- Exact-package host/password acceptance passed71 checks, covering genuine mouse/keyboard actions, pending/canceled confirmation behavior, fingerprint pinning and all existing encrypted-password restart/Forget/rejection controls. Native package identity: ASAR8358402246e69cb4d2a88fc71c555162ddcd80b0110f55aadbb0da13364a3b70, installer142ee5271bc62ef473e6c57109d909a25ef9b03bdf6ffd240586bbbc7265ee9e.
- Ordinary authentication compatibility includes verified same-key rekey and supported password/key/agent method ordering. Private security investigation/evidence stays outside tracked source and public PR prose. No hostile out-of-order wire test is claimed.
- The owner reproduced a native multiline-paste confirmation that cannot be clicked. The screenshot contains private terminal data and is not stored in Git. Shared app-owned confirmation handling will be a separate follow-up section: approval and cancellation must both be fully interactive, with no change to OS file/UAC pickers or caller destination/review checks.
- The rerun of full exact-package pane/native fixtures against the revised authentication build is in progress; do not infer completed results from older candidates.

Next: complete those package gates, implement/test the shared confirmation follow-up, recheck main and release assets, push a final checkpoint and open the PR with honest validation/manual limits.

Post-checkpoint Windows reruns: exact revised package passed186 pane/baud/About/SSH/SFTP/console checks, exact-ASAR native provider/owned cleanup acceptance, and16 spelling/wrap checks. All source/package version and unsigned status remain as recorded above. Shared clickable confirmation service is now actively being implemented in response to the owner's native paste-popup reproduction; both Continue and Cancel are required, with no user clipboard or live remote actions.

Linux implementation acceptance at edfea32: [run37713138520](https://github.com/zeidlern/NerdSSHell/actions/runs/37713138520) passed875 regressions and all10 real OpenSSH/tmux/SFTP integrations, zero failures/skips. The application-level saved profile, independent new-window override, server default and task inheritance all produced the expected Linux PTY speeds. Windows was intentionally skipped in Linux-only dispatch; its local exact-package gates are recorded separately.

## Shared interactive confirmation follow-up

- The owner's reproduced native paste popup was inaccessible to the mouse. App-owned message-box confirmations now share the themed renderer presenter/queue with credentials and host approval, keeping Continue and Cancel interactive in the existing enabled Windows app window. OS file/UAC/error pickers are unchanged. The exact Win32 cursor/capture mechanism remains unverified; the problematic native app-confirmation path is removed.
- Physical/logical response IDs and all caller destination/profile/session/review revalidation remain. Server-support ask(confirm) is converted before queueing to avoid recursion; no automatic approval. The queue is bounded64 and invalidates active/queued requests on renderer reload/destruction. Renderer loss never automatically closes authenticated Standard shells or terminates Persistent work.
- Focused58-case confirmation/password/UI checks passed. Full current Windows suite passed908, failed0, skipped1 of909 cases (same baseline symlink privilege). Current source and workflow syntax checks passed.
- New acceptance uses an exact-ASAR Windows Electron SDK harness with injected memory clipboard, not the fused executable or physical clipboard; it must prove successful mouse/keyboard paste reaches only the originating terminal. Existing fused-exe pane acceptance additionally tests actual shared disconnect confirmation approval/cancellation. Fresh final build/acceptance are in progress, not claimed complete yet.

## Final shared-confirmation local acceptance

- Windows full suite:908 passed,0 failed,1 baseline symlink skip of909; source/publication and actionlint checks passed.
- Fresh final package/fuse/ASAR/native-hash/identity/notice checks passed. All75 shipped source/assets match the tested ASAR byte-for-byte. Locked runtime remains Electron44.5.1/Chromium152.0.7977.130; no version/dependency change.
- Actual fused-executable host/password suite:71 passed. Actual fused-executable pane/rate/About/SSH/SFTP/console/shared-confirmation suite:190 passed. Pointer Cancel retained every owned shell; pointer Continue closed only approved fixture-a and preserved fixture-b.
- Exact-ASAR Windows SDK/memory-clipboard harness:47 passed. Successful mouse/keyboard Continue delivered exact multiline input to the originating echo channel; Cancel/outside/double-click/stale/replacement guards and serialization passed. The owned Windows parent stayed OS-enabled; no OS clipboard read/write. This scope does not claim a physical-clipboard or fused-exe paste test. Owned fixture processes/windows/peers and temporary data were cleaned.
- Exact final ASAR native provider/ownership/cleanup and16 local spelling/wrap checks passed. No real UAC, file/color picker, physical toast/audio or manual installed-user acceptance is claimed. The tester's general lengthy-session lag remains unreplicated.
- Unsigned LOCAL development artifact: installerSHA25676ab801919922e7288712f99d887f1bac9ff0ca29625e347580eda44038f7fef; ASARSHA256b1fe67c59d3577dd264a9760cf56bfca984b34865ef26e25065a4b49d124decd. This is not the published1.0.3 release. Neither installed applications nor user profiles/clipboard/remote sessions were modified.

Next: push this tested section, open the PR and complete full GitHub Linux/Windows/audit/CodeQL validation. Recheck main and immutable v1.0.3 release/tag/assets afterward. Owner version/release and manual mouse acceptance on the owner's machine remain review decisions.

Draft review PR: https://github.com/zeidlern/NerdSSHell/pull/8 targets main d788429. No merge/release/version change. Final PR-triggered Linux/Windows/audit/CodeQL checks are running. Final recovery checkpoint will record exact outcomes and release identity after completion.

PR89f9fd1 Linux results:886 regressions and10 real integrations passed, no failures/skips. Dependency workflow supported and complete-lock audits each report0 vulnerabilities, installed graph/build proxy checks and secret scan passed. Both CodeQL analyses and CodeQL PR check passed. Hosted Windows build/native/UI/confirmation validation remains in progress; no final pass is claimed yet.

Hosted Windows89f9fd1 passed909 regressions, package verification, native71 host/password checks and production200 pane/UI/confirmation checks. The new SDK clipboard harness alone failed before launch because it bypassed Electron44.5.1's supported lazy SDK loader and assumed node_modules/electron/dist/electron.exe already existed. The fixture now resolves require('electron') (or explicit --runtime), preserving the package's pinned checksums and runtime assertion; no app/runtime/dependency change or skipped gate. Current rerun is required before final CI pass.

CI fixture correction local receipt: npm run check passed; npm test passed908, failed0, skipped1 of909; the revised exact-ASAR SDK/memory-clipboard harness passed47. No shipped source or ASAR bytes changed. Main remainsd788429 and all seven immutable v1.0.3 asset identities/digests were rechecked unchanged before this push. The feature-branch CI rerun must still establish the supported loader cold-start behavior on the hosted Windows runner.

Hosted rerun a0c7b80: the supported locked SDK loader succeeded. Linux886+10, Windows909 and production71+200 passed again; dependency/secrets/CodeQL passed. The clipboard fixture alone still failed before acceptance because the runner exposes C:\Users\RUNNER~1 while native realpath expands runneradmin. Its raw-temp prefix comparison rejected that legitimate alias and masked initialization with a cleanup assertion. The fixture now canonicalizes the temporary root and requires the generated directory to be its direct child, with unchanged PID/executable/start-time and no-symlink guards. Failure evidence includes its sanitized report. Fresh default and differently cased TEMP acceptance, full regressions and a new hosted run are required.

Canonical-temp local receipt: source/actionlint passed; full Windows suite passed908, failed0, skipped1 of909. The exact-ASAR SDK fixture passed48 both with the normal temp environment and a differently cased temp environment. Both reports confirm owned runtime/windows/peers stopped and temporary data removed, zero OS clipboard reads/writes. The added check explicitly records direct ownership beneath the canonical Windows temporary root.
