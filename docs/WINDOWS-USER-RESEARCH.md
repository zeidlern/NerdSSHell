# Windows-first command workbench: research and product decisions

Research snapshot: October 2, 2026. This is qualitative product research and a bounded engineering proposal, not a representative survey, proof of demand, or revenue forecast. Feature documentation establishes what competitors offer; issue discussions establish that particular users encountered a problem, not how frequently the whole market encounters it. Closed issues below are historical design lessons, not claims that current competitors still have those defects.

## Product hypothesis

The target is a Windows user managing Linux/macOS machines and long-running console applications who does not want to learn a second terminal-management vocabulary. The differentiated workflow is **review a command from chat, choose the right computer, run it without disturbing existing work, and bring understandable output back**. Local PowerShell alone is not a differentiator, nor is a longer list of SSH options.

The user's existing workflow supplies a concrete initial case: Windows PowerShell for local work, remote persistent terminals for coding agents, frequent copying of instructions and diagnostic output, and uncertainty about which command belongs to which computer. That is a useful design input, not evidence that all Windows users have the same needs.

## Evidence and decisions

| Observed need or tradeoff | Evidence | Decision for this iteration |
|---|---|---|
| Pointer habits are inconsistent across terminals; copying, selecting and pasting can surprise users. | The Windows Terminal pointer-bindings discussion collects requests for different copy/paste, selection and context-menu behavior [1]. Microsoft's interaction documentation explains both automatic copy and multiline/large-paste warnings [2]. | Preserve the existing user-selectable copy-on-highlight and manual paste behavior. Do not replace familiar terminal interaction with an AI-first interface. Add a separate review surface rather than intercept every ordinary keystroke. |
| Restoring a window or its text is not the same as preserving a running process. | Terminal issue #961 explicitly distinguishes restoring a buffer from restoring process state; that feature discussion was closed after implementation work [3]. | Keep the server-side persistence model. Clearly label local PowerShell and Standard SSH as nonpersistent. Do not sell local tab restoration as process survival. |
| Identity must outlive names and view rearrangement. | A fixed Terminal restoration bug concerned selecting the wrong profile when using names rather than GUIDs [4]. | Capture destination objects/IDs and invalidate approved work when the connection changes. Pane focus, rename, or SFTP navigation cannot redirect a reviewed command. |
| A search box scales better than an ever-expanding toolbar. | Windows Terminal offers a searchable command palette and nested/profile-derived commands, conventionally opened with Ctrl+Shift+P [5]. | One Actions entry and the familiar shortcut. Searchable categories, descriptions, and at most three favorite action IDs; no credential-bearing custom snippets stored by default. |
| Local and remote shells plus file access already exist together. | Tabby's maintained README lists PowerShell/WSL/SSH, splits, SFTP and clipboard controls; it explicitly does not describe itself as lightweight [6]. MobaXterm documents saved connections, graphical SSH file transfer and a broad Windows remote-tool set [7]. | Add PowerShell to remove a real workflow gap, but keep the distinctive command-review and destination-safety workflow central. Preserve the per-pane SFTP browser instead of duplicating an all-protocol administration suite. Do not claim this Electron build is now lightweight. |
| Rich remote assistance comes with deployment and compatibility tradeoffs. | Warp documents an optional remote extension, supported hosts/shells and where an extension cannot be used; at this snapshot the extension is not available from its Windows client [8]. This is not a claim that Warp lacks ordinary SSH. | Use the already authenticated SSH connection and a separate task console. No new inbound service, resident management daemon, or downloaded shell integration is introduced for Quick Actions. |
| “Run as administrator” is not a portable model for sudo. | sudoers documents per-terminal caching and policy-dependent timestamp records [9]. | Offer an explicitly scoped sudo -v console, with no invented countdown or global “admin enabled” state. Other consoles may prompt again. Never capture/cache the sudo password in an action form. |
| Friendly update buttons can hide dangerous platform differences. | checkupdates uses a separate pacman database and documents status 2 as no updates [10]. Package-manager operations are not interchangeable. | Unknown platforms fail closed. Arch uses checkupdates when installed and full pacman -Syu for upgrades; never a standalone live-database refresh. APT cached checks and DNF status 100 are explained. No automatic -y or reboot. |

