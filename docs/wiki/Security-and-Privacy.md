# Security and privacy for users

[Manual home](Home.md) · [Install safely](Installation.md)

NerdSSHell is a terminal client: it intentionally gives commands access to your local or remote account. It is not a sandbox that makes commands from the internet safe. Use least privilege, verify destinations and keep independent backups.

## Before trusting an installation

Use an official release or a specifically reviewed source revision. Verify the exact asset's SHA-256 and Authenticode status. A version label, checksum on the same download page, green CI badge or source visibility is not an independent security certification. Unsigned builds do not authenticate a publisher.

Check the release notes for the artifact's signing status and known limitations. No test or code review can guarantee the absence of vulnerabilities.

## Authentication and terminal safety

Verify server host fingerprints through an independent trusted channel. Stop on unexpected changed/revoked keys. Prefer an SSH agent or protected private key. Use a normal Windows account, and select Administrator only for a task that genuinely requires a new elevated local shell.

The implemented renderer is sandboxed and isolated from Node.js, with a constrained resource protocol and IPC sender checks. New windows/navigation/permissions are denied and terminal output is rendered as terminal data, not trusted HTML. These boundaries reduce attack surface; they do not make a compromised OS, hostile server or arbitrary local command harmless.

Clipboard paste checks reject unwanted terminal control characters and request confirmation for multiline input. Remote clipboard escape writes are blocked. A plain single-line command can still delete files or disclose data. Pane Actions/Favorites send Enter into the current terminal context; inspect what is receiving input.

## What is retained

Saved settings include connection addresses, usernames, key-file paths, local trust pins, preferences, layout and custom commands/Favorites. Passwords and key passphrases are not saved in settings, but are held in memory for active connections/recovery. Releasing references is not guaranteed secure memory erasure; paging, crash dumps and other software are outside that promise.

Optional terminal archives, exports and saved notes are **plaintext**. Output can contain echoed secrets. Recording is off by default. Turning it off, deleting a saved connection or uninstalling the program does not guarantee deletion of old archives/backups. Windows roaming profiles, backup software and clipboard history/sync can retain copies.

Keep configuration, logs, notes, archives and private installation records out of public issues, screenshots, Git repositories and AI prompts. Do not save tokens/passwords as custom Actions. EncodedCommand is not encryption.

## File transfers and remote processes

Verify both sides of every SFTP copy. Prefer a dedicated destination directory and avoid concurrent writers. Exclusive/new-file publishing and overwrite confirmations do not eliminate every SFTP v3 path/symlink race or malicious-server behavior. Treat downloads as untrusted until reviewed.

Disconnect/Close on a persistent view is intended to leave remote work running. **End** terminates it. Standard SSH/local closure can stop work. Reconnection does not replay disconnected keystrokes or restart vanished processes. Check state before retrying a timed-out command.

## Known audit boundary

The supported build installs with `npm ci --omit=optional`. Its dependency audit excludes optional packages but still includes development/build tools. A separate full-lock audit reports omitted dependencies too. Maintainers verify the actual installed/packaged contents and document any residual findings in the [validation results](https://github.com/zeidlern/NerdSSHell/blob/main/docs/LAUNCH-VALIDATION.md).

CodeQL being **skipped** is not a clean analysis. Gitleaks detects supported secret patterns; it is not a comprehensive personal-information scanner. Branch protection protects repository changes, not users from a vulnerable executable.

## Report a security concern

Use the [private vulnerability report form](https://github.com/zeidlern/NerdSSHell/security/advisories/new). Include affected version/SHA, impact and a minimal synthetic reproduction. Do not include real credentials or attack systems you do not own.

When that route is unavailable, request a private security contact without posting exploit details or sensitive data. Never put a vulnerability proof, credential or full terminal recording into a public bug report merely because it is easier. No response-time guarantee, bounty or independent certification is promised.

Source policy: https://github.com/zeidlern/NerdSSHell/blob/main/SECURITY.md

Primary guidance: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security) and [GitHub private reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/report-privately).
