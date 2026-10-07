# Troubleshooting and known limits

[Manual home](Home.md) · [Security](Security-and-Privacy.md)

Record the About version, full source SHA for source builds, Windows version, session type and exact redacted error before changing anything. Diagnose with a disposable session rather than a real job. A passed test suite narrows uncertainty but does not prove every interaction is correct on your computer.

## Installation and build problems

**A release/download is not found:** use the official [repository](https://github.com/zeidlern/NerdSSHell) and [Releases](https://github.com/zeidlern/NerdSSHell/releases). Check whether the intended version includes a Windows installer or source only. Avoid random forks and download mirrors.

**Node/npm is missing:** install the documented Node 22 x64 toolchain and open a new terminal. Use `npm.cmd` in Windows PowerShell where its script shim is blocked. Do not bypass organizational policy.

**Dependency installation fails:** retain the error, confirm connectivity/proxy settings and the committed lockfile, and use `npm ci --omit=optional`. Do not use `audit fix --force`, replace the lockfile, or repeatedly change versions until an error disappears. Corporate proxy/certificate configuration should come from your administrator, not `strict-ssl=false`.

**A check/test fails:** stop before installing. Report the first failed command and test; skipped downstream tests are not passes. Linux/WSL passing cannot replace Windows native/packaging acceptance.

**Windows flags the executable:** check the exact source, hash, signature and release notes. Unsigned builds can have unknown-publisher warnings. Do not disable security software or add broad exclusions.

## SSH and authentication problems

**Timeout/refused:** check the selected host/port, VPN/LAN path and server SSH service. A timeout does not imply a password problem. Do not change firewalls broadly or create internet port forwarding as a first response.

**Permission denied or unavailable agent:** verify username, server-authorized key and authentication method. The Windows OpenSSH agent must be available; WSL/Pageant agents are not interchangeable by assumption. A key-file path stored in a profile must still exist on this PC.

**Host key changed/revoked:** stop and verify the expected host independently. Never delete all trust records or select an insecure host-verification mode to reconnect.

**tmux missing/unsupported:** use Standard SSH for a task that does not require persistence, or have the server administrator install compatible tmux. Installation prompts are explicit server changes, not mandatory clicks.

## Missing sessions or output

Confirm the same server, account and tmux socket. Standard SSH and local sessions cannot be reattached after closure. A server reboot cannot be repaired by a client reconnection. A saved tab is not a saved process.

On a persistent session, review the current screen after reconnecting before resubmitting any command. Remote execution may have continued while you were disconnected. A timeout can leave completion unknown; blind retry can duplicate work.

In-terminal search covers the available view buffer. Archive search requires recording to have been enabled while receiving output. Increasing scrollback cannot recreate lost history. Busy/full-screen programs may repaint when resized; capture a sanitized minimal reproduction rather than injecting control sequences or killing the session.

**Terminal limit reached:** NerdSSHell permits up to 64 open/pending terminals across the app and 64 retained tabs, including offline tabs. Other discovered sessions remain available in the sidebar. Close an unused Persistent view to free a slot; its remote work keeps running. Finish local/Standard work before confirming closure. A discovery result exceeding 1,024 panes is rejected without changing server sessions; use the intended account/tmux socket and review unusually large session lists on the server.

## File SFTP problems

Confirm that the server supports SFTP and that the connected account can access the directory. Verify which pane owns the browser. Its remote directory is independent of shell `cd`, nested SSH and `sudo`.

Choose a **new** local download name when an existing destination is rejected. Recursive directories, transfer resume and destructive move operations are not implemented. On a broken connection, do not assume a partial file is complete or delete arbitrary temporary files.

## Clipboard, Favorites and notes

**Ctrl+C interrupted instead of copying:** a terminal selection was not present. Select text first. **Ctrl+C did not interrupt:** clear the selection, then interrupt deliberately.

**A Favorite did something unexpected:** it sends its text plus Enter to the current program inside that pane. It is not the separate review/new-console workbench. Check shell/context and avoid password prompts or partial input lines.

**Notes disappear after restart:** unsaved Scratchpad text is memory-only. Use Save As explicitly. Collapse preserves it only within the running app. Save As refuses an existing destination; choose another filename.

**Spelling suggestions do not appear:** local Windows English spelling availability varies; the app intentionally blocks external dictionary fallback. Do not change network/security settings just to enable suggestions.

**Alerts are quiet:** check all four settings in Notifications & Alerts and Windows Do Not Disturb. The active terminal is intentionally quiet. Unsupported prompt wording may not be recognized. Use a harmless background test prompt.

## Report a normal bug

Use the repository's bug-report form. Include version/SHA, Windows version, local versus remote and persistent versus Standard mode, steps with fake data, expected result, actual result and a redacted error. Crop screenshots to remove addresses, usernames, terminal contents and filesystem paths that do not need to be public.

Security vulnerabilities and credentials belong in a verified private reporting channel, **not** an ordinary public issue. Do not upload your complete application-data folder.

## Deliberate limitations

Windows 11 x64 desktop only; no tested ARM64 installer. No full OpenSSH configuration parity, ProxyJump, forwarding UI, automatic cloud sync or unattended updater. No recursive/resumable folder transfer. No encrypted archive vault or universal session resurrection. No guarantee that every Linux/macOS recipe works on every release. Native UAC/alternate-account consent, OS pickers, new-user upgrades, notification delivery and accessibility/IME/multimonitor combinations require their own exact-build testing.
