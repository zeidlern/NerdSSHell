# Security policy and data boundaries

## Reporting a vulnerability

Do not report vulnerabilities, credentials, private keys, or unredacted terminal recordings in public issues. Use GitHub's **Security > Report a vulnerability** route when it is available. If that private route is not enabled, coordinate privately with the maintainer through an already-established private channel rather than posting vulnerability details publicly.

Include the affected commit/version, operating system, minimal synthetic reproduction, impact and relevant sanitized logs. Do not include real credentials or attack unrelated systems. No response-time SLA, bug bounty or independent audit certification is promised. The current supported line is **v1.0.x**; older 0.1.x development builds are not supported.

## Threat model

Treat SSH server output, terminal escape sequences, names, SFTP replies and protocol responses as untrusted, even after authenticating the server. Protect the local computer, credentials, clipboard and session identity across the renderer/main-process boundary. Host authentication establishes the server identity, not the safety of every program running there.

The desktop renderer is sandboxed, with context isolation and no Node integration. IPC checks the sending window, main frame and exact application URL. Navigation, new windows and permission requests are denied. CSP blocks network connections and remote scripts. Terminal output is VT data, never HTML. Remote OSC 52 clipboard writes are blocked. Clipboard paste rejects terminal control characters other than tab/newline/carriage return; multiline paste still asks for confirmation. Normal keyboard interrupts are unaffected.

## Credentials and trust

Passwords and key passphrases are held in memory for the active connection and intentional network reconnection. Disconnect releases application-held references, but JavaScript, operating-system paging, crash dumps and the SSH library do not provide guaranteed secure memory erasure. Key selection stores its path, not its contents. Prefer an SSH agent or a passphrase-protected key.

OpenSSH known_hosts is read, not modified. New user-approved fingerprints are pinned locally. Changed or revoked keys are blocked. Verification cancellation/errors must not become an automatic retry loop. Trust changes require independent fingerprint verification; never suppress these failures for convenience.

## Local data

Settings and optional archives are in Electron's per-user application-data directory. On Windows this may be a roaming-profile location; backup/profile-sync policies can copy it. Archive encryption is not implemented. Protection relies on actual Windows profile ACLs and disk protection, not Unix permission numbers. Same-user malware or a compromised OS is outside the application's protection boundary.

Recording is off by default and size-limited. Output may contain echoed secrets even though raw keystrokes are not intentionally logged. Turning recording off or removing a profile does not erase old archives. Exports are plaintext. See the release checklist for verified ACLs, retention/deletion controls and optional OS-backed encryption work.

## Server operations and transfers

Missing Persistent server support is installed only after explicit approval, over a verified SSH connection. Standard SSH does not probe or install tmux. Normal use does not write sudoers, global tmux configuration, firewall settings or startup services. Closing Persistent views never sends an exit or interrupt to running shells. Standard SSH tab closure/disconnect/quit requires confirmation because closing its channel may stop work; network loss never silently replaces a Standard shell.

Per-terminal SFTP browsers use APIs on the verified transport, never shell commands or remote names as HTML. Uploads use exclusive temporary files, restrictive requested permissions and separately confirmed atomic replacement. Downloads reject final symlinks, check metadata around opening/streaming and publish exclusively to a new local filename. SFTP v3 has no portable atomic no-follow or identity binding: an undetected server-side replacement remains possible. Confirmed upload replacement also retains a concurrent-writer race. No file is automatically executed.

Listings, transfers and outstanding channel opens have independent limits and timeouts. Cancelled opens retain a resource reservation until actual completion/transport cleanup, with a combined app-wide cap of 20 outstanding opens/live SFTP channels. Hard disconnections can leave temporary files; cleanup must not delete unrelated files. Focused adversarial cancellation, delayed-open, symlink and timeout regressions cover these paths; they do not establish safety against every hostile server.

## Distribution and remaining limits

Windows installer candidates are unsigned unless a specific release artifact is explicitly identified as Authenticode-signed. Hashes do not authenticate a publisher. Electron fuse/ASAR hardening and automated dependency/secret checks are part of the release process, but no test suite proves the software is vulnerability-free. There is no unattended auto-update mechanism. Supported CI/build installs omit optional npm dependencies; the release-gating audit matches that installed build graph, while the security workflow also reports full-lock advisories for omitted optional dependencies.

Review [SECURITY-REVIEW.md](docs/SECURITY-REVIEW.md) and [PUBLIC-RELEASE.md](docs/PUBLIC-RELEASE.md). No code review or passing test suite establishes that software is free of vulnerabilities.
