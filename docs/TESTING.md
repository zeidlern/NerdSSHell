# Development and acceptance checks

Use Node 22 x64 at least 22.12.0 and the committed lockfile. Windows 11 x64 is the supported desktop target. Run from the repository root:

```powershell
npm.cmd ci --omit=optional
node .\scripts\Verify-Publication.cjs --installed
npm.cmd run check
npm.cmd test
```

`npm run check` checks JavaScript syntax, package/lock/branding consistency, UI references and publication regressions. The project uses JavaScript/CommonJS and C#; it has no separate TypeScript type-check or linter command. Do not report those unavailable commands as passes.

## Disposable SSH integration

`npm run test:integration` uses the isolated OpenSSH/tmux fixture configured by `scripts/ci-sshd.sh` in the Linux CI runner. That script is for an expendable CI environment; do not use it to change global SSH settings on a user's server or workstation. Tests without a configured fixture may skip and must be reported as skipped.

The suite covers verified authentication, two independent endpoints/session identities, stable process ownership through recovery, ordered input, mixed Persistent/Standard sessions and file transfer. Self-contained unit integrations also create ephemeral loopback SSH/SFTP servers with synthetic credentials. Never use production accounts, sessions or real terminal transcripts as fixtures.

## Windows build and packaged acceptance

```powershell
node .\scripts\Generate-SupplyChain.cjs
npm.cmd run dist
npm.cmd run verify:package
node .\scripts\Verify-Notices.cjs
node .\scripts\Elevated-Console-Smoke.cjs --asar dist/win-unpacked/resources/app.asar
node .\scripts\Packaged-Password-Smoke.cjs
node .\scripts\Packaged-Confirmation-Smoke.cjs
node .\scripts\Scratchpad-Spelling-Smoke.cjs
node .\scripts\Packaged-PerPane-Smoke.cjs
```

Run acceptance scripts only in an approved disposable Windows test environment. They use temporary profiles, synthetic output and owned loopback sessions; inspect each fixture before running it. Package verification checks real executable/resource bytes, rather than configuration alone. The packaged UI fixture exercises actual preload/IPC, shells, SSH, SFTP and workbench behavior.

Remembered-password acceptance launches the actual packaged application with a generated loopback SSH key and a separate explicit user-data directory. It verifies Windows-protected ciphertext, a genuine app restart without another password prompt, live-session preservation on Forget, declined/failed saving, rejected-password eviction and fresh replacement. Reports contain only check names, artifact digests and owned fixture metrics; never include real profiles, plaintext passwords or copied credential files.

The PowerShell acceptance fixture waits for a fresh native prompt after each completed command and for the corresponding renderer write to drain before submitting the next command. A result marker alone does not establish that the shell is ready for more input. Prompt observation binds the original view, generation and local shell identity; it never retries commands or synthesizes cursor replies. Commands deliberately left running for the Ctrl+C check require their result marker without waiting for completion. Command failures preserve bounded terminal/cursor diagnostics and a screenshot in the disposable acceptance evidence.

Source builds and tests must not overwrite installed user data. An ordinary `npm start` can use the installed app's default data directory; use a new explicit absolute `--user-data-dir` or a fixture's isolated profile. Close apps normally, save notes and finish local/Standard work before installation or upgrade.

A no-UAC administrator bridge fixture validates transport/provider ownership, rather than genuine Windows consent. CI cannot establish physical notification/audio behavior, native dialog interaction, alternate-account UAC, clean-user installation, IME/accessibility or every display setup. Record those manually against the exact source SHA, installer hash and Windows environment.

## Dependencies, secrets and results

See [dependency maintenance](DEPENDENCIES.md) for supported/full-lock audit policy, [security architecture](SECURITY-REVIEW.md) for adversarial coverage and [release process](PUBLIC-RELEASE.md) for distribution checks. Do not weaken a test, host verifier or scanner to obtain a pass.

Record actual commands, pass/failure/skip counts, platform, source SHA, package version and artifact hashes. Keep diagnostics containing private paths, clipboard text or terminal data outside tracked source. [Validation results](VALIDATION.md) records the current release's measured scope.

The shared-confirmation fixture loads the exact unmodified ASAR main/UI/preload under the locked Windows Electron SDK, injecting only a memory clipboard and hidden owned windows. It never reads or writes the Windows clipboard or runs the fused production executable. It exercises real paste IPC, pointer/keyboard Continue and Cancel, exact original-destination input, queue/double-click/backdrop/stale-target behavior and OS-enabled parent state. The production-executable per-pane fixture separately verifies pointer approval/cancellation of owned Standard disconnects and preservation of its sibling connection. These complementary scopes must remain explicit.
