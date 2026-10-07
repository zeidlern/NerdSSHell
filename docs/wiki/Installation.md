# Installation, upgrades and removal

[Manual home](Home.md) · [Codex prompts](Install-with-Codex.md)

## Choose your installation route

**Most users:** install an official Windows x64 release. Node.js, Git and Codex are not prerequisites for running an installer-built app. Electron and the application runtime are bundled.

**Maintainers and authorized source users:** build a reviewed revision on Windows. This requires Git, Node.js/npm and network access for dependencies and packaging tools. Source-build instructions do not grant redistribution rights; read LICENSE.

> At this manual's October 6, 2026 preparation, no GitHub Release existed. A file named `NerdSSHell-1.0.0-x64-Setup.exe` in a development/CI folder is a candidate, not proof that version 1.0.0 has been publicly released. Do not download a similarly named executable from a search result or unofficial mirror.

## Requirements

Use Windows 11 x64, a normal Windows user account, and adequate free disk space. Source builds need substantially more disk space than the installed application. The Node 22 line is used by the project's CI; use an up-to-date **Node 22 x64 build at least 22.12.0**, not an arbitrary newer major version merely because it installs. Reopen PowerShell after installing Git/Node so PATH updates take effect.

For remote work, you need a reachable SSH server, an authorized username and password/key/agent. File transfer requires the server's SFTP subsystem. Persistent mode needs tmux 3.2 or newer and a suitable Unix-like shell. Local PowerShell/Command Prompt do not require a remote server.

Do not expose a home server's SSH port to the internet just to use NerdSSHell; a trusted LAN or properly managed VPN is enough when it provides connectivity.

## Route A: an official installer

1. Open the project's **Releases** page. Choose a release whose notes explicitly describe the Windows x64 artifact, its signing status and known limitations. Download the `...-x64-Setup.exe` asset, not GitHub's automatic source-code ZIP.
2. Compare the download's SHA-256 with the checksum published for that exact asset. In PowerShell, using your real download path:

   ```powershell
   Get-FileHash -LiteralPath "$HOME\Downloads\NerdSSHell-1.0.0-x64-Setup.exe" -Algorithm SHA256
   Get-AuthenticodeSignature -LiteralPath "$HOME\Downloads\NerdSSHell-1.0.0-x64-Setup.exe" |
       Format-List Status,StatusMessage,SignerCertificate
   ```

   The filename is an example for the 1.0.0 target; use the actual released version. A matching hash checks byte identity, not the publisher's identity. For a signed release, the signature must be valid and the publisher must match the release documentation. An unexpected publisher or invalid signature is a reason to stop.
3. Save notes and finish local/Standard SSH work. Exit an existing NerdSSHell normally. Do not use Task Manager to kill it as a routine upgrade step.
4. Run the installer interactively as your normal user. Keep the existing installation directory on upgrades unless the maintainer explicitly documents a migration. A per-user install is the normal route.
5. Launch NerdSSHell from Start, open **? / Help and about**, and verify the version. Begin with a disposable test session.

**Unsigned candidates:** Windows may report an unknown publisher or apply reputation-based blocking. This manual does not instruct users to disable Defender, SmartScreen, signature checks or organizational controls. General users should wait for a signed release; authorized testers should have the publisher/provenance and risks reviewed through their normal security process. Stop on security detection or a checksum mismatch.

## Route B: build from reviewed source

Open a normal Windows PowerShell terminal in a directory where you keep source projects. Authenticate to GitHub only through normal Git/Git Credential Manager prompts; do not embed tokens in clone URLs or paste them into an AI chat. A private repository is readable only by authorized accounts.

```powershell
git clone https://github.com/zeidlern/NerdSSHell.git
if ($LASTEXITCODE -ne 0) { throw 'Clone failed.' }
Set-Location NerdSSHell
git status --short
git rev-parse HEAD
node --version
npm.cmd --version
```

