<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/branding/nerdsshell/production/wordmark-dark-tagline.svg">
  <source media="(prefers-color-scheme: light)" srcset="assets/branding/nerdsshell/production/wordmark-light-tagline.svg">
  <img alt="NerdSSHell — Built for Windows nerds with Linux problems" src="assets/branding/nerdsshell/production/wordmark-light-tagline.svg" width="740">
</picture>

# NerdSSHell

**Built for Windows nerds with Linux problems.**

A Windows workspace for SSH, persistent remote sessions, local PowerShell and Command Prompt. Keep connections, tabs, split panes, file transfers and notes together instead of juggling separate windows.

**Public source version: 1.0.1; Windows release publication pending.** This independent repository contains reviewed clean history. The previous development repository remains private. A public source version is not a published or signed installer. Read the [clean migration checkpoint](docs/CLEAN-PUBLIC-MIGRATION-2026-10-06.md) and [release gates](docs/PUBLIC-RELEASE.md) before binary distribution. No independent security certification is claimed.

## Start here

**[Live Wiki manual](https://github.com/zeidlern/NerdSSHell/wiki)** · **[Repository copy](docs/wiki/Home.md)** · **[Install locally](docs/wiki/Installation.md)** · **[Install with Codex](docs/wiki/Install-with-Codex.md)**

The manual describes the implemented interface and includes connection setup, trust verification, session lifecycle, SFTP, commands, notes, preferences, shortcuts, troubleshooting, upgrades, backups and removal. The reviewed 14 chapters, sidebar and footer are maintained in `docs/wiki/` and published separately to the Wiki with editing restricted to collaborators. Keep future changes synchronized using the [Wiki publication step](docs/wiki/Publishing-the-Wiki.md). The [clean migration checkpoint](docs/CLEAN-PUBLIC-MIGRATION-2026-10-06.md) records this repository's controls; older dated setup and acceptance records identify their private historical provenance.

For a published installer, use only the project's [Releases](https://github.com/zeidlern/NerdSSHell/releases) page and verify the exact checksum and signing status. If no release exists, do not substitute an unofficial download. General users should wait for a signed, reviewed release rather than disable Windows security to run a candidate.

## What it does

| Feature | Practical use |
| --- | --- |
| Saved SSH connections | Keep server settings and locally approved trust pins together |
| Persistent Session (tmux) | Reattach to remote work after closing or disconnecting the client |
| Standard SSH | Use a regular remote shell without requiring tmux |
| Local Windows consoles | Use PowerShell and Command Prompt beside SSH sessions; deliberate next-launch Administrator option |
| Tabs and split panes | One pane, side-by-side, stacked or four quadrants, with resizable dividers and movable panes |
| File SFTP | Per-remote-pane Local/Remote file browsing, confirmed uploads/downloads and copy drag-and-drop |
| Actions and Favorites | Submit a configured command plus Enter to its originating terminal |
| Command workbench | Separately review scripts and run them in a new selected console |
| Scratchpad | Plain-text notes, bounded highlighting, local English spelling, word wrap and explicit Save As |
| Waiting alerts | Per-session indicators, optional sound and Windows notifications for recognized background prompts |
| Preferences | Clipboard behavior, terminal palettes, light/dark appearance, commands and history defaults |

## Important behavior

**Persistent Close/Disconnect is not End.** Closing a persistent view leaves its server-side work running; **End** deliberately terminates it after confirmation. Standard SSH and local consoles cannot be reattached after closure and their work may stop. A server reboot still stops persistent processes. Recovery never promises resurrection of a lost process.

**Actions/Favorites execute immediately in the current terminal context.** They do not invoke the separate workbench review. Verify the host, account, program and partial input line before clicking. A nested SSH connection, editor or password prompt is still the program receiving that input.

**History and notes are not a secret vault.** Disk recording is off by default; archives, exports, saved notes and backups are plaintext. Unsaved Scratchpad notes are memory-only. Copy-on-selection is on by default and can place terminal text into Windows clipboard history. See [security and privacy](docs/wiki/Security-and-Privacy.md).

## Requirements and local builds

The desktop target is **Windows 11 x64**. Remote connections need a reachable SSH server; persistent mode requires tmux 3.2 or newer and file transfer needs SFTP. Installers bundle the app runtime: Node.js and Codex are not needed simply to use an installer-built app.

Source builds use a current **Node 22 x64 version at least 22.12.0** and the committed lockfile. Follow the [complete installation instructions](docs/wiki/Installation.md), including source-revision verification and data backup. From a clean, reviewed checkout in normal Windows PowerShell:

```powershell
powershell.exe -NoProfile -File .\scripts\Install-Windows.ps1 -BuildOnly
if ($LASTEXITCODE -ne 0) { throw 'Build or verification failed; do not install.' }
node .\scripts\Verify-Notices.cjs
if ($LASTEXITCODE -ne 0) { throw 'License notice verification failed.' }
```

The helper uses `npm ci --omit=optional`, tests and verifies the versioned installer. `-BuildOnly` does not install; it also does not create a settings backup, sign an artifact or replace every native/manual acceptance check. Do not bypass PowerShell policy or Windows security if blocked. The manual has policy-compatible alternatives and a copy-ready Codex prompt.

## Compatibility and limits

The package, Windows app ID, UI/resource protocol, IPC and native bridge now use NerdSSHell identity. The original installer GUID is explicitly pinned so upgrades retain installation registration and directory. Existing profiles, trust pins, preferences and archives stay in their existing data folder; startup does not move, merge or delete data.

Fresh installations use `%APPDATA%\nerdsshell`. Upgrades retain `%APPDATA%\betterssh` when that legacy folder exists. Explicit `--user-data-dir` profiles remain isolated. Existing persistent sessions retain their stable tokens and saved keys; the remote legacy marker remains a compatibility alias for older clients. Current UI and new upload defaults use NerdSSHell. See [identity compatibility](docs/IDENTITY-COMPATIBILITY.md).

This version does not provide a tested ARM64/mobile/macOS/Linux desktop build, full OpenSSH configuration parity, ProxyJump, SSH tunneling UI, recursive/resumable folder transfer, cloud sync or unattended automatic updates. Prompt detection can miss unfamiliar programs. See the [known limits](docs/wiki/Troubleshooting.md) and [architecture](docs/ARCHITECTURE.md).

## Project information

[Changelog](CHANGELOG.md) · [Security policy](SECURITY.md) · [Maintainer publication checklist](docs/wiki/Maintainer-Publication.md) · [Branding](docs/BRANDING.md) · [Third-party notices](docs/THIRD-PARTY-NOTICES.md) · [Implementation/recovery log](docs/NERDSSHELL-IMPLEMENTATION.md)

NerdSSHell is **source-available**, not permissively open source. Read [LICENSE](LICENSE) for permitted use and restrictions. Third-party components retain their own licenses. [CONTRIBUTING.md](CONTRIBUTING.md) describes the no-unsolicited-code-contributions policy; report ordinary bugs with synthetic/redacted data and security concerns through a verified private channel. Public visibility does not grant visitors write access to the official repository.
