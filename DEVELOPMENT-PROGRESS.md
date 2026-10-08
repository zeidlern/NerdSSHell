# Clean baseline and connection fixes: development progress

This checkpoint document is kept in Git at the owner's explicit request so another session can recover the work. The initial implementation round preserved version 1.0.3. The owner subsequently authorized merge, publication and local installation as 1.0.4; the existing v1.0.3 release remains intact.

## Current completion status

The prior round is complete: PR8 was squash-merged as b952306, v1.0.4 was published immutable with seven verified assets, and the actual local installed copy passed71 host/password,190 UI and48 ASAR checks. Its corrected registered/shortcut target is the NerdSSHell program folder; existing data was preserved. Private completion records remain under .local/release-1.0.4.

Current task: owner approved Quick Connect plan and explicitly authorized implementation, testing, merge, publication and local installation without further approval. Candidate1.2.0 is on codex/quick-connect from validated main/tag1.1.0 f80613d. The prior1.1.0 task is complete: PR9 merged, immutable release406840164 published, actual current-user NSIS upgrade/restart and installed71/190/48 acceptance passed;73 original data files were preserved and the app reopened normally. Private receipt .local/release-1.1.0/state.json and PR9 record actual scopes including manual temporary-installer cleanup.

Quick implementation is in progress. Parent/source/parser/UI/provider lanes are independently validated; combined full checks, exact Windows acceptance and final CI remain. No1.2.0 publication/installation is claimed until the authorized actions complete.

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

## Final completion receipt