## What ships in the workbench scope

The first increment combines an actual embedded local PowerShell terminal, a small OS-aware action catalog, an editable command composer, fenced-code extraction, clear target badges, backend input locking, and reviewable diagnostic copying. Users remain in control of the raw terminal. Code blocks are separate choices, not an automatically executed playbook. Commands are never translated or declared safe by a model.

Built-in actions explain the intention and display the exact command. Named service/container arguments are validated and quoted. Missing tools leave actions unavailable. Custom commands still need a reviewed destination and final confirmation, and run under the selected account's actual permissions; warnings are limited pattern checks, not a sandbox or security analysis.

A task uses a NEW console, so running an update cannot paste text into an existing Hermes prompt, editor, password prompt or partially entered shell command. Remote task syntax is explicitly /bin/sh and its directory is the account's default starting directory. Users must include an explicit cd when needed. The SFTP directory and a nested ssh/sudo inside another terminal are not used as authority for target selection.

The code retains existing Electron and SSH protections. Local terminals use the reviewed node-pty ConPTY implementation rather than a pipe disguised as an interactive shell. Only the required x64 native files may be unpacked; their fixed hashes are checked at packaging and before local-console initialization. This adds a native dependency and therefore another component to audit. It is not a performance or security certification.

## Deliberately deferred

Do not add broadcast typing, unattended AI execution, automatic Bash/PowerShell translation, cloud transcript upload, password responders, hidden privilege escalation, or generated destructive commands. These features create new failure modes that conflict with the intended novice audience.

A durable local process broker, true cross-device workspaces, automatic command-boundary history, reliable agent-state notifications, and Docker/service dashboards need separate lifecycle/security designs. Do not label silence as completion or claim a backgrounded local shell survives a reboot. A Rust/Tauri port, iPad support, ARM64 release, remote editor, and general plugin system are separate projects, not quietly bundled into this change.

## How to validate usefulness rather than just add features

For an initial small pilot, ask testers to perform five tasks without coaching: open local PowerShell; run a harmless remote disk-space action; import two chat code blocks and choose the right target for each; lock a monitoring pane; and return a redacted diagnostic excerpt. Observe target mistakes, abandoned workflows, prompts that cause confusion, and whether users return to plain PowerShell/another SSH tool. These are proposed observations, not already collected results.

Success should mean fewer destination mistakes and less copying friction while retaining control. Record time to first useful remote action and repeated use, but do not turn an invented target number into a benchmark. Measure idle memory, startup time, large-output responsiveness and native-console overhead on actual Windows hardware before making speed or efficiency claims. Ask directly which action saves enough work to justify installing another client; a positive reaction to a screenshot is weak evidence of willingness to pay.

## Sources inspected

[1] Microsoft Terminal, mouse/touch/pointer bindings issue #1553: https://github.com/microsoft/terminal/issues/1553

[2] Microsoft Terminal interaction settings, including selection and paste warnings: https://learn.microsoft.com/en-us/windows/terminal/customize-settings/interaction

[3] Microsoft Terminal, restoring session buffer contents, issue #961: https://github.com/microsoft/terminal/issues/961

[4] Microsoft Terminal, wrong restored profile by name versus GUID, issue #19105: https://github.com/microsoft/terminal/issues/19105

[5] Microsoft Terminal command palette: https://learn.microsoft.com/en-us/windows/terminal/command-palette

[6] Tabby primary README: https://github.com/Eugeny/tabby/blob/master/README.md

[7] MobaXterm official documentation, sessions and graphical SSH browser: https://mobaxterm.mobatek.net/documentation.html

[8] Warp official SSH extension documentation and requirements: https://docs.warp.dev/terminal/warpify/ssh

[9] sudoers manual, User Authentication and timestamp_type: https://man.archlinux.org/man/sudoers.5.en

[10] checkupdates manual: https://man.archlinux.org/man/checkupdates.8.en
