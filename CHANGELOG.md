# Changelog

Versions advance for each meaningful completed user-facing section. The canonical current version is in `package.json`.

## 1.0.1 — Current identity and compatible upgrades

- Use package `nerdsshell`, Windows app ID `app.nerdsshell.desktop`, `nerdsshell` UI/IPC protocol and the NerdSSHell native bridge. Remove the personal-domain namespace from current metadata.
- Pin the original installer GUID. Resolve existing legacy storage before the single-instance lock; fresh users use the current folder. No saved data is moved, merged or deleted. Explicit isolated profiles remain supported; unsafe paths fail closed.
- Preserve existing persistent-session tokens/keys; new identities publish current and legacy markers with the same UUID, guarded against conflicts and concurrent assignment. Discovery/reconnect does not launch jobs.
- Use NerdSSHell in current UI, upload defaults, scripts, fixtures and current documentation. Retain explicit upgrade/data/session aliases and dated historical evidence.
- Actual source, adversarial, Windows/package/native and integration results are recorded in the implementation log. Installers remain unsigned candidates until separately signed and approved.

## 1.0.0 — First NerdSSHell release

- Finalize the repository and product identity as **NerdSSHell** while deliberately preserving the legacy `betterssh` package, app ID, IPC/resource scheme, data-directory and remote-session namespaces for upgrade compatibility.
- Include the completed Scratchpad word-wrap work from the 0.1.12 development checkpoint and update Electron from 44.4.5 to 44.5.1.
- Replace stale BetterSSH repository links and experimental-build wording with the current NerdSSHell repository/release identity.
- Publish clear source-available terms: official unmodified releases may be used for personal or internal business use; redistribution and derivative distributions require permission. Unsolicited code contributions are not currently accepted.
- Move post-1.0 development to semantic versioning. Historical 0.1.x validation records remain unchanged except for repository-link redirects.
- The Windows installer remains unsigned unless a specific release artifact is explicitly identified as signed; exact CI/security results for the release commit are recorded separately.


## 0.1.12 — Toggleable Scratchpad word wrap

- Add a keyboard-accessible Word wrap toggle, initially off. Wrap prose and long unbroken tokens to the pad width, with matching syntax-preview geometry through resizing and scrolling.
- Preserve note contents, literal line breaks, selection, spelling, and unsaved state. Keep the wrap choice when collapsing/reopening Scratchpad during the current app run.
- Validation is recorded in the implementation log.

## 0.1.11 — Smoother notes and movable terminal panes

- Show scratchpad typing immediately; refresh bounded, inert syntax highlighting after typing pauses. Keep IME composition visible and use native text for large or dense notes.
- Add local English spelling underlines and guarded right-click correction suggestions in Scratchpad, retaining native undo. Block external dictionary fallback; do not transmit notes or add words to the OS dictionary.
- Focus newly selected/opened sessions, including PowerShell and Command Prompt launches, without letting a stale/background open steal focus.
- Add a visible terminal drag handle. Swap occupied slots or move into an empty slot in either two-pane orientation or four quadrants; selecting a visible pane keeps its location. Save validated slot placement alongside existing workspace settings.
- Show the large theme-matched NerdSSHell mascot and prominent name/tagline in the responsive About screen. Preserve application/settings identity and session lifecycle safeguards.
- Patch the build-only http-cache-semantics lock entry to compatible 4.3.0; the fresh complete dependency audit reports zero vulnerabilities. Preserve all runtime dependency versions and the installed artifact.
- Validation and artifact identity are recorded in the implementation log.

## 0.1.10 — Favorite buttons and logo-blue accents

- Show each session's saved Favorites as keyboard-accessible buttons in a horizontally scrollable row. Keep a separate Configure Favorites control available offline; commands retain their existing session identity, input lock, argument and ordered execution checks.
- Match the default application accent and terminal cursor/selection to the canonical logo blue, `#00aaf0`, including initial CSS/Preferences defaults and scratchpad selection. Preserve explicit saved accents and ANSI/indexed terminal palette overrides.
- Fix a preexisting Workbench close/reopen race: a queued close from the old dialog can no longer cancel a new destination request awaiting IPC. New opens revoke old command approval immediately; deliberate Close/Escape still cancel pending work. Deterministic and real packaged native-dialog regressions preserve those boundaries.
- Source, regression and Windows package/UI validation for this version are recorded in the implementation log; historical 0.1.9 acceptance remains below.

## 0.1.9 — Shared terminal engine for administrator consoles

