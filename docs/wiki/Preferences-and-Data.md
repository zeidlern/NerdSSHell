# Preferences, clipboard, history and backups

[Manual home](Home.md) · [Security](Security-and-Privacy.md)

## Preferences workflow

Open **Preferences**, choose a category on the left and edit on the right. The dialog has a shared draft: **Save** commits validated settings together, while **Cancel** discards edits and restores previewed appearance. An inner control such as **Keep custom action** is not the final Save for the entire dialog.

Categories are **Copy & Paste**, **Terminal Colors**, **System Colors**, **Configure Actions**, **Configure Favorites**, **Notifications & Alerts**, and **Sessions & History**.

## Clipboard behavior

Copy-on-selection is enabled by default. Select terminal text to copy it; disable this in Copy & Paste if merely highlighting sensitive output should not change the clipboard.

**Ctrl+C** copies when a terminal selection exists. Without a selection, it sends the normal interrupt to the terminal program. Right-click copies a selection; with no selection, it pastes through the application's paste path. **Ctrl+V** also pastes through that path when a terminal is focused. Normal text-entry fields keep their ordinary editing behavior.

Multiline clipboard paste asks for confirmation. Clipboard terminal control characters are rejected except the permitted whitespace. These checks do not make pasted shell commands safe: a single line can be destructive, and an embedded newline can submit input. Review the selected terminal's program, destination and privilege level first.

Windows clipboard history/sync and other software can retain what you copy. NerdSSHell does not control those operating-system features. Remote OSC 52 clipboard writes are blocked; do not treat a malicious server's output as a trusted instruction.

## Terminal and system colors

System Colors provides light/dark presets plus application background, accent and text colors. The default accent is logo blue `#00aaf0`. Explicit saved colors are preserved across updates.

Terminal Colors controls the terminal background, ANSI palette slots and indexed colors. Use the preview/palette controls to identify the slot to change. Indexed colors cover slots 16–255; reset a slot to undo its override. Preserve legibility and contrast rather than making comments/status messages disappear.

The remote program decides which color codes it emits. An ANSI/indexed setting can change colors for programs using that palette, but cannot reliably recolor a program that sends explicit truecolor RGB. NerdSSHell does not rewrite Vim themes, shell profiles or server configuration. Local PowerShell highlighting also depends on supported PSReadLine behavior.

## Scrollback versus recordings

There are three different histories:

| History | Stored where | What it contains |
| --- | --- | --- |
| Current terminal scrollback | In the local terminal view | Bounded received output; searched with Ctrl+F |
| Persistent tmux history | On the SSH server | Whatever tmux still retains for that session |
| Optional searchable archives | On this PC | Output received while views are open and recording is enabled |

The default terminal scrollback is **100,000 lines**, configurable from **1,000 to 500,000**. This is a finite buffer with memory costs, not unlimited retained output. Larger settings do not recover previously discarded output.

Disk recording is **off by default**. Enable **Save searchable output on this PC** per connection only when appropriate. Default archive retention is **256 MB per server/profile**, configurable from **16 to 4,096 MB**. This is not an automatic recorder that follows server work while the client is disconnected.

Use **Ctrl+Shift+F** on a remote terminal to search recorded output and the dialog's Export control to create a plaintext export. No results may simply mean recording was never enabled. Full-screen terminal redraws are not faithfully represented as a video/screen recording.

Input is not separately recorded as a keystroke log, but echoed commands, passwords printed by programs and API tokens in output can appear. Turning recording off or removing the saved connection does not erase old archives. Archive encryption is not implemented. There is no documented in-app recording-deletion control in this version; inspect the actual application-data folder only after closing the app and understanding which files are being retained.

## Defaults versus existing connections

Sessions & History sets defaults for **new connections**. Existing connections retain their own saved scrollback, recording, retention and startup settings. To change an existing server's behavior, edit that connection deliberately. Editing disconnects it, so finish nonpersistent work first.

Startup defaults connect automatically and open all currently running sessions. Change these where automatic authentication or opening many views would be inconvenient.

## Find and back up your data

In the standard installed Windows build, open `%APPDATA%\betterssh` in Explorer and verify that it contains the existing `settings.json`. The legacy folder name is intentional. The backend exposes the actual path and a data-folder operation, but the current UI does not wire a visible Data folder button. Do not delete a directory because its old name looks wrong, and do not create an empty replacement if the expected settings are missing. A development test profile or redirected Windows roaming profile can use a different effective path; confirm the actual environment before a backup or restore.

`settings.json` contains profiles, trust pins, appearance, workspace layout and saved Actions/Favorites. Normal saving retains `settings.json.backup`. That single backup is not a substitute for your own complete, versioned private backup.

Close the app normally before copying its whole data directory. Keep backups outside the repository and protect them as personal configuration. Do not upload settings, archives, diagnostic dumps or backups to GitHub, Discord or an AI service. If Windows uses a roaming/synchronized profile, organizational backup/sync policies may copy those files elsewhere.

A malformed settings file is preserved and causes an explicit error rather than being silently replaced. Retain the original and investigate/restore a known-good compatible backup; deleting it blindly can discard connections and trust pins.

Source references: `src/preferences.cjs`, `src/storage.cjs`, `src/core.cjs`, `ui/appearance.js`, `ui/selection-copy.js`, `ui/app.js`.
