# UX integration recovery checkpoint

Recovered from `e63b1e8398701e1334d83c822571e7428959675a` on `feat/windows-command-workbench`. Main and the installed application remain unchanged. The integrated source checkpoint `fcf2648779ff17242724f1cb49da702144304632` is committed and pushed; final acceptance follows below.

## Finalization checkpoint, October 2, 2026 Central

- Final Windows CI interruption failure was reproduced and addressed: LOCAL xterm now uses ConPTY row-growth compatibility, preventing blank/misplaced rows after pane growth. The native fixture observes fresh output instead of a stale prompt row, and proves cancellation through a single bounded reply plus absence of the 30-second sleep completion sentinel. Rebuilt package verification/notices, all **453 unit tests** and **124 actual packaged Windows checks** passed, including actual synthetic clipboard operations on both installed PowerShell versions. See the top of ACCEPTANCE-RESULTS.md for the final hashes and CI status. Earlier clipboard-unverified statements below are superseded by this authorized run.

- The latest clarified owner list explicitly removes Focus mode as well as its button. Its hidden mode, shortcut and title double-click are removed; active-session outlines remain. End Session is labeled directly, SFTP owns its pane, and About includes developer/project placeholders.
- Fixed two fixture problems without reducing assertions: the native file drag now uses trusted pointer input and verifies copy intent and immutable pane/browser/listing identity; the SFTP revalidation test waits for the actual selection/confirmation boundary before replacing the file and observes the rejection immediately.
- Fixed stale OS action rows during asynchronous configuration loading. The earlier iteration passed **450/450 tests**, with zero failures/skips; final results below supersede this count.
- Actual packaged Windows acceptance passed **108 checks**, using only pinned generated-key loopback SSH, synthetic commands and isolated temporary user data. Both installed Windows PowerShell 5 and PowerShell 7 verified real ConPTY, version, home, Unicode, resize, input lock, Ctrl+C interruption and final-output exit. The original four SSH fixture consoles retained identity throughout. This is local candidate evidence, not a pass for a future rebuild or all CI.
- The current offline Chromium fixture also passed with no page errors, external requests or terminal input. Existing ownership/cancellation/transfer/reattachment assertions remain.
- Fixed a delayed Actions dialog close that could cancel an immediate reopening. Final source/static checks and **453/453 tests** passed. Rebuilt package integrity/notices and **110 actual packaged Windows checks** passed, including both installed PowerShell versions. The focused security review is complete with 66 actual-main unauthorized IPC denials; see UX-SECURITY-REVIEW.md.
- Fresh runtime audit reports zero known advisories. Full lock audit reports eight high findings through the unchanged build dependency chain (see security gate below). Local OpenSSH integration discovered eight tests and skipped all eight because no disposable OpenSSH/tmux service is configured; these are not passes.
- Native UAC and OS file-picker interaction, clipboard acceptance on this PC, GUI-driven transfer bytes and clean-user installation remain manual gates. Default fixture does not read or replace the user's clipboard. No installed app, user settings, real server, main branch or release policy was changed.

Implementation is complete. Use ACCEPTANCE-RESULTS.md as the current evidence record and INSTALL-UX-CANDIDATE.md with the exact final handoff SHA for the next local upgrade. Remaining items are the explicit native/manual and release gates above, not unwired source components. Linux checkpoint CI passed all eight real integrations; final-head CI is reported separately.

## Earlier integrated recovery (historical checkpoint)

- Activated per-OS action configuration/custom actions/32 favorites, per-pane action dropdowns and horizontal favorites. Reviewed tasks bind the original view/session token/transport/persistence provider. Read-only OS inspection runs separately from terminal input.
- Activated dual-panel File SFTP, Local/Remote navigation/details/copy arrows/file drag-drop, local folder grants, immutable browser ownership and stale selection rejection. Exclusive transfer publication/overwrite confirmation remain.
- Activated the shared full-height resizable/collapsible scratchpad with inert Markdown/code highlighting, bounded UTF-8 Open, exclusive Save As and unsaved-edit quit protection. Notes stay in memory until explicit Save As.
- Activated launch-only administrator switch (Windows UAC in a separate console), trusted bundled PSReadLine input colors when available, and local tools above connections. No profiles, policies or privileged application broker are changed.
- Fixed disconnect/edit/delete/quit consent races when transports or nonpersistent consoles change during confirmation. New scratchpad edits during quit require renewed consent.
- `npm ci --omit=optional` succeeded; `npm run check` and all **449 tests** passed with no skips. New adversarial coverage includes exact binary/Unicode file transfer, collisions, cancellation, stalled local IO, token/view/transport swaps, save serialization, note races and settings preservation. The owner explicitly approved adapting the obsolete immediate-global-favorites test while retaining safety coverage.
- The Windows x64 build, fuse/ASAR/JS containment verification and 10 exact JavaScript license checks passed. Final native fixture iteration remains pending. Native ownership/geometry/overlap checks passed at 1920×1080 and 900×600 after fixing a real short-pane SFTP overlap.
- Two new real mixed OpenSSH/tmux integration tests are configured for disposable Linux CI. This Windows host has no such fixture; local skips are not passes.

