# NerdSSHell implementation and recovery log

## Mission

Evolve BetterSSH into **NerdSSHell**, with the tagline **Built for Windows nerds with Linux problems**. Implement centralized two-pane Preferences, same-session Actions and Favorites, normal/elevated local PowerShell and Command Prompt as first-class sessions, navigation refinements, independent waiting-for-input alerts, and production light/dark branding. Preserve saved data and working SSH/tmux/SFTP/input behavior. Save tested sections to GitHub with sequential patch versions.

**Current release candidate: 1.0.0.** The candidate includes the completed 0.1.12 Scratchpad word-wrap checkpoint, Electron 44.5.1, repository/public-facing cleanup and the chosen source-available use terms. Earlier integration and acceptance evidence retains its original versions.

### Version 1.0.0 release preparation — October 6, 2026 Chicago

- Repository identity is now `zeidlern/NerdSSHell`. Public-facing links and About text use the new repository name; legacy internal compatibility identifiers remain intentionally unchanged.
- The 0.1.12 word-wrap branch is the release baseline so its completed, locally accepted work is not discarded. Electron advances from 44.4.5 to 44.5.1 as the pending maintenance update.
- Product/package version advances to 1.0.0 and future releases use semantic versioning. Source-visible distribution terms and the no-unsolicited-PR contribution policy are committed with the release candidate.
- The release candidate must pass its own GitHub source, SSH integration, Windows package/native and security workflows. Historical results are context, not substitutes for the 1.0.0 head.
- Windows code signing remains separate; an unsigned installer must be described as unsigned and must not be represented as publisher-authenticated.

### Scratchpad word wrapping — 0.1.12 (October 5, 2026 Chicago)

