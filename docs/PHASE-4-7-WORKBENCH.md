# Phases 4–7: Quick Actions, administration, sharing and integration

## Scope and checkpoints

Continue the existing feature branch without replacing main or the installed application. The owner authorized chaining the remaining phases while preserving coherent saved checkpoints. Original Phase 3 head: `326e75af3fd9fdab83f679cf2be7c1591d4e6e5f`.

- `42054626bddbcfd8c07388dca7d64d92226ace57`: correct queued native HTML dialog close semantics. Close/Escape revoke approval synchronously; a queued old close event cannot invalidate a newly opened review. The existing native failing assertion remains enabled.
- `b5b4a5435b3242e32aa1556324d52835c9843a85`: capability-aware inspection and administration. Shared catalog/backend suite: 58 passed. GitHub build `37075273266` and security workflow `37075273281` succeeded. This is an intermediate checkpoint, not evidence for subsequent changes.
- The following UI/sharing/integration changes are evaluated at the exact commit/build recorded in PR #9. No fixed historical result here should be treated as proof for a newer revision.

## Implemented behavior

**Phase 4:** one searchable Actions surface with Windows terminology, visible reasons for unavailable operations, and at most three favorite IDs saved. Concurrent favorite writes are serialized. OS/tool discovery occurs only after Detect and uses a separate bounded SSH channel. Conflicting identities fail closed; failed reinspection discards stale facts. Systemd/journal tools are checked independently. Windows output labels memory/disk units and cumulative CPU time. Process summaries avoid full command arguments where practical; output can nevertheless contain sensitive details.

**Phase 5:** all update installs are disruptive and require exact-host review. Distribution identity selects the expected package manager; ambiguous or image-based update tooling is refused. APT cache limitations, DNF code 100, checkupdates code 2/temporary database, full Arch upgrades, package prompts and possible service interruptions are explained. No guessed sudo expiry, automatic root shell, policy bypass, forced update acceptance or automatic privilege grant. Power actions require the actual tools and warn about persistent work loss. Docker context may point away from the SSH host and is explicitly disclosed. Native confirmation repeats consequences as well as the exact command.

**Phase 6:** app-only diagnostics use an explicit metadata allowlist, max 64 connections/100 events and bounded strings. Output excerpts use max 200 physical rows/128 KiB, preserve real soft-wrap spaces, handle wide-character padding and label truncation. Control/direction characters are visible, not executable. No automatic copying, redaction, cloud submission or command persistence. Preview Close/Escape clears immediately; async results are generation-bound and cannot overwrite a later redaction. Only explicitly reviewed text is copied.

**Phase 7:** the existing packaged-app acceptance invokes the action/sharing module in addition to SSH/SFTP, command review and local PowerShell checks. It tests real renderer search/staging/favorites, unknown-platform handling, bounded diagnostics, a synthetic Windows clipboard, excerpt scope and preservation of four fixture consoles. It never runs an administrative recipe. Syntax-only recipe tests use /bin/sh -n or PowerShell Parser.ParseInput; parsing is not execution or platform compatibility certification.

## Evidence at local integration checkpoint

- Full `npm test`: **373 passed; zero failures/skips**.
- `node scripts/check.cjs`: passed.
- Runtime dependencies used locally were recovered from a previously checksum-verified packaged build, with per-file ASAR hashes and matching current runtime versions. A clean npm installation is not claimed for this network-restricted review container; CI uses the committed lockfile.
- The former Phase 3 Windows run `37073370438` passed 339 tests and packaging but failed the close-approval assertion. Three async-close regressions reproduced before the correction. Subsequent intermediate native CI passed; no assertion was removed to obtain that result.
- New diagnostic/renderer tests cover stale responses, exact edited-text copying, secret-field exclusion, payload limits, and real xterm soft-wrap/wide-character text.
- Final native build/acceptance, audit findings, installer/archive hashes and any failed/retried run are recorded in PR #9 after verification. A configured test is not a completed test.

## Known limits and manual acceptance

Administrative commands were reviewed and syntax-checked, NOT run on the owner’s machine or servers. No reboot, shutdown, real update, privileged service restart or production Docker operation was performed. Distribution versions/policies, macOS behavior, localized systems, custom PowerShell installs, native folder-picker and native Run/close/quit dialog interactions need owner/platform testing. Regex warnings are advisory, not a security sandbox.

The app remains an unsigned experimental Windows x64 build. No ARM64/iPad conversion, code signing purchase, public release, repository visibility/access/license change, merge to main, or replacement of the installed app is included. CodeQL is skipped until repository feature/setup supports it; dependency/secret scans do not establish complete security or personal-data clearance.

## Operational references

Reused the saved Windows user research; did not repeat the whole market survey. Checked primary command behavior against:

- https://man.archlinux.org/man/sudoers.5.en — credential caching depends on policy and terminal/session scope.
- https://man.archlinux.org/man/checkupdates.8.en — temporary database and exit values.
- https://dnf.readthedocs.io/en/latest/command_ref.html — check-update result and refresh behavior.

The UI exposes the exact command and target before submission. Users remain responsible for backups, recovery access and the permissions/environment of their selected account.
