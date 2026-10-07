# Security policy

## Report a vulnerability privately

Use [GitHub's private vulnerability report form](https://github.com/zeidlern/NerdSSHell/security/advisories/new). Do not put vulnerabilities, credentials, private keys or unredacted terminal recordings in public issues or pull requests. If the form is unavailable, use an already-established private channel with the maintainer; a public issue may ask for a private contact without disclosing technical details.

Include the affected version/commit, Windows version, a minimal synthetic reproduction, expected impact and relevant sanitized logs. Do not include real credentials or test unrelated systems. The supported line is **v1.0.x**. Reports are handled as time permits; no response-time SLA, bug bounty or independent audit certification is promised.

## Trust boundaries

Treat SSH server output, escape sequences, names, SFTP replies and protocol responses as untrusted, even after verifying a server's identity. Host authentication does not establish that every remote program or file is safe.

The desktop renderer is sandboxed, with context isolation and no Node integration. Main-process IPC validates the sending window, main frame and exact application URL. Navigation, new windows and permission requests are denied. CSP blocks remote scripts and network connections. Terminal output is VT data, never HTML. Remote OSC 52 clipboard writes are blocked. Clipboard paste rejects terminal control characters other than tab/newline/carriage return; multiline paste requires confirmation.

Passwords and key passphrases remain in memory for an active connection and intentional reconnection. Disconnect releases application-held references. JavaScript, paging, crash dumps and the SSH library do not guarantee secure erasure. Key selection stores the path, rather than key contents. Prefer an SSH agent or a passphrase-protected key.

OpenSSH known_hosts is read without modification. User-approved fingerprints are pinned locally. Changed or revoked keys are blocked; cancellation and verification errors stop trust retries. Verify key changes independently rather than suppressing a trust failure.

## Sessions, commands and transfers

Persistent Close/Disconnect/Quit leaves remote work running. Discovery and reconnect never launch jobs or replay disconnected input. End requires explicit confirmation and a stable session identity. Standard SSH and local closure require confirmation because their work may stop. Standard network loss never silently creates a replacement shell.

Actions and Favorites execute immediately in their originating terminal context. The separate workbench reviews a command and creates a new selected console. Neither provides a command sandbox. Administrator consoles use Windows UAC; NerdSSHell does not collect a Windows password or change security policy.

Missing Persistent server support is installed only after explicit approval over a verified connection. Normal use does not change sudoers, global tmux configuration, firewalls or startup services.

SFTP uses APIs on the verified transport. Filenames are text, never HTML or shell commands. Uploads use exclusive temporary files and separately confirmed replacement. Downloads reject detectable final symlinks and publish exclusively to a new local name. SFTP v3 lacks portable atomic no-follow or identity binding: a server-side swap restored between checks or same-size/time replacement can evade detection. Confirmed upload replacement retains a concurrent-writer race. Downloaded files are never automatically executed.

Listings, transfers and outstanding channel opens have separate limits and timeouts. Cancelled opens retain reservations until actual completion or transport cleanup, with an app-wide combined cap of 20 outstanding opens/live SFTP channels. Hard disconnections can leave temporary files; cleanup targets only files owned by the operation.

## Local data and privacy

Settings and optional archives use Electron's per-user data directory; see [data location and compatibility](docs/IDENTITY-COMPATIBILITY.md). Windows roaming/profile policies may copy that data. Protection depends on actual Windows ACLs and disk protection. Same-user malware and a compromised OS are outside the application's protection boundary.

Recording is off by default and size-limited. Output can contain echoed secrets. Archives, exports, notes and backups are plaintext; encryption is not implemented. Turning recording off or removing a profile does not erase old archives. Unsaved Scratchpad notes remain in memory. There is no archive-deletion control in the UI.

Copy-on-selection is enabled by default. Windows clipboard history/synchronization can retain copied data; the app does not control those OS features. Output-sharing previews require review and do not automatically redact secrets.

## Distribution

Use official [Releases](https://github.com/zeidlern/NerdSSHell/releases) and inspect each artifact's documented signing status. An unsigned artifact has no Authenticode-verified publisher identity; a checksum verifies bytes, rather than publisher identity. There is no unattended auto-update mechanism.

Supported builds use `npm ci --omit=optional`. Dependency validation distinguishes that installed graph from the complete lockfile; see [dependency maintenance](docs/DEPENDENCIES.md). Electron fuse and ASAR-integrity checks, native-provider verification, secret scanning and adversarial regressions are part of validation, but cannot prove absence of vulnerabilities.

See [security architecture and regression coverage](docs/SECURITY-REVIEW.md), [release validation](docs/PUBLIC-RELEASE.md) and [current validation results](docs/VALIDATION.md).