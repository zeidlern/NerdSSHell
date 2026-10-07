# Install with Codex

[Manual home](Home.md) · [Manual installation](Installation.md)

Use Codex in a **local Windows workspace** that can access the intended checkout and approved Windows tools. A cloud task cannot install onto your PC simply because it can read the GitHub repository. Follow the setup and approval flow in your installed Codex client. Do not grant broad unrestricted machine access just to avoid a prompt.

Codex is optional. NerdSSHell itself does not require a Codex account, AI subscription or API key. Never supply your SSH passwords, private-key contents, GitHub tokens or signing certificate passwords in a prompt. Let the relevant tools ask for credentials through their normal secure UI.

Official Codex guidance: https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan

## Prompt A: install an official published release

Copy the entire block into your local Codex session:

```text
Install NerdSSHell on this Windows PC using an official published Windows x64 release from https://github.com/zeidlern/NerdSSHell/releases.

First verify that the release and installer asset actually exist. Report the version, source commit/tag, publisher/signing status and known limitations. Do not invent a release URL or use a third-party mirror. If there is no published installer, report that and stop rather than silently switching to an unreviewed source build.

Download to a new working directory. Verify the exact SHA-256 against the release's checksum manifest. Check Authenticode and verify the publisher against the release documentation. Stop for an invalid/mismatched signature, checksum mismatch, security detection or organizational restriction. If it is unsigned, explain that and obtain my explicit decision before any installation; do not disable Windows protections or add exclusions.

Identify any existing installation, including legacy executables, and its actual user-data path without printing personal settings. Have me save notes and finish local/Standard SSH work, then close normally. Do not force-kill the app or end remote tmux sessions. Make a private verified backup after closure; never upload its contents.

Use the verified installer with the normal per-user interactive installation flow. Preserve the existing application ID, data directory and custom install path. After installation, verify the installed version, executable/ASAR identity where practical, and that saved data survived. Launch the app normally. Do not connect to production servers, execute commands in real sessions, test Administrator mode, change server configuration, rewrite code or push to GitHub.

Summarize exactly what was installed, what was verified, where the private backup is stored locally, and any remaining uncertainty. Never label skipped tests as passes.
```

## Prompt B: build and install locally from a reviewed revision

The prompt intentionally makes the source revision explicit. When a published release tag is unavailable, Codex must report the chosen commit and the fact that it is a source candidate, not claim it downloaded an official release.

```text
Build and install NerdSSHell locally on this Windows 11 x64 PC from https://github.com/zeidlern/NerdSSHell. Use the published release tag for the intended version when available. Otherwise inspect main, report its full commit SHA and release status, and distinguish the local source build from an official release. Do not invent a release tag.

Reuse an existing checkout only after checking its remote, branch, worktrees and git status. Preserve every uncommitted/untracked user file; do not reset, clean, overwrite, force-push or silently stash. Use a separate new directory when needed. Stop if the intended source cannot be established safely. Read AGENTS.md, SECURITY.md, docs/TESTING.md, docs/DEPENDENCIES.md and docs/wiki/Installation.md.

Use a normal non-elevated Windows account and native Windows tools, not a Linux-only/WSL build represented as Windows acceptance. Verify Git and a current Node 22 x64 version at least 22.12.0. Use the committed lockfile and npm ci --omit=optional. Do not run npm audit fix --force, change dependency versions, turn off tests, disable Windows security or bypass PowerShell policy. Stop on any failed command.

Run the supported installed-graph audit and full-lockfile audit separately and report their real outcomes. Optional-dependency advisories must be disclosed, not called fixed. Build with scripts/Install-Windows.ps1 -BuildOnly, then run node scripts/Verify-Notices.cjs. On an approved disposable Windows test profile, run the documented exact-package checks only when they cannot affect real profiles, clipboard contents or sessions. Native tests can require extra approvals; request those normally rather than changing the sandbox or tests. Report tests you could not run.

Record the source SHA, package/installer version and SHA-256, and check Authenticode. If the candidate is unsigned, clearly report that and obtain my explicit decision before installing. It is not publisher-authenticated merely because it built successfully.

Identify the existing installation and actual Electron user-data folder. Have me save notes/finish local and Standard SSH work and close NerdSSHell normally; never kill existing work. Make and verify a private complete user-data backup after closure. Install the exact verified candidate for the current user, preserving application/data identity and the existing install path. Verify the resulting version and saved-data preservation, then launch the app.

Do not change this repository's code, license, visibility, branches, tags, releases, signing enrollment, accounts or remote server configuration. Do not contact production hosts or execute commands in existing terminals as a test. Keep local installation/backup records private. Give me an honest completion summary with actual tests, artifact identity and remaining limitations.
```

## Prompt C: update an existing installation

Use Prompt A for a published installer or Prompt B for a source candidate, and add:

```text
This is an upgrade. Preserve saved profiles, trust pins, appearance, Favorites, Actions, workspace state and archives. Verify the private backup before changing installation. The current installer preserves its original GUID, and startup retains existing legacy data without copying, renaming, merging or deleting it. Never overwrite newer data with an older backup automatically.
```

## Understanding a blocked attempt

A package/test failure is not solved by deleting tests. A blocked installer is not solved by disabling Defender. Codex should report the specific failure, retain useful redacted diagnostics, and explain what is needed.

A successful local build is not evidence that remote SSH, native UAC, password prompts and all interactive file dialogs work correctly on every Windows system. The current release checklist lists separate acceptance steps.