- Test-only workstation follow-up: isolate no-UAC broker Temp beneath a canonical protected profile root when ambient Temp ancestors have sandbox write grants. Preserve native ACL rejection and all shipped bytes; add unsafe-ancestor, bounded diagnostic and cleanup regressions. Installed-binary acceptance can opt into real UAC PS5, CMD and cancellation without using real profiles. See [the repair record](docs/WINDOWS-BROKER-FIXTURE-REPAIR.md).
- Use the same pinned modern ConPTY DLL and companion OpenConsole as ordinary consoles, with a separate protected staging and loading path in the administrator helper. The old system provider's repaint moved the prompt while Windows PowerShell 5 retained its previous editing origin.
- Retain fixed shell selection, protected PSReadLine identity and SaveNothing guards, authenticated owner pipes, and owned process/output cleanup. No module installation, profile edit, synthetic cursor reply or key injection is used.
- Preserve strict native resize/editing acceptance for the actual packaged terminal and both PowerShell versions. Source, native security/lifecycle, exact-package and **160-check packaged UI acceptance passed** at `e66be29`; exact results and artifact identity are in the acceptance log. Real UAC/alternate-account consent remains manual acceptance, and the eight high build-dependency findings remain an open release gate.

## 0.1.8 — Public terminal fitting with native cursor synchronization

- Replace provisional frontend row arithmetic with the public FitAddon inside the existing serialized LOCAL render queue. Remove the unused helper and scroll-region bookkeeping; preserve generation checks, output ordering, logical scrollback and backend resize routing.
- The 0.1.7 native trace confirmed that ConPTY received the correct cursor reply, then PSReadLine 2.0.0 redrew from an older saved origin. Public fitting preserves the prompt row across the reproduced width round trip while the updated provider queries the real terminal position.
- Retain strict default packaged PowerShell assertions and passive cursor diagnostics. Add a no-UAC system-ConPTY test using exact packaged xterm, with three resize/editing cycles, Unicode history, before-Enter checks and final output for both PowerShell versions.
- Replace only tests tied to the removed arithmetic with semantic coverage through the actual renderer fitting queue. Source checks and all 658 Linux tests pass; native acceptance of the complete correction remains required.

## 0.1.7 — Terminal provider cursor synchronization

- Pin the upstream node-pty 1.2.0-beta.15 provider and its matching ConPTY binaries to evaluate the supported resize cursor synchronization correction against the reproduced native PowerShell editing defect.
- Adapt the existing per-console owned-transport cleanup to the ConPTY-only provider, retain all final-output/early-close/sibling-isolation checks, and verify the exact packaged provider version and native binary hashes.
- Preserve the default PowerShell acceptance checks and provisional renderer behavior for the first provider trial. Passive fixture diagnostics observe actual cursor query/reply traffic; they do not inject terminal commands or waive failures.
- Version 0.1.6 passed all 675 Windows tests, installer validation and exact-ASAR CMD/PS5/PS7 bridge checks. Its full packaged UI passed 128 checks before detecting fresh Windows PowerShell editing six rows below the displayed prompt after resize. New native results must establish whether this provider correction resolves the defect.

## 0.1.6 — Windows PowerShell child environment correction

- Prevent Windows PowerShell children from inheriting the known PowerShell 7 installation/shared module directories. Filter a child environment copy, retaining unrelated Windows PowerShell and custom module entries and leaving the parent environment unchanged.
- Apply the correction to ordinary Windows PowerShell consoles and the fixed Windows PowerShell broker. Retain protected PSReadLine identity checks, SaveNothing verification and fail-closed administrator startup.
- The native diagnostic confirmed guard 05: Windows PowerShell 5 had auto-loaded PSReadLine 2.4.5 from the PowerShell 7 installation while the app selected protected Windows PowerShell PSReadLine 2.0.0. Version 0.1.5's tests/package/CMD checks passed; its original PowerShell failure remained a failure despite diagnostic probing.
- Add native protected-bootstrap coverage before packaging, and use the same packaged environment helper in exact-ASAR acceptance.

## 0.1.5 — Native startup and early-close correction

- Preserve the line boundary when the Windows console positions a prompt at the first column with CUP/HVP, so administrator CMD readiness does not depend on a literal newline after the banner.
- Close the captured owned output socket when a DLL-backed console is cancelled before its first output. Preserve natural and ordinary explicit-close drainage behavior.
- Version 0.1.4 Windows evidence: 662 of 664 tests passed. Ordinary CMD executed the multiline, Unicode, quoting, continuation, grouped-command and exit-tail checks; natural and quiet-close transports terminated. The remaining failures were the pre-output socket and bridge cursor-position prompt detection addressed here.
- Windows validation of `ce85098` passed all 668 tests, built and verified the package, and passed the exact-ASAR CMD bridge checks. PowerShell bridge startup then failed before its first prompt; bounded failure-only diagnostics investigate the unchanged compatibility bootstrap without relaxing its checks.
- Handoff review confirmed that Codex's completed PowerShell compatibility changes are already in the baseline. The previous assumption that another unpublished commit was needed is withdrawn; merge the published combined work after functional/package acceptance.

