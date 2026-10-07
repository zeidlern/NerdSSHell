# BetterSSH security and public-release review

Review date: 2026-09-28 Central / 2026-09-29 UTC.
Baseline: `8358f4a8122f32483017c9fa290c6469193b2b42`.

## Dependency audit follow-up, October 4, 2026 Chicago

The 0.1.11 development lockfile narrowly updates build-only http-cache-semantics from 4.2.0 to compatible 4.3.0. A fresh complete-lock npm audit reports zero vulnerabilities, and source checks plus all 725 Windows regressions pass. No runtime dependency, installer-signing policy or scanner threshold changes. GitHub validation for the corrected lockfile remains required before merge; historical audit counts below retain their original checkpoint scope.

## Administrator provider follow-up, 0.1.9, October 3, 2026 UTC

The administrator helper now uses the same pinned ConPTY DLL/OpenConsole pair as ordinary consoles. This adds a native loading boundary, so the ordinary provider's earlier pathname hash check is not reused as sufficient elevated protection.

The broker checks bounded source bytes before UAC. After authenticated process/nonce checks, the helper independently reads and hashes the pair against literal expected hashes in the validated C# source. Local drive paths, disk-file identity and final resolved paths are checked; reparse points and ambiguous paths are rejected. Ancestor handles deny deletion during use, and untrusted source opens use anonymous security quality of service.

Production creates a fresh directory under the validated Program Files parent and both images with exclusive creation and explicit BA ownership plus protected BA/SYSTEM-only permissions. File owners are explicit at creation; the design does not rely on inherited DACLs or the elevated token's default owner. Held handles verify the resulting descriptors and bytes. Loading uses the absolute staged DLL and restricted DLL-directory/System32 lookup. The console-host child receives a protected working directory and System32-only PATH because the pinned host has separate delayed/relative native loading. The interactive shell receives the restored original environment.

Create, resize, release and close bind fixed exports from the same module. The owned shell remains in its kill-on-close job, with output and exit threads joined before unloading. Cleanup targets only the exclusively created pair and their directory, with bounded retries. The genuinely unelevated fixture explicitly uses a current-user/SYSTEM Temp stage; an already elevated fixture takes the production path. Neither fixture represents native UAC consent or alternate-account acceptance.

