# Windows native broker fixture repair — October 3, 2026

Baseline: `4b81875c372a1b07dfebf7bc11a414260d6148e3`, NerdSSHell 0.1.9.
Repair branch: `fix/windows-native-broker-startup`.

## Reproduction and exact cause

The initial current-user installation stopped correctly at the test gate: 679 of
681 Windows tests passed, two failed, and none were skipped. Both failures also
reproduced independently with `--test-concurrency=1`: the protected Windows
PowerShell/PSReadLine bridge test and the native CMD broker fixture. The local
runtime was Node 24.19.0 / npm 11.6.2.

An untracked instrumented copy established that owner/source/native validation,
private-pipe creation, fixed helper launch and mutual PID/nonce authentication
all succeeded. The authenticated fixture `F` frame contained
`IOException: Native staging permits untrusted changes`. The first rejected
ancestor was AppData: this workstation grants an AppContainer capability write
access there. Its normal Temp also grants a sandbox group modification rights.
The same unchanged validation, source, runtime and launch path reached a real
CMD prompt when only the disposable child's TEMP/TMP selected an isolated
directory directly beneath the canonical protected profile root.

The complete captured CLIXML contained only the benign "Preparing modules for
first use" progress record. It was not the underlying failure. Recent Defender,
AppLocker and Code Integrity warning/error reads found no corresponding denial;
PowerShell script-block logging recorded the diagnostic launches. No security
policy, exclusion, profile or existing-directory ACL was changed.

The baseline [Windows CI run 37150751029](https://github.com/zeidlern/NerdSSHell-Historical/actions/runs/37150751029)
used Node 22.23.3, but its provider-observation logs explicitly report the
elevated BA/SYSTEM-only Program Files branch for CMD, PS5 and PS7. Thus CI did not
exercise the workstation's unelevated fixture Temp ancestors. Changing Node was
not needed to reproduce or resolve this failure on Node 24.

## Repair and security boundary

`scripts/lib/native-broker-fixture.cjs` creates an exclusive canonical scratch
directory under the profile root. It replaces case-insensitive TEMP/TMP keys in
a cloned child environment only. Native PowerShell/CMD tests and the default
exact-ASAR bridge harness use it; real `--uac` testing retains the production
environment. Fixture failures retain bounded authenticated `F` diagnostics in
test reports without changing the production GUI error.

The native C# and runtime code remain byte-identical to the baseline. Every
ancestor/owner/ACL/reparse check, literal SHA-256, restricted native loading,
fixed shell/launch identity, PID/nonce authentication, frame bound and owned job
remains active. The repair selects a valid test location; it does not admit the
unsafe original location. Cleanup checks canonical root identity, waits for
native staging cleanup and preserves surviving native artifacts as a failure.

Additional scripts-only acceptance options target the actual installed
executable with disposable data and opt into real UAC PowerShell, CMD and
cancellation. Production profiles are never fixture targets.

Version remains **0.1.9**: application source, UI, package metadata, dependency
lockfile and build settings are unchanged. These are excluded test/acceptance
scripts and documentation, with no shipped/runtime/package repair.

## Validation and continuation

Both original failures pass independently on Node 24.19.0. The PowerShell case
loads protected Windows PSReadLine 2.0.0 with SaveNothing and owned cleanup; CMD
passes multiline input, Unicode, natural exit and explicit-close ownership.
The seven new fixture tests pass, including exact hash-checked native ancestor
rejection/acceptance. All five native-related files pass **150/150**, zero
failures/skips. `npm run check` and the full Windows suite pass **688/688**, zero
failures/skips. NSIS build, native/branding/version/fuses/ASAR/package verification
and ten exact JavaScript notices plus Electron/Chromium notices pass.

Remaining acceptance at this checkpoint: exact-ASAR/native and packaged UI,
GitHub Linux/Windows CI, clean-main installation and actual human-owned UAC
consent/cancellation. Do not infer those passes from the unit tests.

Existing pre-install data was verified unchanged: 71 files / 8,447,804 bytes.
The already verified timestamped backup is retained; no private settings,
credentials, profile details or terminal archives belong in this repository.
