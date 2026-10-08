# Security architecture and regression coverage

This document describes the security boundaries maintainers must preserve. Current measured results and unresolved findings belong in [validation results](VALIDATION.md); checks listed here are coverage, rather than proof that a particular artifact passed.

## Renderer and privileged operations

`src/main.cjs` owns Electron privileges. The renderer uses a sandbox, context isolation and a narrow preload API without Node integration. IPC validates the sending window, main frame and exact bundled application origin before performing I/O. The resource protocol allowlists bundled files and rejects traversal; navigation, new windows and permission requests are denied. CSP restricts scripts and connections.

Terminal data is parsed by xterm, rather than inserted as HTML. Remote filenames, profiles, command descriptions and diagnostic fields are rendered as text. Remote OSC 52 clipboard writes are blocked. Paste validates size and control bytes; multiline confirmation is revalidated against the captured destination.

Coverage: `test/security.test.cjs`, `test/application-identity.test.cjs`, `test/clipboard-shortcut.test.cjs`, `test/selection-copy.test.cjs` and `test/ux-security.test.cjs`.

## Authentication, recovery and session identity

Verified SSH authentication is shared by Persistent/Standard shells and SFTP. OpenSSH known_hosts remains read-only; explicit approvals create local pins. Changed/revoked keys fail closed and trust cancellations/errors stop automatic retries. Application-held credential references are released on explicit disconnect or Standard transport loss, without claiming secure memory erasure.

Persistent session ownership uses stable UUID markers and guarded server-side operations. Numeric tmux IDs alone cannot authorize End. Legacy markers preserve existing sessions; conflicts fail closed. Discovery, reattachment and reconnect cannot create jobs. Input queues are ordered and bounded; disconnect, replacement and input-lock changes invalidate unsubmitted input. Bytes already sent cannot be recalled.

The tmux control parser charges line/object overhead, bounds fragments/responses/queues and rejects excess geometry before terminal allocation. A timeout invalidates response ownership so late replies cannot be mistaken for another command. Renderer acknowledgements bound output; recovery uses a visible bounded resynchronization.

`src/session-limits.cjs` caps live/pending terminals at 64, counting Standard/local shells before views open and reserving before asynchronous launch/attach. Reopening/reconnecting an existing identity remains possible at the cap. The renderer separately caps retained tabs at 64, including offline tabs. Discovery rejects more than 1,024 valid pane records before metadata/view reconciliation, without truncation or server mutation. Saturation fails explicitly without terminating remote sessions. These counts bound identified paths rather than guaranteeing a fixed memory ceiling for every terminal workload.

Coverage: `test/unit.test.cjs`, `test/security.test.cjs`, `test/ux-security.test.cjs`, `test/isolation.test.cjs`, `test/input-order.integration.test.cjs`, `test/session-lifecycle.test.cjs`, `test/session-identity-compat.test.cjs`, `test/standard-output.test.cjs` and `test/mixed.integration.test.cjs`.

## Local consoles and elevation

Normal PowerShell/Command Prompt sessions use the application user's token. Administrator launches use a short-lived Windows RunAs helper with mutually checked process identity, nonce, protected local pipes and bounded terminal framing. A kill-on-close Job owns the newly created shell; pipe/broker loss disposes that owned process.

The broker and helper independently verify the pinned ConPTY DLL/OpenConsole pair against expected bounded bytes. Production staging uses exclusive creation, explicit Administrators ownership, protected Administrators/SYSTEM permissions, held path/file handles and restricted DLL search. Reparse points, ambiguous paths and untrusted ownership/ACLs are rejected. The console-host child receives a protected working directory and System32-only PATH; the interactive shell receives its restored environment. Cleanup targets only the stage owned by this operation.

PowerShell startup preserves the protected PSReadLine boundary and history policy. CMD disables AutoRun. Reviewed startup text is submitted only after readiness and a fresh destination/review check. The workbench is a review aid, not a command sandbox.

Coverage: `test/elevated-pty.test.cjs`, `test/powershell-environment.test.cjs`, `test/local-terminal.test.cjs`, `test/local-cmd.test.cjs`, `test/command-review.test.cjs`, `scripts/Elevated-Console-Smoke.cjs` and exact-packaged console/UI fixtures. A no-UAC fixture or elevated runner does not verify genuine UAC consent or alternate-account behavior.

## File transfer and local storage

Remembered login passwords are opt-in, Windows-only and encrypted with main-process `safeStorage`/DPAPI in `remembered-passwords.json`, rather than plaintext profiles/backups. Decryption verifies an encrypted binding to profile ID, normalized host, port and username. Reads, records and passwords are bounded; atomic writes preserve prior ciphertext on failure. Symlink/reparse and hardlink checks limit path substitution, but this is not protection from other applications running as the same Windows user. There is no plaintext or Linux `basic_text` fallback. Prompt saving requires successful host-verified authentication, explicit login-password consent and an unchanged credential revision; rejected password/interactive fallback cannot validate a password for saving. Forget, changed endpoints/authentication, profile deletion and rejected remembered authentication invalidate storage. The renderer has no saved-secret getter. Coverage: `test/password-store.test.cjs`, `test/remember-password-main.test.cjs`, `test/remember-password-ui.test.cjs`, `test/password-authentication.test.cjs` and `scripts/Packaged-Password-Smoke.cjs`.