- Fully validated code/fixture checkpoint: 92a5737d874d5e8ec41bb1b226fd78f694783f84. Application runtime changes are at 89f9fd1; subsequent SDK-loader/temp-path commits change only acceptance tooling, workflow evidence and recovery documentation. The final documentation checkpoint is the commit containing this receipt; recover its exact pushed hash with git log -1 and verify origin/codex/clean-baseline-connection-fixes.
- [Full Linux/Windows build and acceptance run 37717620486](https://github.com/zeidlern/NerdSSHell/actions/runs/37717620486) passed both jobs. Linux: 886 regressions and 10 real OpenSSH/tmux/SFTP integrations, zero failures/skips. Hosted Windows: 909 regressions, zero failures/skips. Source/publication checks, a fresh x64 build, fuses/ASAR/native identity/integrity and notices all passed.
- Actual production executable on hosted Windows: 71 host/password/restart checks and 200 pane/rate/About/SSH/SFTP/PowerShell/Command Prompt/confirmation checks passed. Exact-ASAR Windows SDK with memory-only clipboard: 48 checks passed, including successful pointer/keyboard Continue, exact delivery once to the original shell, Cancel, queue/double-click/stale-target guards and owned-window enablement. This fixture is distinct from a fused-executable or physical-clipboard paste test.
- Hosted locked SDK cold acquisition and Windows short-name temporary-root handling both passed. Exact-ASAR native administrator bridge/owned process cleanup and 16 spelling/wrap checks passed. Physical clipboard use occurred only in disposable hosted production-console fixtures; no local user clipboard or real remote/session data was touched.
- [Dependency and secret workflow 37717620482](https://github.com/zeidlern/NerdSSHell/actions/runs/37717620482) passed: supported/complete-lock audits reported zero vulnerabilities, installed graph/proxy checks and secret scanning passed. [CodeQL JavaScript and Actions 37717620468](https://github.com/zeidlern/NerdSSHell/actions/runs/37717620468) and the CodeQL PR check passed. This is validation evidence, not a blanket security certification.
- Final local Windows checks: source/actionlint passed; 908 regressions passed, zero failures, one baseline file-symlink privilege skip of 909. Default and differently cased temporary-path exact-ASAR runs each passed 48, with all owned process/window/peer/temp cleanup true and zero OS clipboard reads/writes. Independent narrow temp-path review found no blocking issue.
- Lifecycle stress: 120 synthetic cycles and 100 verified loopback SSH cycles passed. Loopback Persistent controls are modeled; Linux integrations exercise real tmux. Disconnected commands/prompts/collectors are canceled promptly; old transport callbacks cannot retire replacements. No disconnected-input replay, automatic Standard shell replacement or Persistent task launch/termination was introduced. General connection latency was unchanged and the original long-session lag remains unreproduced; future diagnosis should use bounded runtime/operation diagnostics.
- Main and v1.0.3 tag remain d7884293464fd2d7e9c53eede9a705080c40d2b6. Immutable release 406254008, its updated timestamp and all seven asset IDs/sizes/digests exactly match the preimplementation baseline. Published installer SHA256 remains f96dd91ee4b0d269c16281476cfda6d81bc8810f8e973b5c271e19b29085ef7f. The feature build uploaded only NerdSSHell-source, no installer. No merge, release, tag, installation, dependency or version change occurred.
- Active source is D:\Dev\NerdSSHell with official origin; D:\Dev\BetterSSH contains only redirect instructions. Retired source/tests/dependencies/builds/history were not imported. Codex's path/trust entry and the repository-relative VS Code workspace are correct. The remaining cosmetic Codex project label can be changed via project menu > Edit project > NerdSSHell; retain its already-correct active directory.

Final recovery: checkout the pushed feature branch in the authoritative directory, read this receipt and AGENTS.md, verify main/release identity before further work, and inspect PR 8. Owner version/release/manual acceptance comes next; do not install or publish these unsigned development bytes as the existing 1.0.3 release.

## Version 1.0.4 release preparation

Owner authorization supersedes the earlier no-publish/no-install hold. Source, lockfile root and root package version are1.0.4; dependency versions, Electron44.5.1, installer GUID and application/data identity remain unchanged. Builds remain unsigned and must be labeled accordingly. Prior releasev1.0.3 is immutable and must not change. Actual1.0.4 results will be recorded after execution. Physical mouse/UAC/picker/notification acceptance is not implied by automated checks.

1.0.4 local receipt: fresh npm ci and synchronized source/lock versions passed. Full suite 908 passed, 0 failed, 1 baseline symlink skip; source/actionlint/package/notices and audits passed. Actual versioned production 71 host/password and 190 pane/UI checks passed; exact-ASAR SDK 48 and native/spelling 16 passed. All 77 shipped source/assets match; packaged runtime metadata matches. Unsigned installer SHA256 a3f086d672d4432ea1827198415ac54bfd27566dfb812327f1772b579b6829a9; ASAR SHA256 052f632d79827cb46417820d453c0b4f3b234d941bb334ffd9600f19a7f564d3. Versioned PR/main gates, squash merge, publication and installation remain next. A normal-exit request is pending for the running local 1.0.3 app; no existing user process or profile has been altered.

## Startup upgrade implementation checkpoint

Candidate1.1.0 implements one packaged Windows x64 startup check against the fixed official latest published stable release endpoint. Explicit Upgrade/Not now uses the existing themed queue; refusal downloads nothing. Download streams are bounded, credentialless and constrained to exact GitHub asset/CDN routes, declared length and SHA256. Source/debug acceptance launches are excluded. The normal scratchpad/Standard/local quit flow revalidates work before the helper is released; Persistent work is detached, not terminated.

The Windows handoff validates canonical owned files/IDs, checksums and exact single registered install scope. A hidden fixed broker starts an independent worker; nonce markers preserve cancellation before/after GO and after broker death. The worker waits for actual app exit, refuses reopens/conflicts/changed payload, uses the exact final NSIS target argument and validates new version before restart. New installer/uninstaller hooks refuse running apps rather than killing them. Data inside program/stage directories requires manual upgrade.

Actual scoped evidence: full local suite944 passed,0 failed,1 baseline symlink skip of945; currentsource/actionlint/package/fuses/notices passed. Exact-ASAR Windows SDK startup offer13 pointer checks passed with controlled release transport/current identity/inert handoff (no real install/network/clipboard/userdata). Existing production71 password and190 pane/UI checks passed. Non-installing exactNSISmacro probe refused1618 and left its owned inert app alive. Frozen helper:15 unit and116 native checks across21 generated fixturecontexts passed; allownedprocesses/temps cleaned, no real registry/data/installer actions. Native receipt is excluded.local/update-handoff-native-final-5/results.json; handoffSHA2564c28d3788ada7f7c44f85f064610e200aeb26db1b0e30a9abd8b02d0ea165c5e; runnerSHA256aad514fa3b5e75e8e19f45b07dafdd9e86ec6583dc17bde05c2bb31ad9a82e8d.

A fresh final package is being rebuilt after the last narrow JS cleanup fix; its native helper source is already independently measured. GitHub required CI follows the pushed checkpoint. Source main/release/installed1.0.4 remain unchanged;1.1.0 needs owner publication/initial installation once before future startup upgrades can occur. Real futureNSIS/UAC/clean-account scenarios remain manual acceptance scopes.

## Startup upgrade final local package and hosted fixture correction

Runtime checkpoint54911dd rebuilt candidate1.1.0 and passed package/fuses/native/notices verification. All81 shipped tracked source/assets and packaged metadata match. Current exact-package production71 host/password and190 pane/UI checks, SDK startup13 checks and frozen native helper116 checks passed. Unsigned local installerSHA256dce339127879b309d2d11400a1e3b03bd20207afa1e70d498957caa17b8269d6; ASARSHA25661c33382ae891c1dc6dbb0ac322e317a038d90b902893842dc3856c81b788f29. The private receipt is .local/startup-update/local-receipt.json. No consumer installation or owner-data modification occurred.

[PR9](https://github.com/zeidlern/NerdSSHell/pull/9) is a draft for review. Its first hosted Linux run37774687630 passed921 and failed one new cleanup fixture: unlink/create permitted the original inode to be immediately reused. The replacement test now retains the original allocation at another owned path, asserts distinct identity and separately covers a substituted directory; shipped helper bytes are unchanged. Revised local focused15 and full944 tests pass with0 failures and1 existing privilege skip of945; source checks pass. Dependency/secrets/CodeQL at54911dd passed. Hosted Linux and Windows rerun remain required.

Official main/latest release remainb952306/v1.0.4 with all seven published assets unchanged. This feature needs owner acceptance/publication and one initial1.1.0 installation to enable future automatic upgrades; prior1.0.4 authorization is complete. Do not infer real NSIS/UAC installation from the inert acceptance fixtures.

## Quick Connect tested implementation checkpoint

Owner approval covers implementation, testing, merge, publication and local installation of1.2.0 without further approval. Core/runtime/UI/generic guards are implemented on codex/quick-connect from f80613d. Existing1.0.3/1.0.4/1.1.0 releases are immutable and unchanged; main and version-tag protections remain active.

Actual current local source/full regression:1026 passed,0 failed,1 existing file-symlink privilege skip of1027. Generic guards passed provider/workbench/UI tests.300 synthetic main lifecycles return temporary registries/reservations/credential revisions to baseline;300 real Windows loopback appliance cycles cover ordinary/password-refusal/MFA/cancel/loss/shell-refusal with0exec,0automaticinput,0SFTP and final0sockets/channels/pending tasks/secrets. Those peers do not prove vendor interoperability or renderer-memory behavior.

Fresh unsigned1.2.0 Windows x64 NSIS build, package/fuses/ASAR/native containment and notices passed. Protected production GUI Quick acceptance passed54 actual pointer/keyboard/reload/save/history/trust/privacy/paste/workbench checks, with5shells closed and alltemporary resources cleaned. Memory-only synthetic paste events do not use the OS clipboard. Receipt .local/packaged-quick-connect-final/results.json; ASARSHA256b99b8dd0876eba26c2613cffa8576f5d3458358f05cf9448646fb11ee4d34545; installerSHA25616ce9113012b06af81cdd134d2e20c57c4ee7440233e8674728f4aebb86ae0ed.

An independent read-only cross-lane review found no blocking backend issue. Actual acceptance identified and fixed active generic renderer-reload initialization, saved-generic active-pane restoration, raw/paste destination normalization and unsupported-workbench target fallback before release. Reopening preserves the original transport/shell, invalidates old input/output ownership and provides an honest empty Standard snapshot; prior renderer-only scrollback is not recovered from the server.

Next: complete current71/190/48/startup13 regression gates, publish coherent source checkpoint/PR, pass all hosted gates, protected squash merge and main validation, fresh1.2.0tag/release, private owner-data backup, published-download verified local installation and installed acceptance. Do not infer completion from this in-progress checkpoint. Keep current installed1.1.0 and live work untouched until installation preparation.

Hosted PR ed85b4b: Linux1004 regressions and12 real integrations (including300 appliance cycles) passed with0failures/skips; dependency/secrets/CodeQL passed. Windows source1027 and the real appliance fixture passed. Its new GUI gate reached27 checks and failed only the physical-row echo assertion after exact input reached appliance A. A controlled1024x768 run on unchanged ASAR proved the text wrapped as ONLY_APPLIA/NCE_A: logical xterm extraction matched, physical-row joining did not. The fixture now uses the existing PerPane logical-line helper, captures screen evidence, and explicitly tests narrow/default and wide viewports. No application/ASAR/installer bytes changed. Required rerun remains before merge/publication; preserve prior scopes accurately.

Controlled viewport acceptance subsequently exposed a real generic reload race on both narrow and wide displays: current main rejects legitimate bootstrap api.open while rendererReloading is true, and the UI never retries. The original real peer/channel stay connected, but the new view is not initialized. The backend is changing this to bounded current-load coordination with captured owner identity and complete listener/timer invalidation, without relaxing sender validation or creating a new connection/shell. Final source/package/native/CI receipts must supersede the earlier b99/16ce candidate hashes after this fix. Existing published/installed1.1.0 remains unchanged; no merge or1.2.0publication has occurred.

Reload coordination fix receipt: current full1031 passed,0 failed,1 baseline privilege skip of1032. Generic open now defers until current renderer load completes with15s bound, shared duplicates, captured window/frame/runtime/client/shell/view/load-generation validation and complete timer/listener cancellation on timeout, subsequent navigation/crash/destruction/quit/transport/shell changes. Protected production acceptance54 passed at BOTH1024x768 and1920x1080, retaining exact real peer/channel and unchanged auth/shell/connection counts, no input replay. Allownedprocess/temp/resources clean. NewcandidateASAR9aeee0461809f97b53078c30cfc42327f3a54d2e683fe6a8f886021d30015535; installer702597d8ee89e677fdeb800173e7033473c2b40f256eb9a6cabf44fbf34ab44a. All84 shipped source/assets match. Olderb99/16ce candidate is superseded and must never be published. Hosted CI rerun follows the corrected checkpoint; main/release/installed1.1.0 remain unchanged.
