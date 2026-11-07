# Version 1.2.9 dependency security and AGPLv3 validation

Local evidence collected November 7, 2026, on Linux x64 with Node 24.22.1 and npm 11.9.0. The dependency/licensing work started from main `a8a94c78f2d0caf9fd877e75bd405c3edee1b37b`; the compact-panel follow-up starts from its merged main commit `63d69c0b2d0b28043bc101263ca4d0d26bcc093f`. The candidate uses Electron 44.10.2, node-pty 1.2.0-beta.18 and electron-builder 26.18.1. These results identify local candidates; protected checks, native Windows acceptance and official publication remain separate gates.

| Check | Measured local result |
| --- | --- |
| Fresh supported dependency install | 285 packages installed with lifecycle scripts enabled; all 19 optional lockfile placements verified absent |
| Source/publication, version, branding and UI checks | Passed, including all five publication-tool regressions and validation of 16 Wiki pages |
| Full Linux regression suite | 1,113 passed, zero failures, two Windows-only Toolhelp/drain cases skipped of 1,115 |
| New build-dependency regressions | Nine passed against the actual ASAR, builder and universal-package consumers; includes Windows path/pattern compatibility, packed/unpacked bytes, link containment, bounded hostile patterns and cancellation |
| Advisory negative controls | The original locked graph fails the bounded minimatch amplification and asynchronous glob cancellation regressions; the repaired graph passes both. The synchronous cancellation case also passes on the original graph and provides compatibility coverage |
| Supported and complete npm lockfile audits | Both report zero vulnerabilities at every severity; baseline was eight moderate affected entries from two underlying build-dependency advisories |
| Complete dependency install in a disposable directory | 304 packages installed without lifecycle scripts; no missing/invalid supported dependencies reported by npm ls |
| Optional build-download proxy fixture | Bootstrap, actual loopback forwarding, cache reuse, NO_PROXY bypass, checksum refusal and non-origin URL refusal passed; roarr/sprintf-js remain absent |
| Pillow 13.0.0 requirements audit | Zero known vulnerabilities for the pinned optional branding requirement |
| Dependency inventories | Regenerated and validated: 282 full SPDX packages, 11 runtime packages and ten runtime notices; packaged runtime dependency versions and notice contents are unchanged |
| Windows x64 directory cross-build | Passed with the existing unsigned configuration and Electron 44.10.2; exact-package verification passed PE branding/version, Electron fuses, Windows ASAR integrity, source containment and native-provider hashes |
| Packaged license verification | Passed for the project license, inventory, ten exact packaged JavaScript license files and Electron/Chromium notices |
| AGPLv3 release metadata | Source, lockfile, both inventory roots and packaged application declare AGPL-3.0-only; packaged LICENSE matches the complete canonical GNU text byte-for-byte, while third-party notices are unchanged |
| Real loopback appliance SSH integration | Two tests passed on the application/dependency candidate before the license-only change, including 300 authentication/lifecycle/failure cycles; zero automatic input, exec or subsystem requests and zero retained sockets, channels, provider maps, secrets, tasks, prompts or ready listeners after cleanup |
| Real OpenSSH/tmux integration | Full six-file run: two passed and 11 failed of 13. Both OpenSSH endpoints authenticate with strict host verification, but PTY ownership and tmux Unix socket operations are blocked by this execution environment; these cases remain unvalidated |
| Secret/history review | Gitleaks 8.30.1 found no leaks in reachable history (32 commit changes scanned) or the final tracked source; publication history review covered 34 commits and 702 text blobs, with examples, test fixtures and upstream attribution matches manually triaged |
| Workflow syntax and patch hygiene | actionlint 1.7.12 and git diff --check passed; the CodeQL 4.39.3 pin matches the official release commit |
| Independent review | Manual source review found no confirmed new runtime vulnerability in the examined trust boundaries; independent dependency/test/patch review found no blocker and reran all nine new regressions successfully |

