# NerdSSHell user manual

**Built for Windows nerds with Linux problems.**

NerdSSHell brings SSH connections, persistent remote terminals, local Windows shells, file transfer and notes into one Windows workspace. This manual describes the **1.0.0 source line**, checked against the implemented interface rather than a feature wish list.

> **Release status:** a version number in the source is not a published or signed release. At preparation on October 6, 2026 (US Central), the repository was private and no GitHub Release had been published. Installer candidates were unsigned. Use the project's Releases page to establish what is actually available. Do not turn off Windows security to install this application.

## Start here

1. [Install NerdSSHell](Installation.md), either from an official installer or a reviewed source revision.
2. [Connect to your first server](Connections-and-Trust.md) and verify its host fingerprint.
3. [Understand sessions and persistence](Sessions-and-Workspace.md) before closing terminals or ending work.
4. Use [File SFTP](File-SFTP.md), [Actions and Favorites](Actions-and-Workbench.md), and [Scratchpad](Scratchpad-and-Alerts.md).

A new user should start with a disposable account or session, without Administrator mode, and with disk recording off. Test a harmless command, disconnect, and reconnect before trusting persistence with important work.

## Features at a glance

| Feature | What it provides | Important limit |
| --- | --- | --- |
| Saved connections | Server, username, key-file path, preferences and local trust pins | Passwords and key passphrases are not saved to settings |
| Persistent Session (tmux) | Reattach to server-side work after closing the client | Server reboot, session termination and server policy can still stop work |
| Standard SSH | Ordinary SSH terminal without requiring tmux | No reattachment; disconnection can terminate work |
| Local shells | PowerShell and Command Prompt in the same workspace | Local sessions do not survive application exit |
| Layouts | Tabs; one pane; two side by side; two stacked; four quadrants | Resizing may cause terminal applications to redraw |
| Scrollback and search | Configurable received-output history and in-terminal find | Not unlimited, and not a permanent server recorder |
| File SFTP | Per-terminal Local/Remote file browsers, uploads and downloads | Files, not recursive folder synchronization or resumed transfers |
| Actions and Favorites | Insert a configured command and send Enter in the selected terminal | They execute in that terminal's current program/context |
| Command workbench | Review a script and run it in a new, explicitly selected console | Warnings are not a security sandbox or correctness guarantee |
| Scratchpad | Plain-text notes, highlighting, word wrap and local English spelling | Save As is explicit; unsaved notes are memory-only |
| Waiting alerts | Indicators, sound and Windows notification for recognized prompts | Detection can miss prompts; it never answers them |
| Appearance | Light/dark UI and terminal palette controls | Programs using truecolor choose their own RGB values |

## Manual contents

- [Installation, upgrades and removal](Installation.md)
- [Copy-ready Codex installation prompts](Install-with-Codex.md)
- [Connections, authentication and trust](Connections-and-Trust.md)
- [Sessions, tabs and layouts](Sessions-and-Workspace.md)
- [File SFTP](File-SFTP.md)
- [Actions, Favorites and command workbench](Actions-and-Workbench.md)
- [Scratchpad and waiting alerts](Scratchpad-and-Alerts.md)
- [Preferences, clipboard, history and backups](Preferences-and-Data.md)
- [Keyboard shortcuts](Keyboard-Shortcuts.md)
- [Troubleshooting and known limits](Troubleshooting.md)
- [Security and privacy for users](Security-and-Privacy.md)
- [Maintainer: publishing and protecting the project](Maintainer-Publication.md)
- [Maintainer: publishing these Wiki pages](Publishing-the-Wiki.md)

## Product boundaries

The supported desktop target is **Windows 11 x64**. A Windows ARM64 installer, macOS/Linux desktop app, mobile app, full OpenSSH configuration compatibility, ProxyJump, SSH tunneling/port-forwarding UI, cloud synchronization, unattended auto-update and recursive/resumable file transfer are not implemented in this version. A Windows client may connect to suitable SSH servers on other operating systems; persistent mode specifically needs compatible tmux support.

The program is source-available under the repository's custom LICENSE, not an unrestricted open-source grant. Public visibility does not give visitors write access to the official repository or permission to redistribute modified builds.

## Documentation and evidence

The source of these pages is `docs/wiki/` in the main repository. The Wiki is a separately published copy. Prefer documentation that matches the version shown in Help/About. Old dated development documents retain their original test results and are not the current installation instructions.

Repository: https://github.com/zeidlern/NerdSSHell

Release downloads: https://github.com/zeidlern/NerdSSHell/releases

Source references: `README.md`, `package.json`, `ui/index.html`, `src/preferences.cjs`, `SECURITY.md`.
