# Current identity and upgrade compatibility — 1.0.1

Current package: `nerdsshell`. Windows app ID: `app.nerdsshell.desktop`. UI/resource protocol and IPC prefix: `nerdsshell`. Native broker type: `NerdSSHell.ElevatedConsole`. The name/domain changes do not change the approved artwork or copyright ownership.

## Installer and local data

The NSIS GUID is explicitly pinned to `48ee049e-c2f6-57b2-ab6e-7f5df516dcc0`, independently derived from the previous installer identity. This retains existing registration and installation directory while new shortcuts use the current app ID.

Before taking the single-instance lock, startup selects the data directory:

- An explicit absolute `--user-data-dir` profile wins and stays isolated from both default directories.
- Source-only `NERDSSHELL_TEST_DATA` may select a test profile; packaged builds ignore it.
- An existing `%APPDATA%\betterssh` directory is retained for upgrades. No settings, trust pins, archives or notes are copied, renamed, merged or deleted.
- Fresh users use `%APPDATA%\nerdsshell`. If both default directories exist, legacy data is selected and the other directory is left untouched; resolve that condition deliberately.
- Unreadable, non-directory or reparse/symlink candidates fail instead of silently switching to empty settings.

The installer helper still recognizes a legacy executable/directory so it can refuse installation over running work and find the existing installation. Those strings are compatibility aliases, not current product branding. No real installed user data is used as a regression fixture.

## Remote work

Discovery reads both `@nerdsshell-id` and legacy `@betterssh-id` tokens in the bounded existing pane format. A legacy-only session keeps its token and saved pane key without a metadata rewrite. Conflicting markers fail closed before session reconciliation or an operation.

For a previously unmarked session, the guarded metadata assignment publishes the same UUID under both marker names, legacy first so downlevel clients observe the same identity. The second assignment separately verifies the legacy value and that the current marker is still empty. Nonempty values are never overwritten. These are session-local metadata operations, not shell/window/job creation or global tmux configuration.

Attach, rename and End require the observed marker, permit only an empty/equal counterpart, and reject stale/conflicting identities. An attachment that observed the current marker cannot silently downgrade to legacy-only during verification. Discovery checks the connection generation before publication. Close/Disconnect/Quit still detach persistent work; reconnect does not launch jobs or replay keystrokes. End retains explicit consequence confirmation.

## Current-only transport names

The old UI scheme and IPC channels are not accepted by the current main process. They are not persistent settings or remote job identities; each installed version uses its own matching renderer/preload. Tests reject retired origins and foreign frames before I/O. Renderer isolation, CSP, permission/navigation denial and resource allowlists remain unchanged.

Native namespace, pipe/temporary prefixes, PowerShell variables and test environments use current naming. The owned provider hashes, nonce/parent/ACL checks, UAC behavior and protected PSReadLine loading remain intact. Actual package/native and real tmux integration results are recorded for this candidate; old evidence is not relabeled as 1.0.1.

The unchanged 1.0.0 tag/candidate retains its original bytes and dated identity. This 1.0.1 build is a new candidate. Signed distribution, genuine UAC/alternate-account consent, clean-user install/upgrade and physical Windows notification/shortcut behavior remain separate acceptance gates.
