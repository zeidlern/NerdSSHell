# BetterSSH paused checkpoint for Astra

October 3, 2026 Central. The owner explicitly paused development and requested that all current source work and this handoff be committed and pushed before starting a new Astra chat. This is a **work-in-progress checkpoint, not an installable or release-ready candidate**.

## Repository and installed application

- Continue on `feat/windows-command-workbench`, PR [#9](https://github.com/zeidlern/NerdSSHell/pull/9), draft and unmerged. Do not switch to or merge main.
- Baseline before this checkpoint: `5c44544b8ab5e4247c979e33b1edb9a87eae7b96`. Main was independently read back as `75b65daedbe2526520bf47ab4ddcc25ba4aa94a8` during this continuation.
- The installed application remains the earlier `5c44544` build. No installation, source push, production command, global configuration change, release or session termination occurred during the debugging phase. The owner's subsequent upload request authorizes publishing this paused source checkpoint.
- Existing profiles, private backups, credentials, terminal archives, diagnostic logs and build artifacts are excluded from this commit. They are not missing source work.
- Read `AGENTS.md`, `README.md`, `SECURITY.md`, `docs/SECURITY-REVIEW.md` and `docs/PUBLIC-RELEASE.md` before resuming. Persistent disconnect/close/quit must not terminate work; discovery/reconnect must not launch jobs. Keep host verification, explicit Standard closure consequences, stable identity and no disconnected-input replay intact.

## Completed compatibility correction

The baseline Windows CI failed the retained PSReadLine `SaveNothing` gate. Windows PowerShell 5's stock module can reside in the protected Program Files module folder rather than the shell's `$PSHOME` bundle.

Both bootstraps now prefer the shell bundle, then only for Windows PowerShell 5 use the fixed Program Files fallback. They prefer a flat manifest or select the highest numeric version from at most 32 immediate folders. Reparse-point roots, versions and manifests are refused/skipped as implemented. Import uses an absolute manifest and qualified `Import-Module -Force`; it does not search user `PSModulePath`, install modules or change profiles/execution policy.

History disabling is separate from optional `-Colors`, so legacy parameter rejection does not prevent `SaveNothing`. The administrator bootstrap additionally verifies the loaded location and setting and fails startup on unexpected loaded modules or history setup failure. Ordinary bootstrap failure may leave an ordinary shell without this setup; do not promise universal history confidentiality.

Files: `src/local-powershell.cjs`, `src/elevated-console.cs`, `test/ux-desktop.test.cjs`, `scripts/Elevated-Console-Smoke.cjs`, `scripts/PSReadLine-Assertion.cjs`, and both packaged shell smoke scripts. The assertion helper is required source, not a private local file.

Actual no-UAC native tests passed for Windows PowerShell 5 and PowerShell 7 with protected modules and `SaveNothing`, Unicode, resize, Ctrl+C, natural exit/final output, stdin EOF, oversized frames and broker death during input/output backpressure. Those runs inherit their runner token; they do not prove native UAC or an administrator token.

## Remaining blocker: resize and editing correspondence

The original Windows PowerShell 5 failure appeared after widening a pane: ConPTY emitted a fresh prompt, but xterm's physical cursor row retained stale text. Read physical `baseY + cursorY` rows rather than only the joined logical transcript.

The pending implementation adds `ui/local-terminal.js` and serializes LOCAL fitting through `v.render` in `ui/app.js`. It uses public xterm markers to measure visible row deletion/insertion, then bounded frontend-only row resizing to adjust the viewport/history boundary. Only final dimensions reach the backend. Normal SSH fitting remains separate.

Guards cover normal buffer, no origin mode, full scroll region, blank rows below the cursor, pending-wrap exclusion, bounded marker counts, and ConPTY backend. Temporary options/rows and markers are restored/disposed. It inserts no VT bytes: an earlier synthetic-escape correction corrupted split OSC output and was replaced after an adversarial test found that defect.

**This correction is still provisional.** Windows PowerShell passes all three strict repeated narrow/wide cycles including before-Enter editing placement. PowerShell 7 still fails a subsequent editing cycle in default configuration. A clean prompt after a command is insufficient to prove the next command will be drawn on that row.

The helper currently has a fourth `preservePartialTop` argument, enabled by the renderer for `local:pwsh` profiles including administrator variants. It packs public cell widths for a partial wrapped group at the viewport top to estimate screen reflow separately from the history prefix, in both directions. Applying that estimate universally regressed Windows PowerShell; scoping it to PowerShell 7 improved one cycle but did not produce a complete default native pass. **Do not treat this shell-specific distinction or the inferred partial-group algorithm as an established root cause. Astra should challenge or replace them.**

The new `test/local-terminal.test.cjs` exercises actual installed xterm 6 without a DOM. Its 39 tests cover history, limits, Unicode/colors, saved cursor, split OSC/CSI/DCS, repeated cycles, region/alternate/origin/pending-wrap guards, overflow blank consumption, partial top groups, error restoration, output ordering, generation/identity and final backend geometry. Some expected native correspondence was inferred during debugging; these passing tests do not establish that the native model is correct.

## Discriminating evidence and unfinished probes

Native versions inspected here: Windows PowerShell protected PSReadLine 2.0.0; PowerShell 7 bundled PSReadLine 2.4.5. Ordinary LOCAL uses node-pty's bundled ConPTY DLL (observed version 1.23.2510.08001); the administrator helper uses system ConPTY. The OS build alone does not describe both backends.

| Probe | Actual result |
| --- | --- |
| `windowsMode=true` test override | Original PS5 cursor gate still failed. Reflow disabling alone is not a fix. |
| Earlier widening-only correction | Original prompt/Ctrl+C gate passed and 128 checks passed; later before-Enter checks exposed additional defects. This is superseded evidence. |
| Bidirectional correction with bounded blank-row consumption | PS5 strict cycles passed; PWSH still mispositioned editing. |
| Current partial-top correction in both directions, default configuration | PS5 three strict cycles passed; PWSH cycle 2 failed before-Enter editing placement. |
| PWSH process-local `PredictionSource None`, current helper retained | All strict cycles passed: 140 packaged checks. This was an explicit test-only override, not a default candidate pass. |
| Same prediction override plus disabling partial-top handling | PWSH cycle 1 failed. Removing the partial-top adjustment is not established as a simplification. |

Production prediction settings were **not changed**. `BETTERSSH_SMOKE_NO_PREDICTION` and `BETTERSSH_SMOKE_NO_PARTIAL` remain test-only probes in the local smoke. Preserve them as diagnostic evidence until reviewed; do not advertise override runs as default acceptance. An unrelated Actions-sharing fixture run also timed out before reaching local testing; it does not establish a cursor cause.

Representative PWSH trace before the bounded shrink correction: wide `baseY=16, cursorY=30`; narrow `baseY=39, cursorY=30` although nine visible wraps exceeded eight available blank rows. Consuming eight blanks yielded narrow `baseY=31, cursorY=38`. A grow then put the displayed prompt at row 25 while PSReadLine edited at row 26. A partial-top estimate aligned one cycle, but the second default cycle still failed. The native raw CUP coordinates and displayed physical row are the discriminating evidence.

Relevant upstream analogies, not proof of this app's cause: [xterm #5319](https://github.com/xtermjs/xterm.js/issues/5319), [attempted fix #5321](https://github.com/xtermjs/xterm.js/pull/5321), and [revert #5358](https://github.com/xtermjs/xterm.js/pull/5358). The attempted reflow change was reverted after major buffer regressions. Do not transplant it or assume adding a modern build number fixes xterm 6.0.0. Modern PSReadLine also tracks cursor changes when dimensions return to their original size; see [v2.4.5 Render.cs](https://github.com/PowerShell/PSReadLine/blob/v2.4.5/PSReadLine/Render.cs).

## Final paused verification

- Required `npm run check`: passed.
- Required `npm test`: **551/551 passed**, zero failures/skips, normal Windows account. This is the final source-suite result at pause, superseding the earlier 535 count.
- Latest default strict packaged UI: **FAIL**, PWSH before-Enter editing placement on cycle 2. No default 140-check pass is claimed.
- Latest test-only prediction-off run: **140 checks passed**. A following prediction-off/no-partial probe failed on PWSH cycle 1.
- Both last probe harnesses completed and cleaned up their owned application and temporary data. No active fixture is intentionally left running.
- The latest Windows NSIS build succeeded. All **42** packaged source/UI files and runtime package metadata matched the paused source bytes.
- Latest local installer SHA-256: `b7256e6cd71781034e5d6128c8dd78f0bde5f6d8eda0ceb144795ddaafbb8162`.
- Latest local ASAR SHA-256: `067032c59130d98448ba23d71d92f27ac27a8791714fc4967ae3b6182897e6ee`.
- Installer remains unsigned and **not installed**. These local artifacts are excluded from Git and must not be treated as a verified upgrade.

The local `.local/packaged-per-pane/results.json` is overwritten per fixture and currently describes the failing no-partial probe, not the latest default run. The default failure is in `.local/resume-both-boundary-ui.txt`; the passing prediction-only probe is in `.local/resume-pwsh-no-prediction-ui.txt`; the failing simplification probe is in `.local/resume-prediction-simple-ui.txt`. More detailed physical traces are in `.local/resume-width-screen-trace.txt`, `.local/resume-bounded-shrink-ui.txt`, and `.local/resume-shell-boundary-ui.txt`. These logs are private local diagnostics and are not uploaded. Final check/test logs are `.local/astra-handoff-check.txt` and `.local/astra-handoff-tests.txt`.

## Resume without repeating the regression loop

1. Review the actual source and traces. Establish a complete ConPTY/xterm/PSReadLine resize model or a supported synchronization strategy before further incremental viewport patches. Question the inferred test expectations.
2. Keep the original fresh-prompt, interruption/no-completion-sentinel, fresh-input, Unicode and remote-identity gates. Also keep the newer before-Enter placement gates on every cycle. Do not weaken assertions to obtain a pass.
3. On this Windows machine, put the repository's `.local/bin` first on PATH for Node 24/npm 11. Native fixtures require the normal Windows account through tool escalation; the restricted sandbox account previously produced misleading module/interrupt failures. Do not elevate BetterSSH itself. Run only one packaged harness at a time because its report paths are shared.
4. After a supported fix, run check/tests, rebuild runtime changes, verify package/notices/source bytes, exact-ASAR native smoke, then default packaged UI with no probe flags. Inspect screenshots as well as assertions. Commands are in the resume prompt.
5. Check exact-head CI after the new checkpoint is pushed. The existing branch/PR may run failing packaged acceptance; that failure is expected evidence for this paused WIP, not a waiver.
6. Before any eventual local upgrade, check whether the installed app is open and ask the owner to save/finish LOCAL/Standard work and close normally if needed. Never kill user work. Read the private upgrade script before using it and bind it to a genuinely verified new commit/artifact. No installation is authorized merely by this paused checkpoint.

## GitHub, dependency and remaining acceptance boundaries

The prior PR description's current-head Windows CI wording was stale. An attempted metadata correction was rejected by automatic approval review because it judged the external destination/payload authorization insufficient. No workaround update was made. The owner later explicitly requested uploading this paused source and handoff; this document supplies the accurate current state independently of stale PR prose.

The eight high full-lock findings derive from the build-time `http-cache-semantics` advisory [GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp). No safe supported narrow upgrade was found: current released builder/get 3/4 paths retain the chain; get 5 removes got but is not a drop-in replacement for builder's timeout/proxy options. The upstream advisory had no patched version at review. No audit suppression, forced fix or blind downgrade was applied. Runtime audit evidence had zero findings; this does not clear the full dependency gate. Secrets scan passed at the older head; CodeQL was skipped, not passed.

Actual UAC approval/cancellation, alternate credentials and installed administrator-tab lifecycle remain unverified. Native file dialogs, clean Windows acceptance, unsigned distribution, licensing and history/privacy remain separate gates. Do not merge main, rewrite history, change visibility, select a license, configure paid signing, publish a release, or use production servers for destructive acceptance.

The Astra subagent was interrupted immediately when the owner requested this pause. It had not implemented a new diagnosis or fix. Start the new chat from this saved checkpoint; no background development is promised.