The build-dependency repairs address [CVE-2026-118773 and CVE-2026-118764](DEPENDENCIES.md#november-7-2026-maintenance-for-129). Their vulnerable packages are build tooling, not the shipped SSH/terminal JavaScript runtime. A clean npm audit does not certify Electron's bundled native libraries or absence of vulnerabilities. Node has announced additional security releases for November 11; those fixes are not yet available and are not claimed as included.

The real OpenSSH preflight failed PTY allocation with `chown(/dev/pts/0, 1000, 5) failed: Invalid argument`. After correcting the fixture's overly long socket path, tmux still refused an isolated short socket path with `Operation not permitted`. No system settings or execution controls were changed. All owned servers, temporary authorized-key directories and disposable private keys were cleaned up. The successful appliance fixture uses real TCP SSH with a modeled device protocol; it does not establish operating-system tmux or vendor-device interoperability.

The Windows directory package was cross-built on Linux, then statically verified. An unchanged-configuration NSIS attempt was stopped before the Wine-dependent uninstaller stage; no complete installer was produced. No native Windows executable, DPAPI, console/UAC, updater handoff, real NSIS upgrade or physical desktop acceptance ran locally. The directory executable remains unsigned. These hashes identify the local candidate only, not official release artifacts:

| Local candidate file | SHA-256 |
| --- | --- |
| NerdSSHell.exe | ce4755d043baaacdf38f42fba9281314c41c629887227b0d244f0760785ea010 |
| resources/app.asar | d44701b77ec6a9a3a282aaeace2fe2e90b9f390eecef8e17aa43d7fd8438d766 |
| LICENSE | 0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0 |

The November 7 GitHub Security dashboard showed zero open Dependabot, code-scanning and secret-scanning alerts. Its dependency check was dated October 28, so that view did not substitute for the fresh local audits that found the two new advisories. Dependency alerts, security updates, secret scanning/push protection and private vulnerability reporting were enabled. No new CodeQL scan was run locally or claimed from this dashboard observation.

The manual source review examined IPC sender/frame/origin and consent binding, SSH host verification/authentication, saved-password lifetime, persistent lifecycle/input, SFTP/local-file grants and cancellation, release origins/redirects/download bounds, and the Windows update/elevation helpers. Required managed Codex Security workflow resources were unavailable; no completed managed scan is claimed. Native Windows paths received static review only. Existing SFTP v3 concurrency and same-user/OS-compromise limitations remain documented. Secret scanning and text-history review do not certify every historical binary or image.

The owner selected AGPL-3.0-only for 1.2.9 after the initial local candidate. The complete 34,523-byte [GNU AGPLv3 license text](https://www.gnu.org/licenses/agpl-3.0.txt) was copied verbatim. Local source/regression checks and the Windows directory build, exact-package and license checks were repeated with the updated metadata and license. The hashes above identify the later AGPL candidate including the compact-panel CSS correction; all 83 packaged tracked source/UI files match that local source exactly. The earlier AGPL candidate hashes remain in the [initial merged validation record](https://github.com/zeidlern/NerdSSHell/blob/63d69c0b2d0b28043bc101263ca4d0d26bcc093f/docs/VALIDATION.md). Earlier published releases retain their original terms.

After the owner authorized GitHub Actions, the initial [PR39 Linux run](https://github.com/zeidlern/NerdSSHell/actions/runs/42407330621) passed all 13 real integration tests, resolving the environment-blocked OpenSSH/tmux cases for that source. The separate [Windows updater acceptance](https://github.com/zeidlern/NerdSSHell/actions/runs/42407330631) also passed its pinned public-installer fixture; it does not establish a literal 1.2.8-to-1.2.9 upgrade. The primary Windows test job exposed a new fixture's attempt to execute the macOS-only universal ASAR merger with Windows path separators. That fixture is explicitly skipped on Windows; its real merger/allowlist coverage remains active on Linux, and the supported Windows ASAR/builder and advisory checks remain active.

### Compact file-panel follow-up

The final AGPL [PR39 build](https://github.com/zeidlern/NerdSSHell/actions/runs/42408268953) passed Linux/Windows acceptance. Its [merged-main build](https://github.com/zeidlern/NerdSSHell/actions/runs/42409246339) then failed the 900x600 side-by-side Local file-list geometry assertion, so no release artifact or tag was accepted. An unchanged-assertion [diagnostic run](https://github.com/zeidlern/NerdSSHell/actions/runs/42410792271) passed the existing checks but measured a separate coverage gap: the Remote list extended 15 pixels below its clipped view at 900x600, with a 121-pixel client height and 140-pixel scroll height. Visible transfer buttons still received their hit tests. The original assertion inspected only the Local column; its success did not establish that the Remote list viewport was intact.

The correction lets file views size for wrapped controls/status text while containing each list's intrinsic size, so additional entries scroll inside the list instead of increasing the drawer height. Packaged acceptance retains the original assertions and adds both-column checks using long synthetic status text and 100 then 200 inert rows: complete list containment, bounded sizing, last-row reachability and transfer-button hit targets. Exact original nodes and scroll positions are restored after each synchronous layout check; no transfer or file-writing operation is part of that synthetic fixture. Geometry diagnostics include status lengths and bounds, not original text, names or paths; screenshots retain their Local-panel privacy mask.

The existing sandbox-enabled offline Chromium fixture was attempted locally, but process-singleton socket creation failed with `EPERM` before any page opened. It produced no UI geometry result. Execution controls were unchanged; fresh Windows acceptance remains necessary for the CSS correction.

Protected main requires fresh Linux/Windows build, dependency, secret-history and both CodeQL checks from GitHub Actions, with no bypass. Local evidence cannot satisfy those integration-bound checks. The final reviewed candidate, including AGPL metadata and the compact-panel correction, must pass fresh exact-source acceptance and publication gates before creating the protected version tag; publication must reuse the accepted main Windows artifact. The pull request and release retain the final hosted receipts.

---

# Version 1.2.8 dependency security maintenance validation

Local evidence collected October 28, 2026, on Linux x64 with Node 24.22.1 and npm 11.9.0, based on main `dadcea841626b4fc86cda9341cd8fabc58660e54`. The candidate uses Electron 44.10.0, node-pty 1.2.0-beta.18 and electron-builder 26.18.1. This section records local candidate evidence; exact hosted source, Windows build/acceptance and publication receipts belong to the maintenance pull request and release.

| Check | Measured local result |
| --- | --- |
| Fresh supported dependency install without lifecycle scripts | 286 packages installed; all 19 optional lockfile placements verified absent |
| Source/publication, version, branding and UI checks | Passed, including all five publication-tool regressions |
| Full Linux regression suite | 1,104 passed, zero failures, two Windows-only cases skipped of 1,106 |
| Real loopback appliance SSH integration | Two tests passed, including 300 lifecycle/authentication/failure cycles; zero live sockets/channels, retained secrets, pending tasks or pending prompts after cleanup |
| Supported and complete npm lockfile audits | Both report zero vulnerabilities, including low severity; the pre-update npm graph also audited clean |
| Complete dependency install in a disposable directory | 305 packages installed without lifecycle scripts |
| Optional build-download proxy fixture | Bootstrap, actual loopback forwarding, cache reuse, NO_PROXY bypass, checksum refusal and non-origin URL refusal passed; roarr/sprintf-js remain absent |
| Native provider identity | Reviewed beta.18 conpty.node SHA-256 matches; ConPTY DLL and OpenConsole bytes match their existing pins |
| Dependency inventories and installed graph | Publisher validation passed for 282 full SPDX packages and 11 runtime packages; ten runtime notices refreshed; npm ls reports no missing/invalid supported dependencies |
| Workflow YAML and whitespace | All six workflows parsed; diff whitespace check passed; changed Action pins independently matched official release tags |
| Independent review | Manual source review found no confirmed new vulnerability in the examined trust boundaries; independent patch/native/package review found no blocker |
| Windows executable, fuses/ASAR, DPAPI, native consoles and NSIS installation | Not run on this Linux host; require fresh successful protected Windows and real-installer acceptance for this candidate |

Electron 44.10.0 includes Node 24.22.1 and Chromium 152.0.7977.169, resolving the embedded-Node version gap recorded for 1.2.6/1.2.7. The advisory database, source review and regression tests have distinct scope; a clean npm audit does not certify bundled native code or absence of vulnerabilities. The packaged confirmation receipt records the actual Electron and Node runtime versions.

The manual source review examined main/preload IPC, the application resource protocol and renderer restrictions, SSH trust/authentication, saved-password binding, persistent lifecycle/input, SFTP/local file boundaries, release transport/download and Windows update/elevation helpers. Required Codex Security plugin workflow resources were unavailable; no completed plugin scan is claimed. Existing SFTP v3 concurrency limitations and same-user/OS-compromise exclusions remain documented.

The updated real-installer workflow now also triggers for package manifests and package-verifier changes while preserving its official-repository/owner/disposable-VM guards. Its successful result is required before accepting this builder/runtime change. Protected main still requires fresh Linux/Windows, supported/full dependency, secret-history and both CodeQL jobs; publication reuses the exact accepted main Windows artifact.

Automated native fixtures do not establish physical desktop interaction, genuine UAC or alternate-account behavior, every clean-user Windows setup, or vendor-device interoperability. The application and installer remain unsigned. No owner installation, user data or production SSH session was changed by local validation.

---

# Version 1.2.7 updater shutdown validation

Windows 11 x64, Node 22.23.4 and npm 11.9.0; candidate branch `codex/updater-shutdown-eof-1.2.7`. The reported installed 1.2.4 client closed after accepting 1.2.6 and remained on 1.2.4. Its bundled updater sources match the released 1.2.4 implementation after newline normalization. Local event records show helper activity but do not retain the worker's final status, so they cannot prove its exact cancellation branch.

An inert Windows fixture deterministically reproduces an acknowledged update being cancelled when broker stdin reaches EOF while the pinned original parent remains alive for another 250 ms. No installation or restart occurs on the original helper. The repaired broker gives only an acknowledged release a five-second parent-exit grace, preserving cancellation and all subsequent identity/instance checks.

| Check | Measured local result |
| --- | --- |
| Fresh supported dependency install | Passed; optional packages omitted |
| Source/publication checks | Passed |
| Supported and complete npm lockfile audits | Both report zero vulnerabilities |
| Full Windows regression suite | 1,128 passed, zero failures, one existing symlink-privilege skip of 1,129 |
| Focused native EOF acceptance | 34 checks passed across timely exit, pre-release EOF, live-parent timeout and explicit cancellation |
| Complete native handoff acceptance | 172 checks passed across 24 cases; owned processes exited and temporary fixtures were removed; zero registry operations or process kills |
| Unsigned Windows 1.2.7 build | Built; exact-package fuses, ASAR integrity, native containment and notices passed |
| Dependency inventories | Regenerated with npm 11.9.0; full SPDX 283 packages, runtime SPDX 11; dependency versions and third-party notice content unchanged |

Native handoff fixtures use generated inert applications/installers and synthetic data. These results do not establish a real NSIS upgrade or acceptance of an installed user copy. The exact candidate's protected Windows packaging and hosted real-installer checks must be recorded before official acceptance. No repair release has been published at this checkpoint. The embedded Node limitation documented for 1.2.6 remains applicable.

---

# Version 1.2.6 security maintenance validation

Local evidence collected October 25, 2026, from the security update based on `50bb2763dcea840a879692b0ba0414ac10280456`. The local environment is Linux x64, Node 24.22.1 and npm 11.9.0. Electron is pinned to 44.9.3. These source and dependency results do not establish Windows runtime or installer acceptance; the exact candidate's protected GitHub checks provide that separate evidence.

| Check | Measured local result |
| --- | --- |
| Fresh supported install, without lifecycle scripts | 287 packages installed; all 19 optional lockfile placements verified absent |
| Supported and complete npm lockfile audits | Both report zero vulnerabilities, including low severity; baseline reported Electron, Undici and fast-uri |
| Source, publication, metadata, branding and UI checks | Passed; five publication-tool regressions passed |
| Full regression suite | 1,104 passed, zero failures, two Windows-only Toolhelp/drain cases skipped of 1,106 |
| Real loopback appliance SSH integration | Two tests passed, including 300 lifecycle/authentication/failure cycles; zero live sockets/channels, retained secrets or pending prompts after cleanup |
| Complete dependency installation in a disposable directory | 306 packages installed, including development and optional dependencies, without lifecycle scripts |
| Optional build-download proxy fixture | Bootstrap, loopback forwarding, cache reuse, NO_PROXY bypass, checksum refusal and non-origin URL refusal passed; roarr/sprintf-js absent |
| Pillow 13.0.0 requirements audit | Zero known vulnerabilities for the pinned requirement |
| Isolated Pillow 13.0.0 branding regeneration | All 25 assets and the manifest match the committed bytes; decoded PNG, SVG raster and ICO pixels also match; original assets unchanged |
| Build-engine range | Eleven patched/unpatched/unsupported/prerelease boundary cases passed |
| Workflow YAML and whitespace | All six workflow files parsed; diff whitespace check passed |
| Dependency inventories | Full SPDX regenerated with 283 packages; runtime SPDX with 11; ten runtime dependency notices unchanged |
| Windows PowerShell helper, NSIS, fuses/ASAR and packaged desktop acceptance | Not run locally; required on the exact candidate before merge/release |

The full suite ran with permission to spawn child processes and bind owned loopback listeners. Initial restricted-sandbox attempts failed on those capabilities and are not counted as passes. The appliance fixture uses actual SSH transport with a synthetic device protocol; it is not an operating-system tmux or vendor-device certification. No live server, installed user application, remote session, credential store or published release was modified by local validation.

Hosted evidence for [PR28](https://github.com/zeidlern/NerdSSHell/pull/28) applies to reviewed head `c4c84f1de9346074100aa177b5f78a08cbc1aabd`: all protected checks passed, including 1,129 Windows tests with zero failures or skips. The separate [real-installer acceptance run](https://github.com/zeidlern/NerdSSHell/actions/runs/40251626982) passed in a disposable hosted Windows VM. It covered the old client's safe download refusal, the exact candidate ASAR under the locked SDK with a controlled current-version identity downloading and installing pinned public 1.2.2 through the real helper, restart and synthetic-data preservation, then manual candidate-installer bootstrap and installed-ASAR verification. These distinct scopes do not establish an unmodified old-client upgrade to the candidate or identify final published release bytes.

**Remaining upstream runtime gap:** Electron 44.9.3 embeds Node 24.22.0, below the October 21 security release 24.22.1. The source-based exposure assessment and follow-up requirement are in [dependency maintenance](DEPENDENCIES.md). A clean npm audit does not resolve this binary-runtime gap. No complete automated repository-security scan or absence-of-vulnerabilities certification is claimed.

---

# Version 1.2.4 validation

The updater repair has fresh local Windows 11 x64 / Node 24.19.0 evidence. Electron remains 44.5.1; dependencies and notice contents are unchanged. [PR22](https://github.com/zeidlern/NerdSSHell/pull/22) records exact hosted installation and protected CI results before merge/publication.

| Check | Measured local result |
| --- | --- |
| Source, publication, workflow and whitespace checks | Passed |
| Full regression suite | 1,128 passed, zero failures, one existing file-symlink privilege skip of 1,129 |
| Original vs repaired real Chromium download | Original rejects `Redirect was cancelled`; repaired transport verifies the public 1.2.3 installer's 114,359,950 bytes and published SHA-256, then removes its stage |
| Fresh unsigned 1.2.4 package | Fuses, ASAR integrity, native containment, exact updater source and notices passed |
| Exact-ASAR startup dialog | 13 pointer checks passed across decline, approval and corrupt-download refusal; controlled transport/inert handoff |
| Native helper | 143 checks passed, including real lingering-child success, cancellation, bounded refusal and a new instance during child drain; all owned processes/temporary fixtures cleaned |
| Independent transport/helper review | No remaining blocker; 17 focused handoff regressions passed |

The native fixture uses inert generated installers and replaces registry/recovery/final process enumeration. Its new child capture/drain uses real Windows snapshots, ancestry and pinned process handles. It does not establish real NSIS installation, UAC or physical desktop acceptance. The separate hosted test must use the exact candidate ASAR/helper without diagnostic worker wrappers, observe real public NSIS installation/restart/data preservation, then verify the manually bootstrapped candidate ASAR. The PR retains that receipt and its exact source identity.

Local unsigned installer SHA-256: `4a09e6f0112b17297766d3dd9c0b3ea12b22425e64e93562f3187cc3685830ce`; ASAR: `98d74dcc8037db35df6ba75920f03ae921eb0117a5ed60e8072f5c88d7bdf011`. These identify the local candidate; published release bytes are separately identified by their release manifest. Versions through 1.2.3 need one manual installation of the repair.

---

# Version 1.2.1 validation

The owner authorized merge, unsigned publication and local installation of [PR11](https://github.com/zeidlern/NerdSSHell/pull/11). These local results apply to the 1.2.1 output-buffer fix on Windows 11 x64 / Node 24.19.0. Electron remains 44.5.1 and dependency versions are unchanged. Protected hosted CI must finish before merge; its exact results and final source identity are recorded in the PR and release receipts.

| Check | Actual local result |
| --- | --- |
| Fresh locked supported install | 287 packages installed; zero audit vulnerabilities; supported graph verified |
| Source/publication metadata/branding/UI checks | Passed |
| Focused output regression | 38 passed, zero failures/skips |
| Full regression suite | 1,037 passed, zero failures, one existing file-symlink privilege skip of 1,038 |
| Fresh unsigned Windows x64 NSIS/app package | Fuses, ASAR integrity, native identity/containment and notices passed |
| Shipped project source/assets | All 84 match the tested ASAR byte-for-byte; normalized package metadata matches source |
| Protected-executable pane/SSH/SFTP/console/confirmation acceptance | 190 checks passed against the same ASAR |
| Protected-executable host/password and Quick Connect acceptance | 71 and 54 passed with generated loopback peers |
| Exact-ASAR SDK confirmation and startup-upgrade fixtures | 48 and 13 passed; controlled memory clipboard/download/handoff |
| Exact-ASAR native provider/ownership/cleanup | Passed without requesting UAC |
| Local spelling/wrap fixture | 16 passed; isolated source helper/SDK, no external requests |
| Independent read-only patch review | No blocking issue found |

A deterministic test isolates the original display-timer starvation:32-byte chunks every 10 ms delayed the first frame to 10,240 ms. The fix preserves the first chunk's deadline and emits at 12 ms in that fixture, delivering all 35,200 bytes in order. This does not measure wall-clock Windows rendering/network delay or establish the reporter's EC2/tmux cause.

Separately, exact published 1.2.0 passed 93 disposable IP-edit/automatic-reconnect/host-approval checks with password and generated RSA-key authentication. All 14 owned Win32 root-window observations stayed enabled, DOM hit testing and Chromium pointer events worked, and consent/pin guards passed. This does not verify physical Windows mouse/cursor routing; that report remains unreproduced.

Both app and installer are unsigned (NotSigned). Local installer SHA256:446b31fab8a00bca32b68d2e4ca9d257392e60b21eb03e16fc7105fc91269e24; ASAR SHA256:2881a9439148c0849030edc6ecf53684cecaad43cec2075255775fd18ca1c949. Checksums identify bytes, not the publisher. Native file/UAC/color pickers, physical clipboard/notifications and every clean-user/display setup remain outside these automated fixtures.

---

# Version 1.0.4 validation

The owner authorized merge, unsigned publication and local upgrade after review of [PR 8](https://github.com/zeidlern/NerdSSHell/pull/8). These results were executed on Windows 11 x64 / Node.js 24.19.0 against the versioned 1.0.4 source and installer. Electron remains 44.5.1. Current PR/main CI receipts are recorded in the [release notes](https://github.com/zeidlern/NerdSSHell/releases/tag/v1.0.4) once publication completes; earlier CI results below retain their original version scope.

| Check | Actual local result |
| --- | --- |
| Fresh locked supported install | Passed; dependency versions unchanged |
| Source/publication metadata/branding/UI checks | Passed |
| Windows unit/native regressions | 908 passed, zero failures, one existing file-symlink privilege skip of 909 |
| Fresh Windows x64 NSIS build and exact package | Identity/version, fuses, ASAR integrity, native hashes, containment and notices passed |
| Current shipped source/assets | All 77 files match the tested ASAR byte-for-byte; trimmed packaged runtime metadata matches source |
| Production host/password/restart acceptance | 71 checks passed |
| Production pane/rate/About/SSH/SFTP/console/shared-confirmation acceptance | 190 checks passed |
| Exact-ASAR SDK paste acceptance | 48 checks passed; memory-only clipboard and all owned fixture cleanup verified |
| Exact-ASAR native provider/ownership/cleanup | Passed without requesting UAC |
| Local spelling/wrap acceptance | 16 checks passed; no external requests |
| Supported and complete dependency graph | Zero vulnerabilities |
| Workflow syntax | actionlint passed |

The SDK paste fixture is distinct from production-executable acceptance: it runs unmodified ASAR code with an injected memory clipboard. Mouse/keyboard Continue delivers the exact multiline input once to the original echo shell; cancellation, double-click and stale-target guards send no input. The production executable separately proves pointer approval/cancellation for Standard disconnect consequences.

The implementation adds 120 synthetic and 100 verified loopback lifecycle cycles. Loopback Persistent controls are modeled; the real Linux OpenSSH/tmux integration gates execute actual tmux. The original long-session lag and exact Win32 cursor/capture mechanism remain unverified. Runtime diagnostics expose bounded counts and versions without credentials or terminal content.

## Exact 1.0.4 Windows candidate

The application and installer are unsigned (NotSigned). Checksums establish byte identity, not publisher identity. The existing v1.0.3 release remains intact.

| File | SHA-256 |
| --- | --- |
| NerdSSHell-1.0.4-x64-Setup.exe | a3f086d672d4432ea1827198415ac54bfd27566dfb812327f1772b579b6829a9 |
| app.asar | 052f632d79827cb46417820d453c0b4f3b234d941bb334ffd9600f19a7f564d3 |

Automated tests do not establish every clean-user installation scenario, genuine alternate-account UAC, native file/color dialogs or physical notification behavior. Normal closure of the installed app is required before upgrade so Standard shell consequences and unsaved notes receive their own confirmation. Existing profiles, host pins, Windows-protected remembered passwords and the installer/data identity remain compatible.

---

# Version 1.0.2 validation

Validated October 7, 2026 against [code revision 1f3e6a2](https://github.com/zeidlern/NerdSSHell/commit/1f3e6a256344556bc3dcc45567a8bede077640d1). Local checks ran on Windows x64 with Node.js 24.19.0; GitHub CI used Node.js 22 on Linux and Windows. These results apply to the identified source and artifacts.

## Results

| Check | Actual result |
| --- | --- |
| Source/publication checks | Passed JavaScript syntax, synchronized metadata, branding, UI references and 16 Wiki pages |
| Windows unit/native regressions | 774 passed locally and in CI; zero failures or skips |
| Linux regressions | 751 passed; zero failures or skips |
| Disposable real SSH/tmux integration | 8 passed; zero failures or skips |
| NSIS Windows x64 installer | Built successfully |
| Package verification | Identity/version, fuses, ASAR metadata, native hashes, containment and notices passed |
| Exact shipped source/UI comparison | All 74 files match the tested ASAR byte-for-byte |
| Packaged UI, SSH/SFTP and console acceptance | 165 local checks and 175 CI checks passed |
| Exact-ASAR native bridge without UAC | CMD, Windows PowerShell and PowerShell 7 provider/ownership/editing/cleanup checks passed |
| Native Scratchpad spelling/word wrap | 16 checks passed; no external dictionary/request URLs |
| Dependencies | Supported and complete lockfile audits: zero vulnerabilities; installed resolution passed |
| Documentation | 131 local targets in 38 Markdown files resolved |
| Workflows | actionlint 1.7.12 passed; required GitHub checks passed |
| CodeQL | JavaScript/TypeScript and Actions analyses passed |
| Secrets/privacy | Full reachable-history Gitleaks passed; no known credential exposure found |

The project uses JavaScript and does not configure a separate general-purpose linter or type checker. Those checks are **not configured**, rather than reported as passes. Syntax and workflow validation are separate checks.

CI evidence: [build and Windows acceptance](https://github.com/zeidlern/NerdSSHell/actions/runs/37581607682), [dependency/secret checks](https://github.com/zeidlern/NerdSSHell/actions/runs/37581607698), [CodeQL](https://github.com/zeidlern/NerdSSHell/actions/runs/37581607699).

## Security dispositions

The optional build-only `sprintf-js` advisory was removed through a scoped `global-agent` 4.1.3 update. The complete graph lost `roarr`, `sprintf-js` and unused logging helpers. No dependency alert was dismissed. Actual loopback tests verify proxy bootstrap/forwarding, cache, `NO_PROXY`, checksum rejection and refusal of non-origin or credential-bearing URLs. See [dependency maintenance](DEPENDENCIES.md).

Each of the 43 initial CodeQL alerts was reviewed individually: 42 were false positives for JSON literals sent directly to V8/CDP in isolated acceptance scripts, without an HTML parser sink; one was an expected-value expression in a fixed test. Each received its own documented dismissal. A new SSRF alert in the build-proxy fixture was corrected by constructing the forwarding destination only from its owned loopback endpoint; CodeQL reports it fixed. No scan query, test or shell behavior was suppressed.

Source review found and fixed two availability issues: aggregate discovered/open/pending terminal allocations and an abandoned SSH half-close socket. Tests cover bounded discovery, pending generations and renderer launch reservations, unchanged session identity, old-socket-only cleanup and a real hostile loopback peer. The review covered 138 runnable source/UI/tooling/test/workflow files; it is not an independent product certification.

At the reviewed code revision, Gitleaks covered seven reachable commits and five nonmerge diffs. All 25 redacted email/path/IP matches were classified as upstream metadata or synthetic fixtures; commit identities used noreply addresses. Binary/artwork and off-Git surfaces are outside that textual scan, and no pattern scanner proves absence of every secret.

Project license, third-party notice inventory, ten runtime JavaScript license files and Electron/Chromium notices were verified in the package. An altered project-license payload in a disposable ASAR was rejected by exact notice verification. Original tested artifacts were preserved.

## Local candidate identity

Both the application executable and installer report **NotSigned**. Hashes identify bytes and do not authenticate a publisher. Public downloads belong on [Releases](https://github.com/zeidlern/NerdSSHell/releases).

| File | SHA-256 |
| --- | --- |
| NerdSSHell-1.0.2-x64-Setup.exe | `3e9465f605cf00dc9aa17a50315f2467bf171a2f965bb10e4f6db8baef7ab710` |
| app.asar | `51f48213cbf040836c3d540f19cd6fe5169a9c9f0397e06fe77e1e41ca0fc1da` |

## Distribution acceptance

The source is public and buildable under [LICENSE](../LICENSE). The unsigned candidate passed automated checks. Consumer Windows acceptance still requires clean-user install/upgrade, genuine UAC approve/cancel/alternate-account interaction, native file/color dialogs and GUI-driven transfers, and physical sound/toast/taskbar observations. Automated no-UAC fixtures do not establish those results.

Signed production distribution additionally requires enrolled publisher signing, timestamping and verification of the exact signed application/installer. See the [release process](PUBLIC-RELEASE.md). No published binary release or signing result is implied by source availability.