Source checks, **659 Linux tests** and **681 Windows tests** passed at `e66be29` / [run 37149968742](https://github.com/zeidlern/NerdSSHell-Historical/actions/runs/37149968742). Added Windows cases challenge damaged/truncated files, junctions, user-owned production objects and untrusted ACLs. Exact-packaged acceptance verified actual module/child paths, hashes, token branch, ownership/permissions, cleanup and strict resize/editing assertions. Exact results are recorded in `ACCEPTANCE-RESULTS.md`; real UAC/alternate-account consent remains manual acceptance. No independent security certification or installed UAC pass is claimed. The review below remains historical evidence for its original baseline.

**Dependency status at the 0.1.9 checkpoint:** the complete locked audit reports **8 high build-time findings** through `http-cache-semantics` ([GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)). Functional/native acceptance does not clear this release gate. The zero-advisory results below describe their historical lockfile/run dates.

## Verdict and scope

Keep the development repository private until the publication gates are satisfied. The app has a useful security foundation, but neither the original installer nor this patch is an independently certified secure release. This is a source/artifact review with synthetic regression testing, not a penetration test of a deployed production environment.

Reviewed all seven application modules in src/, the complete UI JavaScript/HTML/CSS, package/lock metadata, workflow, security policy, contributor instructions and acceptance record. Retrieved source from the authenticated GitHub connector at the fixed baseline. Downloaded the successful CI installer artifact and extracted it without executing Windows binaries. Source/lockfile Git blob hashes matched the pinned repository after checkout newline normalization. Runtime dependencies extracted from the installer enabled local tests without substituting newer packages. Historical commits/metadata were sampled, not exhaustively scanned across all references. Repository protection/security settings were not established; the ruleset read returned a plan/visibility restriction.

No production server, user session, credentials, global configuration, installed application, repository visibility or shared history was modified by this review.

## Verified evidence

- Baseline check: `npm run check` passed.
- Baseline existing suite: 60 passes, zero failures/skips.
- Ten focused adversarial/regression checks against baseline: one pass and nine failures, covering the defects below. These are nine failing assertions, not nine separately proven vulnerabilities.
- Patched check: `npm run check` passed.
- Patched suite: 76 passes, zero failures/skips (60 existing plus 16 security tests).
- Baseline GitHub Actions run `36517929845` completed successfully for source/unit/real loopback SSH integration and the Windows installer build. This does not validate the new branch or all desktop behavior.
- Artifact `11012205816`, `BetterSSH-Windows-x64`, archive SHA-256 `80b188fed14c08600a804029bfb7509cc9f1706aecdd5dbfe609d9b94b7971c7` matched downloaded bytes.
- The earlier local registry-DNS failure was superseded: on 2026-09-29, a fresh complete-lock `npm audit --package-lock-only --ignore-scripts --audit-level=low --json` exited 0 with zero critical, high, moderate, or low advisories. The audit was rerun against the final local candidate lockfile with the same zero-finding result. PR CI audit run `36520456791` had also returned zero findings at the previous head. These are known-advisory checks at their run times, not a transitive security certification.

## Reproduced defects and focused fixes

### S01 — Protocol response memory budget bypass (medium, availability)

**Location:** src/control.cjs, feed/line/fail.

A command response charges `raw.length` for each retained line. Empty lines cost zero despite allocating Buffer objects and array entries. A hostile or malfunctioning authenticated SSH endpoint can grow the response array without crossing this counter. Separately, oversized packets were concatenated before checking the cap, and closed control objects retained response/fragment buffers.

**Reproduction:** a synthetic stream, a 256-byte budget and repeated empty response lines did not trip the original guard. A separate 129-byte packet with a 128-byte budget was retained before rejection. No large allocation/OOM attack was run.

**Fix:** charge per-line overhead as well as content; reject oversized accumulated input before concatenation; ignore input after close and release retained buffers on failure. Three regression tests pass. This bounds the identified paths; it does not prove constant total RSS, efficient worst-case parsing or unlimited safe view counts. Further sustained-output/fuzz/resource testing remains a gate.

### S02 — Excessive remote terminal dimensions (medium, availability)

**Location:** src/core.cjs parsePanes; src/remote.cjs snapshot; ui/app.js resize consumption.

The server could supply 10,000 columns and 10,000 rows, which the backend accepted and passed toward renderer allocation. The 100-million-cell request is far above the UI's normal 1,000-column/500-row bounds.

**Reproduction:** synthetic discovery/snapshot responses were accepted at the original bounds; the test did not allocate a real giant terminal.

**Fix:** a shared geometry validator enforces 1,000 columns and 500 rows for both discovery and snapshots before rendering/capture. Normal 240x90 geometry remains valid. Total view/scrollback budgets still need sustained multi-view verification.

### S03 — Credentials retained after explicit disconnect (low, sensitive-memory lifetime)

**Location:** src/remote.cjs disconnect; src/main.cjs connection ownership.

The caller replaced its own secrets object, but retained Remote objects still referenced the original secrets and SSH client. This contradicted the intended release of application-held references after explicit disconnect. It is not a demonstrated remote credential-exfiltration vulnerability; memory inspection requires additional access or another flaw.

**Reproduction:** synthetic password/passphrase and client references remained on Remote after disconnect.

**Fix:** drop Remote's references and end the client; the caller separately clears explicit-disconnect credentials while preserving intentional transient-retry behavior. Do not mutate caller-owned retry state accidentally. This is reference cleanup, not guaranteed memory zeroization by JavaScript, ssh2 or the OS.

### S04 — Host verification reason lost (medium, security UX/retry behavior)

**Location:** src/remote.cjs hostVerifier/error handling; src/main.cjs retry classification.

A declined or failed host verification was overwritten by ssh2's generic `Host denied (verification failed)` error. Main's text-based stop conditions did not classify this message as a trust failure, allowing automatic reconnection and repeated trust prompts. This could pressure users to accept an identity merely to stop repetition. The original code still rejected the connection; a silent host-key bypass was not demonstrated.

**Reproduction:** a fake SSH client rejected an unknown/changed host, then emitted the generic transport error. Both tests showed the original security-specific reason lost.

**Fix:** preserve a dedicated `BETTERSSH_HOST_VERIFICATION` error and stop retry on its code. Existing revoked/changed/pinned-host checks remain in force. Real native trust/prompt cancellation is still a Windows acceptance gate.

### S05 — Control bytes in exported text (low, downstream terminal behavior)

**Location:** src/storage.cjs PlainText; src/core.cjs pasteText; src/main.cjs paste.

Unicode C1 controls passed through the purported plain-text archive filter. Clipboard validation also previously only warned on line endings and did not reject other terminal control characters. No arbitrary-code execution was demonstrated from these behaviors.

**Fix:** remove DEL/C1 controls from plain-text output and reject C0/C1 clipboard controls except tab/CR/LF. Normal key input, including Ctrl+C, is unchanged. Six additional clipboard tests cover Unicode, multiline text, escape/interrupt/NUL/C1 rejection and byte limits. This is not comprehensive Unicode anti-spoofing or terminal-output sanitization.

## Public-readiness work included

Removed the hard-coded personal connection button/details from the application. Replaced personal setup/acceptance narratives with generic onboarding, contributor guidance and a sanitized acceptance matrix. Preserved the app identifier and settings compatibility; a maintainer namespace is not a reason to break existing installations. The obsolete source manifest/test-output snapshot should not be used to authenticate current release bytes.

Added a private-reporting policy with explicit enable-before-release requirements, a sanitized bug-report template, a release checklist, Dependabot configuration, and a CI dependency-audit workflow. The follow-up candidate updates checkout/setup-node/upload-artifact to maintained, verified full SHA revisions; adds a redacted full-history Gitleaks job; prepares CodeQL for JavaScript and Actions once GitHub Code Security is available; and introduces a manual main-only signed-candidate workflow with a reviewed-SHA check and a separate signing environment. These workflow files are controls to run and verify, not evidence that the repository features or protected signing environment are active.

An SPDX 2.3 inventory of the full locked graph (281 unique name/version packages across 296 lockfile placements) and its non-optional runtime subset (9 packages including the root) were generated with npm 11.6.2. Eight installed runtime dependencies have verbatim license notices in `THIRD-PARTY-NOTICES.md`; the final local candidate's unpacked Windows build contained byte-identical LICENSE files in `app.asar` and carried separate Electron/Chromium license files. The npm SBOM does not enumerate Chromium components inside Electron or prove that a future installer contains those files. Regenerate and inspect notices for each release artifact.

The package remains private:true to avoid accidental npm publication. No project license was chosen on the owner's behalf. No history rewrite, repository visibility change or public release was performed.

## Important remaining release gates

### R01 — Unsigned and insufficiently hardened packaged application (high release priority)

Both the baseline installer and app executable have an empty PE Authenticode certificate directory. The executable's Electron fuse wire is v1 with states `101100011`: RunAsNode, NODE_OPTIONS and Node CLI inspection are enabled; embedded ASAR integrity validation and only-load-from-ASAR are disabled. File-protocol extra privileges remain enabled.

These are packaged-byte observations, not a claim that a remote SSH peer can activate those features by itself. Disable unnecessary runtime capabilities, configure resource integrity correctly, then sign and timestamp both installer and application. Inspect and tamper-test the resulting artifact on Windows.

The installer also placed ssh2 JavaScript in app.asar.unpacked. ASAR validation alone does not cover those external files. Review unpacking, integrity metadata and the trust of all distributed resources. Do not blindly enable an integrity fuse without the corresponding Windows metadata; this can prevent startup.

**Follow-up candidate status:** the pack configuration now disables RunAsNode, NODE_OPTIONS, Node CLI inspection and extra file-protocol privileges, enables embedded ASAR integrity and only-load-from-ASAR, and places ssh2 JavaScript inside ASAR. The verified unpacked resource exception is ssh2's `pagent.exe`. A local `verify:package` check inspected the final local build's executable fuse bytes, Windows ASAR integrity resource and resource list; a disposable one-byte CSS modification caused Electron's ASAR validation to abort startup, while an isolated clean-user-data copy started. The application now loads bundled UI through a narrow protocol with tests for traversal and non-allowlisted resource rejection. The NSIS installer was built and hashed (see ACCEPTANCE-RESULTS.md), but not installed or extracted for an independent byte comparison. GitHub Windows CI built and uploaded an independently hashed installer at head `81e0529` (run `36525510019`); its packaged resources were not separately extracted. Authenticode showed both local app executable and installer are unsigned. A clean Windows install and native GUI matrix remain release gates.

### R02 — Session isolation and desktop races (high release priority)

The existing acceptance record reports one untraced two-pane content mismatch that was not reproduced after a focused fix. This is an unresolved verification concern, not proof that the current patch misroutes input. Add automated two-host distinctive-marker tests through switching, resizing, discovery and reconnect. Verify prompt ownership/cancellation, stale output/snapshot generations and input destination before broader distribution.

The follow-up candidate adds generation checks for stale connection work and synthetic state/prompt/input regressions, including replacement of a remote session under a reused tmux ID. A disposable integration test now uses two independent SSH endpoints and host keys, same-named remote sessions with overlapping server IDs, distinct output markers, separate input and resize assertions, and reconnect with stable pane PIDs. The integrated local unit/security suite passed 105/105; the two-endpoint real SSH fixture passed GitHub Linux CI at `81e0529` in run `36525510019`. The native GUI race matrix remains unverified, and the historical visual mismatch remains untraced.

### R03 — Privacy, history and license (publication blockers)

Personal connection metadata was present in the shipped UI and development documents; commit metadata contains a personal email. Sanitizing current files does not remove historical copies, old artifacts or logs. Scan every intended public reference and review publication strategy before changing visibility. No committed credential leak was established by this review, and no exhaustive clean-history claim is made. Select a project license explicitly and review third-party notices/SBOM.

**Follow-up read-only coverage, 2026-09-29:** the remote exposed two branch heads and no tags. The local `--all` graph contained 12 reachable commits and 79 unique historical blobs. Gitleaks v8.30.1, from a SHA-256-verified upstream archive, exited 0 with no default-rule findings across that graph. A separate targeted scan found no PEM private-key or common GitHub/AWS token patterns, but did find historical personal profile, internal-host and user-path markers. Commit author/committer metadata on the reachable commits exposes the maintainer's personal email. The current tracked application has a generic sample host; an apparent internal-address match in the lockfile was a semantic-version false positive. Neither scanner can prove no secret exists.

PR #1 had no top-level comments, inline review comments or submitted reviews to scan at this check. GitHub listed 12 workflow runs and 23 jobs; 21 job logs were fetched and scanned in memory without finding the targeted credential/personal markers, while two older job logs returned 404. Eight unexpired Windows installer artifacts total approximately 895 MB; only metadata was inventoried in this pass. Seven artifacts were built from revisions before the current-source personal-preset cleanup, so their contents must be treated as potentially carrying that old metadata. Do not expose old refs or artifact downloads by flipping visibility. Artifact contents, inaccessible logs and any other unpublished refs need a reviewed publication decision; no history or artifact deletion was performed.

### R04 — Dependency, supply-chain and security-setting assurance

The fresh full-lock npm audit reported zero known advisories as stated above. Official Electron advisories reviewed did not establish that the two examined issues affect 44.4.5; this is not a complete transitive vulnerability clearance. Dependency and Gitleaks jobs passed at `81e0529` in run `36525509974`. The CodeQL workflow was skipped at that SHA because the private-repository feature/variable is not enabled, so there is no CodeQL scan result.

**GitHub settings:** the repository remains private; the default `GITHUB_TOKEN` is read-only and workflow PR approval is disabled. After PR #1 merged to `main`, Actions were restricted to full-SHA-pinned GitHub-owned actions; the selected-actions policy was read back and main-branch build/security workflows passed after the change. No deployment environments exist yet. The ruleset and main-branch protection reads returned 403, so required checks/reviews cannot be claimed as enforced. Private CodeQL default setup returned 403, consistent with private-repository GitHub Code Security being unavailable or not enabled; the conditional CodeQL job is therefore not an active scan. Secret-scanning alerts returned 404, so push protection/secret scanning could not be verified as enabled. Private vulnerability reporting is a public-repository feature and cannot be validated as an active intake route while this repository is private. The signing environment must be created with required reviewers and a main-only deployment rule before any certificate is added. The signed workflow does not run on PR refs and requires an exact reviewed main SHA, but workflow text alone does not configure those repository protections.

### R05 — Additional hardening and acceptance

Use an allowlisted application protocol instead of broad file:// semantics after compatibility tests; retain strict IPC origin/frame validation. Bound aggregate open views, snapshot load, queued input and scanning workload. Exercise SFTP timeouts/cancellation at every stage, remote path handling and overwrite races. Verify Windows profile ACLs, plaintext archive retention/deletion, disk-full handling and optional OS-backed encryption. Keep recording off by default. A normal user account and a clean Windows VM must pass the full release matrix.

The follow-up candidate caps the control input queue at 256 requests/2 MiB, parses fragmented protocol input without repeatedly copying the whole accumulated buffer, limits recording chunks, and bounds one simultaneous history search to the newest 128 MiB. Full archive export remains possible and needs measured memory/disk behavior; local export publication now refuses a concurrent same-name replacement. SFTP now bounds channel-open, metadata and publish operations (20 seconds by default) and stream idle time (30 seconds); cancellation before streaming and upload-directory/target symlink rejection have synthetic tests. A new destination is published with the OpenSSH hardlink extension and fails closed when unsupported. A confirmed overwrite still uses POSIX rename and can replace a path changed concurrently after confirmation; do not describe it as race-free. The integration fixture adds symlink rejection, pending final CI evidence.

A read-only ACL inspection of the existing development profile's BetterSSH directory and settings file found inherited `CodexSandboxUsers:(RX)` in addition to the user, SYSTEM, Administrators and a sandbox capability SID. This sandboxed machine is not evidence of user-only data access. No ACL was changed. A fresh ordinary Windows profile and actual archive/export files still need their own ACL and data-location acceptance.

A clearly confirmed local archive-deletion UI remains unimplemented. The attempted external profile-data deletion action was rejected by the sandbox's automatic approval review, so no existing recording was changed. Archive deletion and rotation need a reviewed implementation and Windows acceptance before claiming a complete local-data lifecycle.

## SFTP/Standard SSH integration review, 2026-09-29

The complete per-pane implementation package applied cleanly to the current `c7aa313` baseline after its 17 source-file hashes were checked. Existing palette/layout/keepalive and security behavior was retained. The full integrated Windows regression suite passed 217/217 with no skips; this is test evidence, not an independent audit.

Focused review found and fixed concrete failures: cancelled channel opens could escape the listing cap; paused stderr tails could be lost at natural shell exit; write backpressure could end a healthy Standard shell; keyboard focus could select the wrong browser owner; filtered/hidden selections could remain actionable; and Standard network loss retained credential/client references. New adversarial regressions exercise actual source/main-process wiring and disposable loopback transports. A separate 20-channel reservation cap survives cancellation until underlying cleanup, and input timeout preserves the shell with visible partial-delivery uncertainty and a bounded pending chunk.

Downloads now recheck the final path after opening, reject detectable symlink replacement and publish exclusively to a new local name. SFTP v3 still lacks portable atomic no-follow/identity binding; swaps restored between checks and same-size/mtime content changes can evade validation. Confirmed remote upload replacement retains the documented concurrent-writer race. Neither operation authenticates hostile-server content or creates a filesystem snapshot.

The local installer passed packaged fuse/ASAR containment and exact notice checks. Its Authenticode status is NotSigned. Existing privacy, licensing, signing, clean-Windows and native-dialog acceptance gates remain. See ACCEPTANCE-RESULTS.md for the actual fixture/CI evidence; local OpenSSH integration skips must not be counted as passes.

## References

- Electron security guidance: https://www.electronjs.org/docs/latest/tutorial/security
- Electron fuses: https://www.electronjs.org/docs/latest/tutorial/fuses
- Electron ASAR integrity: https://www.electronjs.org/docs/latest/tutorial/asar-integrity
- GitHub visibility consequences: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility
- GitHub private CodeQL availability: https://docs.github.com/en/code-security/reference/code-scanning/troubleshoot-analysis-errors/private-repository-enablement
- GitHub private vulnerability reporting availability: https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository
- GitHub deployment environment controls: https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments
- Gitleaks v8.30.1 release and checksums: https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1
- ssh2 primary documentation: https://github.com/mscdex/ssh2

See PUBLIC-RELEASE.md for the evidence-based go/no-go checklist. An independent security assessment is appropriate before describing a credential-handling terminal as broadly hardened.
