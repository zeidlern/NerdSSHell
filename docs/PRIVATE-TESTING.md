# Private BetterSSH preview

BetterSSH v0.1.0 is an experimental Windows preview for a small group of trusted testers. It is not a signed or independently audited release. Keep the repository private. Share the installer package directly with testers rather than granting repository access solely to download it; collaborators on this personal GitHub repository receive write access and can see its development history.

## Before installing

- Use Windows 11 x64 and an SSH-accessible Linux server with tmux 3.2 or newer. Use a disposable account or sessions for testing. No server, username, key or profile is bundled.
- Compare the installer's SHA-256 with the value in the accompanying `SHA256.txt`, obtained from the maintainer through a separate trusted channel. A matching hash detects changed bytes; it does not identify the publisher.
- The installer is unsigned. If Windows or endpoint protection blocks it, stop and report that result to the maintainer. Do not disable SmartScreen, antivirus or other protections for the preview.
- Close an existing BetterSSH window normally before updating. Closing the window leaves remote sessions running. The per-user installer does not remove saved settings or local history.

## First connection

Open BetterSSH, choose **Add a connection**, and enter your own host, username and sign-in method. Verify a new server's displayed host-key fingerprint against an independent source before accepting it. BetterSSH never saves passwords or key passphrases to its settings. Optional local recording is off by default and stores plaintext output when enabled; leave it off for sensitive work.

For a first pass, create a new disposable remote session. Confirm that typing, Ctrl+V and right-click paste work once; try a two-line paste and its confirmation/cancel choice. Check two-pane and four-pane layouts, closing a tab, quitting, and reconnecting. The same remote work should still be present after view close or reconnect. **End session** intentionally terminates remote work and requires confirmation; use it only on a disposable session. Test uploads only with disposable files and directories.

## Feedback

Send the maintainer the installer hash, Windows version, sign-in method, steps to reproduce and expected/actual result through a private channel. Redact server addresses, usernames, key paths, terminal output, screenshots and logs before sharing. Do not put credentials, private keys or unredacted recordings in GitHub issues. Report suspected security flaws privately using [SECURITY.md](../SECURITY.md).

Known limits and unverified release gates are recorded in [PUBLIC-RELEASE.md](PUBLIC-RELEASE.md) and [ACCEPTANCE-RESULTS.md](ACCEPTANCE-RESULTS.md). In particular, broad native authentication, network interruption, mixed-DPI, storage-permission and sustained multi-terminal acceptance is incomplete. A private preview is not a trusted public binary release.