At this historical checkpoint, the next steps were to finish the packaged fixture and record final evidence/installation instructions. Those implementation steps are now complete; the native/manual and release gates remain as described in the final record above. Do not install or merge automatically as part of this development mission.

The sections below preserve the earlier recovery history; their “not activated” descriptions are superseded by this integration checkpoint.

## Saved checkpoints

Follow-up owner request: the Layout dropdown is replaced by four dedicated native buttons for one window, two side by side, two stacked and four quadrants. One button has the active highlight and `aria-pressed` state; labels/tooltips include the preserved Ctrl+Alt+1/2/3/4 shortcuts. Dropdown references in the historical checkpoints below describe the earlier UI.

- `7f3e994675155579ebcdba8df0efb04b73c9dbc5`: empty persistent discovery now reconciles ended panes and does not invalidate Standard views. Exact checkpoint passed 380 local unit tests.
- `715bb6989e8f31b67d1039448473df7d375b4ca7`: session lifecycle controller captures connection/transport/token/view across confirmations, bounds pending dialogs and rejects duplicates. Mixed provider cleans Standard records before disconnect notifications. Exact checkpoint passed 394 local unit tests.
- Current source-activation checkpoint: main now uses MixedRemote; New Session chooses persistence (on by default); direct Rename/Disconnect/End controls; immediate ended-session removal; compact Layout dropdown; collapsible rail; dedicated ordinary PowerShell launch; File SFTP label and per-pane access; Cancel-right app dialogs; lavender/dark-gray defaults and About placeholders. Existing custom colors and legacy Standard profile startup are preserved. Fullscreen/focus remain keyboard conveniences, not toolbar buttons.

## Historical verification and next step before source integration

The combined local worktree passed 402 unit tests/static checks and 37 sandboxed Chromium UI checks, using actual bundled UI/xterm with synthetic IPC. That worktree ALSO contains updated test fixtures and native smoke scripts that are not included in this source-only checkpoint yet. Do not attribute the 402-test pass to this Git revision until those fixtures are committed and CI runs. Old fixtures assume Cancel-first numeric indices, fixed layout buttons and a StandardRemote constructor; these are being adapted without dropping their safety assertions. Native tests will explicitly create Standard fixture sessions rather than relying on the old server-wide default.

NEXT: commit the prepared regression fixtures, compact-ui tests, offline browser harness, two real mixed-SSH integration tests and updated/extended packaged Windows smoke. Run the resulting exact source revision. The native smoke must continue to preserve the original four SSH/SFTP channels and use only disposable loopback data. Native UAC and OS dialogs remain manual acceptance. No real user server was contacted.

## Security gate: blocked

Security run 37087264840, dependency job 111100039138, failed on GHSA-ch52-4w7c-c8xp (CVE-2026-93748), http-cache-semantics and its build-tool dependency chain through cacheable-request/got/@electron/get/app-builder-lib/electron-builder. The dependencies and lockfile were not changed by this UX work. The GitHub advisory updated October 2, 2026 lists affected versions <=4.2.0 and no patched version. It concerns shared HTTP caching; no SSH runtime exploit is established here. Do not suppress the audit, run audit fix --force, or blindly downgrade electron-builder. Resolve a supported dependency path separately before release. Gitleaks passed; CodeQL was skipped, not passed. See PR comment 5964265662.

Primary references: https://github.com/advisories/GHSA-ch52-4w7c-c8xp and https://www.electronjs.org/docs/latest/api/dialog (explicit button order and cancel/default IDs).

## Earlier source-activation limits (superseded above)

Per-OS action configuration/favorites, dual local/remote File SFTP, shared scratchpad, PSReadLine setup and administrator UAC launcher. Existing foundation modules remain saved but do not imply working features. Resume from docs/UX-REVISION-PLAN.md and this checkpoint, not a new research/rewrite mission. No main merge, public release, history rewrite, installed-app replacement, license/signing/access changes or production operations.