SFTP/browser requests capture connection, view, browser-instance, listing generation and paths before confirmation or dialogs. Stale identities cancel rather than redirect an operation. Outstanding channel reservations survive caller cancellation until actual cleanup. Listing/metadata/stream operations have bounded timeouts and independent concurrency limits.

Local grants constrain browsing and file selection. Uploads use owned exclusive staging and explicit overwrite consent. Downloads publish exclusively to a new local name. Detectable symlink/path substitutions fail closed. SFTP v3 still lacks portable atomic no-follow and file identity; undetectable server swaps and confirmed-overwrite concurrent-writer races remain documented limits.

Atomic settings updates preserve old data on write failure. Archives have bounded queues, retention and streaming operations; plaintext exports publish exclusively. Scratchpad files are bounded UTF-8 and never executed. Recording and clipboard content can expose echoed secrets; neither output-sharing previews nor backups provide automatic redaction or encryption.

Coverage: `test/transfer.test.cjs`, `test/storage-security.test.cjs`, `test/per-pane-files.test.cjs`, `test/sftp-resource.test.cjs`, `test/ux-sftp.test.cjs`, `test/preferences.test.cjs`, `test/diagnostics.test.cjs` and disposable transfer integrations.

## Packaged resources and supply chain

Packaging disables RunAsNode, NODE_OPTIONS, Node CLI inspection and extra file-protocol privileges. Embedded ASAR integrity and only-load-from-ASAR are enabled; package verification checks actual fuse bytes, Windows integrity metadata, native hashes, JavaScript containment, branding and notices. Required native executables/libraries are explicit unpacked exceptions.

Keep fork workflows away from signing secrets and release workstations. Default workflow tokens are read-only and third-party Actions are pinned to full commit SHAs. Signing requires a reviewed source SHA and protected environment, followed by verification of the actual application and installer. Authenticode status must be reported accurately.

Coverage: `test/packaging.test.cjs`, `test/branding.test.cjs`, `scripts/Verify-Packaged.cjs`, `scripts/Verify-Notices.cjs` and `scripts/Verify-Signed.ps1`. Dependency advisories and CodeQL reports require individual reachability/impact review; a green test suite does not clear an unexplained finding.

## Acceptance limits

Clean-user Windows install/upgrade/uninstall, actual UAC approval/cancellation and alternate-account launches, native dialogs and GUI transfer bytes, physical notifications/audio, profile ACLs, clipboard, IME/accessibility and display conditions require Windows evidence for the exact artifact. Linux and synthetic renderer results must retain their narrower scope.

Primary implementation references: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses), [ASAR integrity](https://www.electronjs.org/docs/latest/tutorial/asar-integrity), [tmux control mode](https://github.com/tmux/tmux/wiki/Control-Mode), [ssh2](https://github.com/mscdex/ssh2) and [GitHub Actions security](https://docs.github.com/en/actions/reference/security/secure-use).

## Consented release upgrades

The main-process updater uses a fixed official release endpoint and exact stable-version Windows asset URL, bounded credentialless HTTPS streams and a captured SHA-256/size. It ignores release-body markup and accepts only allowlisted GitHub release-asset redirects. It uses the existing serialized renderer confirmation and normal quit/revalidation path; no renderer feed, file path or command is accepted.

A fixed checksum-bound Windows runner owns its stage/files and real parent process identity, requires explicit nonce-bound release, waits for exit, rejects conflicting registrations/reopened apps, uses an exact registered target and verifies the new version before reopening. Cancellation cannot trigger a later unrelated install. New NSIS installer and uninstaller running-app guards abort instead of killing work. The first manual upgrade from1.0.4 retains that older uninstaller's narrower acceptance limits; automatic upgrades start from the new guarded version.

Coverage: test/release-updater.test.cjs, test/update-main.test.cjs, test/update-handoff.test.cjs and isolated Windows SDK/native startup/handoff acceptance. The controlled-transport/inert-installer fixtures do not certify live future releases, real UAC or every user-install scenario.

## Quick Connect boundaries

Quick destination parsing runs in main and accepts bounded IP/DNS/account/port forms, never arbitrary SSH options or shell commands. Renderer IDs and credential fields cannot create temporary identities or persist secrets. Temporary sign-in uses the same host gate, pins and trusted serialized prompts; remembered-password lookup, consent and writes are disabled. Recent entries contain only host/port/username and remain bounded.

Generic/network-device capabilities block provider exec, persistence and task creation plus workbench OS probing and Linux automation, including after save/reload. User terminal input remains ordinary VT input and is never replayed after loss. Lifecycle callbacks bind captured entry/transport identity; failed/canceled attempts and final closures release temporary state. Promotion atomically persists immutable endpoint/auth/type and retains live pane identity; failed saving keeps the temporary original.

Coverage includes strict input/credential binding tests, temporary main lifecycle races/caps/promotion, generic provider/workbench/UI guards, real appliance-like loopback SSH and production Windows Quick Connect acceptance. Synthetic peers do not establish vendor-specific interoperability.