For a reproducible release build, use the published reviewed commit or release tag, not an unexplained branch. For example, after a `v1.0.0` tag actually exists, fetch and check out that tag in this new checkout. Do not assume that it has been created. Record the full SHA before building. Existing working copies with local changes must not be reset, cleaned, overwritten or silently stashed.

Inspect `AGENTS.md`, `SECURITY.md`, `package.json` and `scripts/Install-Windows.ps1`. The supplied helper runs locked dependency installation, source checks, unit tests, Windows packaging and package verification:

```powershell
powershell.exe -NoProfile -File .\scripts\Install-Windows.ps1 -BuildOnly
if ($LASTEXITCODE -ne 0) { throw 'Build or verification failed; do not install.' }
node .\scripts\Verify-Notices.cjs
if ($LASTEXITCODE -ne 0) { throw 'License notice verification failed.' }
```

`-BuildOnly` stops before installation. The helper prints the exact versioned installer location and SHA-256. It does **not** run every packaged UI acceptance fixture, create a settings backup, enable signing or prove that the application is secure. It uses `npm ci --omit=optional`; replacing this with unrestricted `npm install` changes the supported dependency graph.

Inspect the generated artifact, then run that exact installer interactively. Alternatively, the helper without `-BuildOnly` rebuilds, verifies and installs silently for the current user; `-NoLaunch` prevents automatic launch. It refuses to install while the current application or a legacy executable runs. For first-time users, build first and run the installer interactively to review the steps.

If PowerShell policy blocks the helper, do not use `-ExecutionPolicy Bypass` or disable policy. Use the manual commands below only where your machine's policy permits development, or consult its administrator:

```powershell
npm.cmd ci --omit=optional
if ($LASTEXITCODE -ne 0) { throw 'Dependencies failed.' }
npm.cmd run check
if ($LASTEXITCODE -ne 0) { throw 'Source checks failed.' }
npm.cmd test
if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
npm.cmd run dist
if ($LASTEXITCODE -ne 0) { throw 'Packaging failed.' }
npm.cmd run verify:package
if ($LASTEXITCODE -ne 0) { throw 'Package verification failed.' }
node .\scripts\Verify-Notices.cjs
if ($LASTEXITCODE -ne 0) { throw 'Notices failed.' }
```

From an already prepared checkout, `npm.cmd start` launches the development app. It is not a sandboxed substitute for an isolated test profile: it can use the same application data as the installed app. Do not run development and installed copies against real settings concurrently.

## Upgrade and rollback

Before an upgrade, locate the actual data folder, close the application and copy the entire folder privately. Version 1.0.1 uses `%APPDATA%\nerdsshell` for fresh installations and retains an existing `%APPDATA%\betterssh` legacy folder for upgrades; confirm which contains `settings.json`. Startup does not copy, merge or delete either folder. The UI has no visible Data folder button. Do not create/delete directories based only on the display name. Backups contain private profiles, trust pins and possibly terminal output. The installer helper does not create this backup.

After upgrading, check About, saved connections, trust behavior, Favorites and disposable persistence. Package/app ID use current NerdSSHell identity; the original installer GUID and existing data directory preserve upgrades. If both default folders exist, startup selects legacy data and leaves the current folder untouched. Review that state deliberately; do not merge or delete either copy blindly.

For rollback, stop and retain both the old backup and current data. Install only an earlier verified artifact, and do not assume newer settings can be read by older builds. Restore a compatible backup only deliberately while the app is closed. Rollback does not restore a terminated remote process.

## Uninstall

Use **Windows Settings > Apps > Installed apps > NerdSSHell > Uninstall**. Save notes and close local work first. The configured uninstaller preserves application data. That is useful for reinstalling, but it is not a privacy wipe. Review and remove retained data/backups separately after confirming you no longer need them. Uninstalling the Windows app does not itself delete server-side tmux sessions; never terminate remote jobs merely to remove a local installation.

Source references: `scripts/Install-Windows.ps1`, `package.json`, `scripts/Verify-Packaged.cjs`, `scripts/Verify-Notices.cjs`.