## 0.1.4 — CMD prompt handling and native acceptance corrections

- Remove terminal control sequences without consuming visible prompt/output text between separate OSC titles, including ST and BEL terminators. Reuse the same bounded text handling in local CMD readiness, the administrator bridge and native fixture readers.
- Restrict the PowerShell syntax-only parser to actual PowerShell family targets; discovery of CMD must not make a test invoke it with PowerShell arguments.
- Preserve bounded raw terminal diagnostics for native startup failures. Version 0.1.3's Windows test process now exits and reports its results: 658 of 661 passed, with the parser/CMD failures documented rather than concealed by the prior worker leak.

## 0.1.3 — Local console lifecycle and combined acceptance

- Release the exact owned node-pty ConPTY DLL transport after natural output drainage and explicit local-console close. The pinned library can otherwise retain its conout worker even after the shell has exited; native fixtures now check transport/broker closure as well as process exit.
- Bound the Windows unit/native regression step so a cleanup failure cannot occupy the entire packaging job. Retain strict failure reporting and native coverage.
- Verify the packaged application version and Electron's effective legacy data-directory name directly from `app.asar` metadata.
- The owner has authorized integrating Codex's completed PowerShell fixes and merging all finished branches into main. The branch audit confirms the integration branch already contains all currently pushed branch tips; the newly completed PowerShell commit was not yet visible at the audit.

## 0.1.2 — Windows branding build correction

- Preserve generated SVG/manifest line endings across Windows Git checkouts and explicitly generate canonical LF text. Windows CI reproduced the failure: CRLF conversion alone produced the unexpected asset hash. Integrity verification remains exact; no altered bytes are accepted.
- Correct native smoke assertions to inspect local-session metadata and the current nonpersistent tooltip. Preserve disposable screenshot/results evidence when Windows acceptance fails.
- Version 0.1.1 passed all eight real SSH/tmux/SFTP integrations and the history secret scan in GitHub Actions. Its Windows source gate stopped on the checkout hash mismatch before packaging. Version 0.1.2 reruns those gates against the corrected checkout.

## 0.1.1 — NerdSSHell workspace integration

- Rebranded the header, About/window identity, executable, installer, Start Menu shortcut and active guides as **NerdSSHell — Built for Windows nerds with Linux problems**. Preserved the application ID, package/data namespace and all ten original branding concepts. Added verified light/dark production icons, wordmarks and a multiresolution Windows ICO.
- Centralized settings in seven Preferences categories, with a shared draft and atomic Save/Cancel across colors, clipboard, Actions, Favorites, notifications and defaults for new connections.
- Made pane Actions and Favorites insert commands plus Enter into their originating terminal through the existing ordered input transport. Bound menu targets to the exact session/connection generation; added inline argument entry and the Configure Favorites shortcut. The separate command-review workbench retains its existing review flow.
- Added normal and Administrator Command Prompt using the existing ConPTY/local-session architecture. PowerShell and Command Prompt share sidebar/tabs with remote sessions, metadata-derived LOCAL badges and explicit shell-termination confirmation.
- Moved Scratchpad first, compacted shell launchers, removed the redundant footer, clarified persistent tmux wording, and distinguished the collapsed-sidebar expansion control. Layout controls remain directly available.
- Added independent semantic waiting detection, visible session indicators, bounded native notification/taskbar attention and one-shot audio preferences. Ordinary idle shells, terminal protocol replies and repeated redraws do not create or acknowledge false events.
- Added persistent patch-version and recovery rules, version consistency checks, native resource verification and exact-version Windows install/build instructions.

Validation before this checkpoint: source checks passed; **642 unit tests passed** on Linux; **28 real Chromium UI checks passed** using the app's actual HTML/CSS/xterm and a synthetic bridge. Production branding verification passed for 25 outputs and nine ICO frames. Windows packaging/native acceptance is the next gate; this record does not claim its result in advance.

Known concurrent work: PowerShell 7 resize/editing remains with Codex's separate branch and must be merged with its own Windows evidence. The full dependency audit currently reports eight high findings propagated from the unpatched development dependency advisory `GHSA-ch52-4w7c-c8xp`; no runtime dependency change or security-gate waiver was made.

## 0.1.0 — existing baseline

BetterSSH experimental SSH/tmux/SFTP workspace and the in-progress Windows command workbench. Historical validation and limitations remain in `docs/ACCEPTANCE-RESULTS.md` and the dated handoff documents.
