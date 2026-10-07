# NerdSSHell user manual

**Built for Windows nerds with Linux problems.**

NerdSSHell brings SSH connections, persistent remote terminals, local Windows shells, file transfer and notes into one Windows workspace. This manual covers the **1.0.x** interface. Check **Help and about** and the release notes when using a different version.

## Start here

1. [Install NerdSSHell](Installation.md) from an official Windows asset or a source revision.
2. [Connect to a server](Connections-and-Trust.md) and verify its host fingerprint.
3. [Understand sessions and persistence](Sessions-and-Workspace.md) before closing terminals or ending work.
4. Use [File SFTP](File-SFTP.md), [Actions and Favorites](Actions-and-Workbench.md), and [Scratchpad](Scratchpad-and-Alerts.md).

Start with a disposable session and a harmless command, then try disconnecting and reconnecting before relying on persistence for important work.

The toolbar's **? / Help and about** opens the Wiki manual, connection guide, troubleshooting, repository, issue forms and releases.

## Features at a glance

| Feature | What it provides | Important limit |
| --- | --- | --- |
| Saved connections | Server, username, key-file path, preferences and local trust pins | Passwords and key passphrases are not saved to settings |
| Persistent sessions | Reattach to server-side tmux work after closing the client | Reboot, session termination and server policy can stop work |
| Standard SSH | An ordinary SSH terminal without requiring tmux | No reattachment after channel closure |
| Local shells | PowerShell and Command Prompt in the same workspace | Local sessions do not survive application exit |
| Layouts | Tabs and one, two or four resizable panes | Terminal programs may redraw on resize |
| Scrollback and search | Configurable received-output history and terminal find | Finite history, rather than a permanent server recorder |
| File SFTP | Local/Remote file browsers, uploads and downloads per terminal | No recursive synchronization or resumed transfers |
| Actions and Favorites | Submit configured commands into their originating terminal | The current program/context receives the input |
| Command workbench | Review a script and run it in a new selected console | A review aid, rather than a command sandbox |
| Scratchpad | Plain-text notes, highlighting, word wrap and local English spelling | Explicit Save As; unsaved notes are memory-only |
| Waiting alerts | Indicators, sound and Windows notifications for recognized prompts | Can miss prompts; never answers them |
| Appearance | Light/dark UI and terminal palette controls | Truecolor programs choose their own RGB values |

## Manual contents

- [Installation, upgrades and removal](Installation.md)
- [Codex installation prompts](Install-with-Codex.md)
- [Connections, authentication and trust](Connections-and-Trust.md)
- [Sessions, tabs and layouts](Sessions-and-Workspace.md)
- [File SFTP](File-SFTP.md)
- [Actions, Favorites and command workbench](Actions-and-Workbench.md)
- [Scratchpad and waiting alerts](Scratchpad-and-Alerts.md)
- [Preferences, clipboard, history and backups](Preferences-and-Data.md)
- [Keyboard shortcuts](Keyboard-Shortcuts.md)
- [Troubleshooting and known limits](Troubleshooting.md)
- [Security and privacy](Security-and-Privacy.md)
- [Maintainer: official releases](Maintainer-Publication.md)
- [Maintainer: publishing the Wiki](Publishing-the-Wiki.md)

## Platforms and project

The supported desktop target is **Windows 11 x64**. Remote servers may run other operating systems; persistence needs tmux 3.2 or newer. ARM64/macOS/Linux desktop and mobile builds, full OpenSSH configuration parity, ProxyJump, a tunneling UI, cloud synchronization, unattended updates and recursive/resumable transfers are not implemented.

Use [Releases](https://github.com/zeidlern/NerdSSHell/releases) for exact asset availability, signing status and known limitations. Source archives are source downloads, rather than Windows installers.

The [repository](https://github.com/zeidlern/NerdSSHell) contains the manual sources in `docs/wiki/`. The project uses a custom [source-available license](https://github.com/zeidlern/NerdSSHell/blob/main/LICENSE). Public bugs, feature requests and focused pull requests are welcome; the owner controls official acceptance and releases. See [support](https://github.com/zeidlern/NerdSSHell/blob/main/SUPPORT.md) and [contributing](https://github.com/zeidlern/NerdSSHell/blob/main/CONTRIBUTING.md).