- Working branch: `codex/scratchpad-word-wrap`. `ui/index.html`, `ui/scratchpad.js` and `ui/desktop-ux.css` add an accessible Word wrap button, initially off. Native soft wrapping and identical preview styles/gutters contain prose and unbroken tokens; turning it off restores horizontal scrolling. The choice survives collapse/reopen in memory.
- Wrapping only changes presentation: notes, literal line breaks, selection, dirty tracking and file-dialog revision checks are preserved. Package/lockfile versions advance together; visible and installer versions continue deriving from package metadata.
- `test/ux-desktop.test.cjs` verifies presentation/selection/dirty-state preservation. Shared real-renderer checks in `scripts/Scratchpad-Wrap-Smoke.cjs` run in the Chromium UI and isolated Windows Electron spelling fixtures, covering long lines/tokens, highlight geometry, resize/scroll, collapse/reopen, plain text and switching back.
- Validation: `npm run check` passed; **726/726 Windows regressions passed**, zero failures/skips. The real Chromium UI passed **46 checks**, with no JavaScript errors or external requests. The isolated Windows Electron 44.4.5 fixture passed **16 checks**, including wrapping and native spelling/correction/undo; no dictionary downloads or external requests appeared in its complete process net log. Wrapped UI screenshots were inspected. Versioned SPDX inventories were regenerated. Local reports/screenshots remain under excluded `.local/scratchpad-wrap-{ui,native}`.
- GitHub feature checkpoint: [`d01cdeb`](https://github.com/zeidlern/NerdSSHell/commit/d01cdeb), `codex/scratchpad-word-wrap`. Existing manual/public-release gates retain their original scope.

#### Local installation — October 5, 2026 Chicago

- Owner requested installing the new version. The NSIS 0.1.12 build, package verification and ten exact packaged dependency notices passed. All **70 shipped source files** match the ASAR byte-for-byte; packaged metadata/version and native/resource integrity checks passed. The disposable packaged Windows fixture passed **162 checks**, now including the shared word-wrap checks in `scripts/UX-Desktop-Smoke.cjs`, plus the existing loopback SSH/SFTP and native CMD/PS5/PS7 lifecycle/resize acceptance. No real user sessions, UAC consent or clipboard replacement were used.
- Installed over 0.1.11 in the existing registered directory; installer exited 0. Executable and registry version are 0.1.12; installed executable and ASAR match the verified build. All **71 existing application-data files** were copied to a verified private backup and remained byte-for-byte unchanged through installation. The app was already closed; no process/session was forcibly stopped. Opened the normal user installation afterward.
- Installer SHA-256: `68d0f039450a4e8cb01e403605680a18cbbbae3ab6f2f6abb9f44afe14716dd8`. ASAR SHA-256: `a16ed8cb87e193951b32d5048701d7f66b01efdd8209b1bef173fefbfb3914b6`. Private backup/install records and acceptance output stay in excluded local files; packaged acceptance is under `.local/scratchpad-wrap-packaged`.
- The installer remains an unsigned development build. Next step: GitHub validation/review of the checkpoint; existing release/manual gates are unchanged.

### Scratchpad, session placement and About — 0.1.11 (October 4, 2026 Chicago)

- Working branch: `codex/smoother-workspace`; baseline `c9b3056d6a4df82467caa4d7ef52e3e1bc02e351`. This checkpoint retains the accepted native providers, application identifier, profiles and session lifecycle boundaries.
- `ui/scratchpad.js` and Scratchpad CSS show native text synchronously rather than making glyphs wait for an 80 ms highlighted-mirror refresh. Highlighting publishes one inert fragment, with 100k-character/4k-token limits and visible IME composition; large/dense notes stay native text. The save-byte allocation is outside the input path. Unsaved-note and file-dialog revision checks remain.
- `src/scratchpad-spelling.cjs`, main and the textarea enable local English spelling with bounded native correction suggestions and undo. Fixed isolated-world checks bind corrections to the same trusted main frame, textarea, note, selected word and focus; stale/destroyed/navigated targets cannot change another field. The dictionary fallback URL stays on the denied internal application origin. Notes stay on this PC, external dictionary fallback is blocked, and no OS dictionary additions are offered. Native Windows 44.4.5 returns suggestions despite its misleading `spellcheckEnabled=false` context flag; the actual DOM spelling setting is checked instead.
- `ui/app.js` focuses selected opens, adds terminal drag handles and preserves explicit visible slots. Drops swap occupied panes or retain holes in empty positions; selecting another visible pane does not recenter the workspace. New opens fill available slots; background opens and stale focus callbacks cannot steal keyboard focus. `src/storage.cjs` validates optional bounded unique slots against existing open order, preserving legacy settings. Existing panes/transports, file browsers, input locks and safety confirmations retain their ownership.
- About uses the existing 512px theme-matched mascot, larger name/tagline and responsive scrollable layout. Only the two fixed image paths were added to the resource allowlist; foreign initiators, alternate assets and denied dictionary paths remain blocked.
- Source check passed; **725/725 Windows unit/native regressions passed**, zero failures/skips. **40 real Chromium UI checks passed**, no JavaScript errors/external requests. **156 exact packaged Windows UI checks passed**, including loopback SSH/SFTP, CMD and strict PS5/PS7 resize/editing, immediate notes, About asset loading, occupied/empty pane movement and saved slot validation. Owned fixture process stopped and temporary profile data was removed.
- A separate hidden, sandboxed pinned Windows Electron fixture using the actual Scratchpad DOM/renderer/CSS passed **9 native spelling checks**: typo/suggestion, correction, undo, stale focus rejection, underlines surviving syntax colors, no dictionary downloads/external attempts and a complete process net log with no HTTP/HTTPS URLs. The red underline was visually inspected. Seven focused adversarial spelling regressions are included in the full suite. CI now runs this fixture and preserves its report/screenshots.
- NSIS build, package/version/branding/native hashes/fuses/ASAR integrity/containment and ten exact packaged dependency notices passed. All changed shipped source files match the tested ASAR byte-for-byte; electron-builder intentionally normalizes packaged package metadata, whose version/name match source. SPDX inventories were regenerated for 0.1.11.
- Local unsigned test installer: `dist/NerdSSHell-0.1.11-x64-Setup.exe`, SHA-256 `4efc435b31b75b3ed61b7ea3819a6e60699e937069f58c3e5262836db61a8afa`. ASAR SHA-256: `f079c9d7b1144764fa931f9e4a0f44875c334dea44ccf741b22a59db5ca3da9c`. Local reports/screenshots are under `.local/workspace-0.1.11-{ui,packaged}` and `.local/scratchpad-spelling-native`; they are excluded from Git.
- GitHub checkpoint: [`9ae1d75`](https://github.com/zeidlern/NerdSSHell/commit/9ae1d75), [draft PR #14](https://github.com/zeidlern/NerdSSHell/pull/14). Next step: pending GitHub PR validation and owner use of the tested installer. This turn builds and tests the candidate without changing the current installation or real session data. Existing real UAC/native picker/physical notification and public-release gates remain; no earlier acceptance is relabeled as 0.1.11.

#### Local installation completion — October 4, 2026 Chicago

- Owner requested finishing and installing locally. Installed the exact verified 0.1.11 candidate over 0.1.10 in the existing registered BetterSSH directory; installer exited 0. The executable/registry version is 0.1.11 and installed ASAR matches the recorded tested hash. All 71 existing application-data files were copied to a verified private backup and remained byte-for-byte unchanged through installation. No running application or session was forcibly stopped.
- The installed binary passed all **156 disposable packaged Windows UI/native checks**. Its test process stopped and temporary profile data was removed. The normal user installation was then opened; saved profiles, pins, appearance, notification/default settings, workbench and action configuration were verified preserved. Private installation/backup paths and reports stay in excluded local records.
- GitHub build [37252957625](https://github.com/zeidlern/NerdSSHell/actions/runs/37252957625) stopped at source-artifact upload because the account's artifact storage quota was full, before functional tests ran. Audit [37252957562](https://github.com/zeidlern/NerdSSHell/actions/runs/37252957562) reports one high build-time http-cache-semantics advisory (a different current count from the historical eight propagated findings). Gitleaks passed. These are unresolved GitHub gates; no check was disabled, old artifact deleted or paid quota change made. PR #14 remains unmerged. Local installation completion does not waive the public-release/signing gates.

#### GitHub payment retry and dependency audit repair — October 4, 2026 Chicago

- After the owner completed the GitHub account payment, rerun of build 37253930783 uploaded the source artifact successfully and passed Linux source/unit and eight disposable SSH integrations, then began Windows validation. The earlier quota failure remains historical evidence.
- The separate audit still flagged build-only http-cache-semantics 4.2.0. A targeted lockfile update selects compatible 4.3.0 within cacheable-request's existing ^4.0.0 range. Only that package's version, registry tarball and integrity change; incidental npm peer metadata churn was discarded. No overrides, forced upgrades or audit suppressions were added.
- Fresh complete-lock audit reports zero vulnerabilities; source check and **725/725 Windows regressions pass**, zero failures/skips. SPDX inventories were regenerated. Product version stays 0.1.11 because this changes a development/build dependency rather than shipped application behavior. The installed artifact and its historical acceptance/hashes remain unchanged.
- The corrected commit requires its own GitHub audit/build/native validation before merging. Original retry/native results are not reused as acceptance of the updated lockfile.

#### Native spelling fixture readiness follow-up

- Corrected-lockfile CI at 73e4130 passed **702 Linux tests**, **8 SSH integrations**, **725 Windows tests**, package/native administrator verification and **166 packaged UI checks**, while the separate native spelling fixture failed to receive suggestions. The overall build remains failed at that checkpoint; audit and secret scan are green.
- The archived screenshot shows the synthetic typo without a spelling marker. The fixture moved away from its first paragraph after a blind 300 ms, while Chromium initializes Windows language/checker state asynchronously. That creates a plausible cold-start race; absent native provider support remains a distinct diagnostic possibility until the corrected CI run establishes behavior.
- The excluded fixture now keeps the first paragraph until a real native context-menu suggestion arrives, with a bounded readiness loop and occasional genuine space/Backspace edits on its owned synthetic text. It then retains the original syntax-overlay, frame, exact correction, undo, stale focus and no-network assertions. Failure diagnostics include provider preferences, dictionary events, native context and selection; no CDN fallback, global OS setting, application/runtime or version change is introduced.
- The corrected fixture passed **10 local Windows native checks**, no external attempts/downloads; source and **725/725 Windows tests** passed. A fresh GitHub run must evaluate the correction. Passing unrelated packaged checks is not substituted for native spelling acceptance.

### Favorite buttons and logo-blue defaults — 0.1.10

The completed UI/Workbench repair merged through [PR #12](https://github.com/zeidlern/NerdSSHell/pull/12) as `59a9423c66031e08004461c0b7a8d96da0e7a45a`, after [build 37161211649](https://github.com/zeidlern/NerdSSHell/actions/runs/37161211649) passed 676 Linux tests, eight SSH integrations, 699 Windows tests and 162 CI packaged UI checks. Its installed main build passed package verification, 152 local installed UI checks and saved-theme/data preservation. The following scripts-only acceptance follow-up addresses a later post-merge fixture failure; shipped/runtime bytes and version stay unchanged.

- Baseline `43380cf92bdc1fc7d23c18e399cca40905ffa11b`; working branch `codex/favorites-buttons-logo-blue`.
- Favorites become native buttons in saved order with horizontal scrolling, a separate offline Configure Favorites button, disabled unavailable commands and captured-session/generation safety. Actions remain a dropdown. Input locks, arguments and the existing same-session ordered dispatch are preserved.
- `ui/appearance.js`, initial CSS and Preferences use the canonical wordmark's `#00aaf0` accent. Terminal cursor/selection and scratchpad selection follow that accent. Explicit saved accents, backgrounds, text and ANSI/indexed palettes remain intact. The owner explicitly requested the new accent for this machine's saved appearance; that local-only preference update preserves every other setting.
- Package/root lockfile version advances to 0.1.10; visible/build/installer version derives from the canonical package metadata. No authentication, IPC, remote session, native provider or application/data identity changes.
- The packaged Workbench failure was a real preexisting renderer race, reproduced deterministically against both current code and accepted `43380cf`. An old queued dialog close invalidated a new destination request during asynchronous context IPC. `ui/workbench.js` tracks only pending reopens requested while closed, clears that marker before visibility/on completion, and revokes old approval immediately on new open. Explicit Close/Escape still revoke/cancel pending switches. The sharing fixture preserves all Unknown/disabled assertions and adds a real same-turn native close/reopen check; no fixture sleep or assertion weakening is used. The merged candidate remains 0.1.10 as requested, with no existing public release/tag replaced.
- Focused appearance/Preferences checks: **27/27 Windows passes**, zero failures/skips, including canonical-logo/default consistency and persisted custom-palette/legacy-accent preservation. Favorites/session-command checks: **54/54 passes**, including five added stale/disabled/double-click/keyboard/argument regressions. Final Workbench UI regressions: **24/24 passes**, including the old queued close during delayed IPC, deliberate Close/Escape, superseded hidden requests and failed-context cleanup. `npm run check` and all **699 Windows tests** pass, zero failures/skips. Real Chromium UI passes **32 checks**, no JavaScript errors/external requests, including 32-button overflow, keyboard reachability and blue defaults at 900×600. NSIS build, version/branding/native hashes/fuses/ASAR integrity/containment and ten exact dependency notices pass. The corrected real packaged renderer/IPC/ConPTY fixture passes **152 checks**, including the same-turn native close/reopen regression, original-pane Favorite execution, PS5/PS7/CMD Unicode, resize/editing, history and natural exit. The green PR validation and installed clean-main package are recorded above; the owner-approved saved accent changed only that one field and preserved the complete terminal palette/other settings. The later CMD fixture synchronization and its validation are recorded below.

#### CMD geometry acceptance synchronization follow-up

- Post-merge [run 37161822773](https://github.com/zeidlern/NerdSSHell/actions/runs/37161822773) passed the Workbench native queued-close regression, unit tests, NSIS/package verification and exact-ASAR native checks, then failed the CMD `mode con` split-size assertion.
- The fixture's blind 300ms wait happened before `v.render` drained. A delayed LOCAL fit can finish afterward and schedule the separate 120ms production native-resize timer; a single early `mode con` prints the old native size, which does not change when the actual resize later succeeds. A deterministic harness using the real fit/scheduleResize functions establishes this ordering defect. The original CI evidence omitted its actual CMD dimensions, so the exact failed native values are not independently claimed.
- `waitForLocalGeometry` consumes the production animation-frame/render phases, captures the current bounded terminal and host geometry, then observes existing ordinary-local discovery metadata. The pane record is updated after the production native `setWindow`; identity/generation/token, render and geometry are rechecked across the IPC read. It does not call `api.resize`, force a fit, inject cursor replies, retry `mode con`, or clamp/loosen expected dimensions. The exact native Columns/Lines assertion remains. Bounded geometry/output diagnostics preserve future failure evidence.
- A first observer experiment incorrectly required a fresh fit proposal to equal the fitted terminal. The actual packaged DOM renderer produced 90 columns while proposing 91: rounded canvas/cell metrics can create a 90/91 two-cycle for the same host. The proposal is therefore diagnostic only; production render completion and exact native readback establish the acknowledgment. A regression reproduces the renderer's rounding arithmetic and still rejects stale native dimensions.
- Ten regression tests cover delayed rendering/native acknowledgment, queued layout frames, rounded renderer metrics, stale view/generation/session identity, host/geometry changes during IPC, invalid/foreign/bounded metadata and exact geometry. `npm run check` and all **709 Windows tests** pass, zero failures/skips. The real installed NerdSSHell 0.1.10 passes all **152 packaged checks**; its single native `mode con` query reports exactly **90×41**, matching the acknowledged production resize while the rounded fit proposal remains 91×41. GitHub validation is recorded at the next checkpoint. No app/runtime/IPC/native/storage/packaging code or version changes are included.

**Local installation repair, October 3:** the accepted main failed two unelevated native broker fixtures on a workstation with sandbox write grants on Temp ancestors. Authentication and native integrity passed; ancestor ACL validation correctly rejected that test location. [The repair record](WINDOWS-BROKER-FIXTURE-REPAIR.md) documents the isolated child-only Temp setup, unchanged production/security code, regression coverage and current continuation evidence. Version stays 0.1.9 because this repair changes excluded test/acceptance scripts rather than shipped behavior.

## Starting point and branch coordination

- Working branch: `feat/nerdsshell-evolution`.
- Fixed baseline: `28b7b70cd997c205fdb2c55d614660e7b855138f` from `feat/windows-command-workbench` (draft PR #9).
- Main's branding source commit: `69f86f1fc5444263fe805791054461a238cfbec3`; integrate its unchanged source artwork with the finished brand assets.
- The owner reports Codex has finished its PowerShell fixes and authorizes including them in these builds and merging completed branches into clean main. The published completed compatibility correction is already in baseline `28b7b70`, retained by ancestry. The handoff separately identifies provisional Astra resize work; the latest combined native acceptance must evaluate that behavior. No unpublished commit is presumed.
- Baseline `docs/ASTRA-HANDOFF-2026-10-03.md` reports a separate provisional PowerShell 7 resize/editing problem. Keep the strict default native checks and report their actual result; completed PSReadLine compatibility and provisional resize behavior are distinct.
- Current product version at start: **0.1.0**.

## Implementation sections

1. **Foundation and checkpoint:** inspect architecture, capture mission, establish patch-version rule and isolate the branch.
2. **Preferences and commands:** categorized Preferences; explicit draft/Save/Cancel; common command submission into the originating terminal; Favorites configuration shortcut; preserve Layout controls.
3. **Local sessions and navigation:** Command Prompt + Administrator using existing ConPTY; shared local session navigation; honest local close consequences; no local Disconnect; Scratchpad first; compact launchers; remove footer; tmux explanation; LOCAL/REMOTE badges.
4. **Waiting for input:** bounded parsed-screen semantic evidence; prompt stabilization and event deduplication; no inactivity-only detection; independent session indicators; native attention and sound; acknowledgment/resume cleanup; preferences.
5. **Branding and compatibility:** theme-appropriate nerd/glasses assets, multiresolution ICO, native/installer/window branding, visible NerdSSHell name/tagline, stable application ID and data directory.
6. **Integration and delivery:** focused regressions, full source/unit gates, disposable SSH integration where available, packaged Windows CI, updated README/build/install instructions and recovery record.

## Progress

### Foundation — complete

- Materialized the exact baseline tree and SHA-verified all 135 source files.
- Created the working branch on GitHub without moving main or Codex's branch.
- Read the repository instructions, architecture and existing acceptance context.
- Installed the locked dependencies with lifecycle scripts disabled for Linux validation.
- Baseline `npm run check`: passed.
- Baseline `npm test`: **538 passed, zero failures or skips** (Linux, Node 24.19.0). Windows-only cases are conditional and are not represented by this count.

### Preferences persistence foundation — complete

- Added validated notification settings and defaults for new connections while retaining existing profiles and settings schema.
- Added one-transaction Preferences persistence with rollback on failed writes.
- Five focused regressions pass: legacy data preservation, one-write saves, invalid-section rollback, simulated disk failure, and bounded settings validation.
- This is a backend checkpoint; the new Preferences UI remains in progress. Version remains 0.1.0 until the first complete user-facing section.

### Waiting detector and native coordinator — complete modules

- Implemented a bounded parsed-screen detector and native notification coordinator, independently testable before the UI integration checkpoint.
- Handles semantic prompts, shell-idle exclusion, one-shot attention, per-session state, queued alert coalescing, stale event rejection and snapshot-safe pause/resume.
- 27 focused real-xterm/state/native-notification tests pass with no failures/skips; native Windows toast presentation remains for Windows acceptance.
- Full module behavior and known inference limits: `docs/WAITING-FOR-INPUT.md`. UI/main wiring is still in progress at this checkpoint.

### Integrated workspace — implemented, version 0.1.1

- **Preferences:** `ui/app.js`, `ui/index.html`, `ui/preferences.css` and `ui/pane-actions.js` provide seven categories with a shared draft. `src/preferences.cjs`, storage and main IPC validate and save all sections atomically. Existing profiles retain their overrides; new defaults do not rewrite legacy settings on load.
- **Actions/Favorites:** `src/session-commands.cjs` binds opaque command targets to the exact connection, client, view, snapshot and shell stream. Main resolves saved action IDs against the actual OS/shell and enters the existing input queue once. Pane menus execute in place; required arguments stay inline. Stale/disconnected/locked targets are rejected. The separate workbench keeps its review semantics.
- **Local shells/navigation:** `src/local-remote.cjs`, `src/elevated-pty.cjs`, `src/elevated-console.cs` and workbench metadata add fixed-path normal/elevated CMD through the existing provider. Sidebar/tabs handle local sessions, typed badges, compact launchers and close consequences. Existing PowerShell reflow implementation was not changed. Administrator CMD uses its supported default directory; an explicit picked directory is rejected before UAC.
- **Waiting/attention:** parsed xterm evidence, stable prompt events and accepted-input tokens are wired into each view. Snapshots/recovery suspend and resume detection without inventing fresh prompts. Generic native notifications carry session identity only. Settings and focused-session suppression apply to audio, native attention and visual indicators. Focused coverage now contains 33 tests, including real xterm shell-adjacent prompts and automatic terminal replies.
- **Branding:** all ten original PNGs were retrieved and SHA-verified unchanged. `src/branding.cjs`, `ui/branding/`, production masters/wordmarks, deterministic generation and `scripts/Verify-Branding.cjs` provide light/dark/native assets. Packaging applies icon/product/version resources while leaving signing disabled for experimental candidates. Stable package/app/data identity remains intact.
- **Documentation/build:** current README, feature guides, CHANGELOG, SPDX inventories and exact-version install helper were updated. Source checks enforce synchronized package/lock versions and branding; packaged verification checks actual PE icons and product/version resources.

### Current validation

At [`e66be29`](https://github.com/zeidlern/NerdSSHell/commit/e66be293c31978922bf754c610a230e850ac9ef3), [run 37149968742](https://github.com/zeidlern/NerdSSHell/actions/runs/37149968742) passed source checks, **659 Linux tests**, **8 SSH integrations**, **681 Windows tests**, NSIS packaging and package verification. The exact-ASAR native provider/security/lifecycle and strict PS5/PS7 resize/editing gates passed, as did **160 packaged UI checks**. Runtime source remains `088da1b`; the fixture corrections preserve production guards. Exact artifact identity and scope are recorded in `docs/ACCEPTANCE-RESULTS.md`.

The complete locked dependency audit remains **8 high** in the build-time `http-cache-semantics` chain; this release gate is not waived. Real UAC/alternate-account consent, native file/color pickers, GUI-driven transfer bytes, physical Windows toast/taskbar/audio presentation and clean-user installation remain manual acceptance. The installer remains unsigned.

### Earlier validation checkpoints — historical

The following results and pending statuses describe their named checkpoints, not the current candidate.

The fixture follow-up at `1ab23b1` / [run 37149513654](https://github.com/zeidlern/NerdSSHell/actions/runs/37149513654) passes **659 Linux tests**, **8 SSH integrations**, the history secret scan and **680/681 Windows tests**. The real protected PS5 startup/PSReadLine/SaveNothing fixture passes; native paths confirm the Windows runner's short-name alias. The remaining ACL fixture is being isolated so directory permission mutations cannot affect its file test. Runtime source remains `088da1b` / version **0.1.9**; package and strict administrator resize acceptance are pending.

At `088da1b` / [run 37148635560](https://github.com/zeidlern/NerdSSHell/actions/runs/37148635560), **659 Linux tests**, **8 SSH integrations** and the history secret scan pass. Windows compiles the new provider and passes **679/681 tests**. The controlled ACL fixture fails its direct temporary-path comparison, and the raw PSReadLine fixture lacks a terminal to answer actual modern ConPTY cursor queries. A fixture-only 0.1.9 follow-up canonicalizes its owned paths and uses real xterm automatic replies while preserving production guards and assertions. Package and strict administrator resize acceptance remain pending.

Version **0.1.9** implements the shared pinned administrator provider. The broker and authenticated helper independently verify bounded native bytes against literal hashes. Production staging atomically creates its directory and both files with BA ownership and explicit protected BA/SYSTEM permissions, pins paths/handles, rejects reparse/unsafe paths and ACLs, restricts DLL lookup, and bounds cleanup to owned files. OpenConsole inherits a protected current directory and System32-only PATH; the original shell environment is restored before shell creation. Same-module create/resize/release/close operations retain job ownership and output drainage. The exact-ASAR fixture checks the actual loaded pair, token-dependent staging root, owner/ACLs, cleanup and unchanged strict PS5/PS7 resize/editing behavior. New native adversarial cases reject altered/truncated pairs, source junctions, user-owned production stages and untrusted ACLs. Initial source checks and **659 Linux tests** pass; final native compilation/security/lifecycle and package acceptance remain pending.

The 0.1.8 workflow-only follow-up at `78b4e43`, [run 37147100566](https://github.com/zeidlern/NerdSSHell/actions/runs/37147100566), passes the **complete 160-check packaged UI**, including all three strict resize/editing cycles for both PS5 and PS7. Source, **658 Linux tests**, **8 SSH integrations**, **674 Windows tests**, packaging, verification and raw bridges pass. The independent system-ConPTY check remains failed, so the overall job correctly remains failed. This establishes the ordinary-provider benefit before the 0.1.9 administrator-provider change. The latter's implementation and validation remain in progress.

Version **0.1.8**, at `c889267`, passes source checks, all **658 Linux tests**, **8 SSH integrations**, **674 Windows tests**, NSIS packaging, complete package verification and the existing exact-ASAR CMD/PS5/PS7 bridges. A fresh browser fixture passes **28 checks** with no JavaScript errors or external requests. The new no-UAC system-ConPTY/xterm gate fails PS5 resize cycle 1: the native repaint puts the prompt at row 20 while PSReadLine 2.0.0 redraws input at row 36. The ordinary packaged UI was skipped after that failure. A diagnostic-only workflow follow-up lets both independent native fixtures run after successful package verification; failures continue to fail the job. The system-provider correction and ordinary UI result remain pending.

Version **0.1.7**, at `664661c`, passed **659 Linux tests**, **8 SSH integrations**, all **675 Windows tests**, NSIS packaging, full package verification and exact-ASAR CMD/PS5/PS7 bridges. The strict UI still failed Windows PowerShell editing after a resize round trip. Actual DSR/CPR traffic reported one-based row 30 and ConPTY positioned there; PSReadLine then redrew at row 36. The 0.1.8 correction addresses the provisional frontend prompt movement and retains the original native assertions. See the acceptance record for exact trace and source evidence.

Version **0.1.6**, source [`ede1f02`](https://github.com/zeidlern/NerdSSHell/commit/ede1f02361f42fba004fbee16bab8484400c89eb), has these actual results from [build run 37144213163](https://github.com/zeidlern/NerdSSHell/actions/runs/37144213163):

| Gate | Actual result |
| --- | --- |
| Linux source checks and unit tests | Passed; **659 tests**, zero failures/skips |
| Real SSH/tmux/SFTP integration | **8 passed**, zero failures/skips |
| Windows source and unit/native tests | Passed; **675 tests**, zero failures/skips |
| Native protected Windows PowerShell startup | Passed with inherited PS7 paths; protected WinPS PSReadLine 2.0.0, SaveNothing and owned cleanup verified |
| Native ordinary and broker-fixture CMD | Commands, Unicode, grouped input, output tails and all owned transport cleanup passed |
| Windows NSIS build | Built `NerdSSHell-0.1.6-x64-Setup.exe` |
| Packaged verification | Branding/version, legacy compatibility identity, native hashes, fuses, ASAR integrity and JS containment passed |
| Exact-ASAR native CMD/PS5/PS7 bridge | All passed; Unicode, multiline, resize, Ctrl+C, history mode and final output verified as applicable |
| Full packaged UI smoke | **128 checks passed**, then Windows PowerShell resize cycle 1 failed at fresh editing before Enter; overall result remains failed |

The failed UI check showed the prompt on zero-based row 30 after a narrow/wide round trip, followed by PSReadLine output targeting row 36. The application stayed connected and accepted input, but displayed that input below the prompt. Version 0.1.7 pins the upstream terminal provider containing demand-driven cursor synchronization and preserves strict default acceptance. The provisional renderer arithmetic remains unchanged for this first native trial; the provider update is not declared a fix until the new candidate passes.

The Linux and Windows test counts differ because Windows-only native cases are conditional. The four lifecycle regressions cover paused tail drainage, quiet close, pre-readiness cancellation and sibling isolation. Subsequent cases cover OSC/CUP boundaries, fragmented startup output and captured early-output socket cleanup.

The existing real Chromium app/xterm fixture passed **28 checks** against the version 0.1.1 UI, with no page errors or external requests. It covers seven Preferences categories, atomic Save/Cancel, Favorites deep links, original-pane Actions, local navigation, all layouts, idle exclusion, waiting/resume, light/dark branding and 900 × 600 geometry. Its in-memory bridge does not establish native acceptance. These later checkpoints change console startup/cleanup rather than that tested UI.

Production branding has 25 verified outputs and nine ICO frames; all ten original concept PNGs are unchanged. Re-export preserves the manifest, and light/dark assets and browser screenshots were inspected visually. Adversarial coverage includes atomic rollback, foreign-sender IPC, stale command targets, ordered input cancellation, administrator ownership, independent attention and tampered/stale Windows resources.

Earlier Windows failures and their exact corrections are preserved in `docs/ACCEPTANCE-RESULTS.md` and CHANGELOG: generated SVG checkout line endings (0.1.2), owned DLL worker cleanup (0.1.3), OSC titles (0.1.4), and early-output socket/CUP prompt handling (0.1.5). No Windows pass was inferred from a Linux result.

The fresh full dependency audit remains **8 high**, propagated from unpatched build-time `http-cache-semantics` ([GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)); these packages are absent from the production subset. The gate is not waived. Full reachable-history Gitleaks passed at `664661c`; CodeQL is skipped under the existing private-repository gate. Real UAC/alternate-account consent and physical Windows toast/taskbar/audio presentation remain native acceptance items.

### GitHub checkpoints and coordination

- [PR #10](https://github.com/zeidlern/NerdSSHell/pull/10), `feat/nerdsshell-evolution`, is the integration delivery record for the completed work. Published branch ancestry was verified as recorded below; GitHub records the PR merge status.
- `c20e7ed`: mission, recovery log and versioning rule; 538 baseline tests.
- `ab37eb7`: atomic Preferences persistence foundation plus unchanged main branding source; 543 tests.
- `1bd1992`: standalone waiting detector/native coordinator; 570 tests.
- `0b3512f`: complete version 0.1.1 workspace integration; 642 unit tests, 28 browser checks and eight real SSH integrations.
- `648e51f`: version 0.1.2 canonical Windows branding checkout; 642 local tests and a passing Windows source check. Its Windows unit/native step stalled, prompting the owned DLL transport cleanup investigation.
- `d82586b`: version 0.1.3 owned ConPTY DLL cleanup; 646 local tests and a normally exiting Windows test process, with three native/parser failures retained for correction.
- `fadc120`: version 0.1.4 preserves visible output across terminal titles; 649 local tests and eight GitHub SSH integrations passed. Windows passed 662/664 tests, leaving the pre-output socket and bridge cursor-position prompt boundary failures for version 0.1.5.
- `ce85098`: version 0.1.5 passed all 668 Windows tests and exact-ASAR CMD; its subsequent PS startup failure was diagnosed without waiving guards at `af92c38`.
- `ede1f02`: version 0.1.6 passed all 675 Windows tests, installer/package validation and exact-ASAR CMD/PS5/PS7 bridges. The broader UI passed 128 checks before the strict Windows PowerShell resize-cycle editing failure.
- Version 0.1.1 is the first complete UI integration checkpoint. The preceding commits deliberately kept 0.1.0 because they were independently tested backend foundations.
- At 2026-10-03 17:06 UTC, the GitHub ancestry audit found every visible branch tip already contained in this integration branch: main `69f86f1`, workbench `28b7b70`, dependencies `931d7c0` and copy/colors `f79d9ae`. The dependency and copy/color branches were already merged into main. No separate replay is needed.
- At 2026-10-03 17:36 UTC (12:36 PM Chicago), Codex's branch and PR #9 were still at `28b7b70`. Re-reading the handoff clarified that this commit already contains the completed PSReadLine compatibility correction; its separate provisional resize work was paused for Astra. The earlier assumption that another unpublished commit was necessary was unsupported. All published Codex work is included by ancestry. After the current combined candidate passes functional/package acceptance, one normal PR #10 merge incorporates all completed branch work without rewriting history.

## Architectural decisions

- Keep Electron's existing internal application ID, IPC/protocol namespace and data compatibility. Rebrand the user-facing product deliberately.
- Retain `MixedRemote`/`LocalRemote` and existing stable session identities. Local shell family and administrator status are metadata, not inferred from UI labels.
- Preferences persist appearance, notifications, defaults for new connections and Action/Favorite configuration in one validated Save transaction; Cancel restores the saved preview. Existing connection overrides remain intact.
- Actions/Favorites share a stable-target command injection path with ordinary terminal input. Do not replay across disconnect/reconnect or create a task console from a pane menu.
- Waiting detection consumes xterm's current parsed screen/cursor state with stable semantic prompts. Silence alone is not a signal. Alerts carry generic session identification, never terminal transcripts.
- Preserve the source branding artwork. Document production asset names and conversions; package only the small runtime asset set.

## Test and integration notes

- Test actual feature behavior and target isolation; update assertions for intentional product changes without weakening unrelated safety invariants.
- Run source checks and unit tests before coherent checkpoints. Native process/elevation/packaging changes need Windows validation; record available versus pending evidence explicitly.
- Do not reuse historical installer hashes or test counts as validation of the new product.

## Remaining acceptance and delivery

Complete the documented manual Windows checks, including UAC/alternate-account consent, native picker/transfer interaction and physical toast/taskbar/audio presentation. Investigate the eight high build-dependency findings; signing, licensing, privacy and reporting remain separate release gates. PR #10 is the integration delivery record and its GitHub status records the merge. Preserve the accepted runtime/artifact identity; no-UAC fixtures do not establish consent acceptance.
