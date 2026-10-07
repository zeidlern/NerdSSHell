# Windows UX revision — owner feedback

Baseline: 3da8ce8b36b3fe69a112a2295da4e29ac191c5e0, draft PR #9.
Keep the existing branch, main and installation unchanged. Save tested checkpoints; do not merge, publish, change licensing, rewrite history or test against production servers.

## Ordered acceptance checklist

1. Mixed Persistent/Standard sessions per SSH connection; choose in New Session (Persistent on by default). Remove ended sessions immediately, including the final tmux session. Direct right-aligned Rename / Disconnect / End controls; End confirmation.
2. Cancel last/right on app dialogs; destructive prompts default to Cancel. Dedicated Layout buttons for one window, two side by side, two stacked and four quadrants (updated owner request after the dropdown checkpoint). Remove fullscreen/global Files buttons and Focus mode, including its shortcut/title double-click. Collapsible connection rail, local PowerShell button plus launch-only admin toggle and Scratchpad button. Remove unused Local data footer. Lavender/dark gray defaults; preserve customized colors. About placeholders include developer/project information.
3. Per-pane **All Actions · OS** dropdown and horizontally scrollable favorites open the selected command's exact review directly; they do not open configuration or execute immediately. Global Actions remains configuration/editor. Persist explicitly saved custom actions and per-OS favorite IDs. Deliberate Run, disruptive hostname entry and native confirmation approve a separate task on the pane's immutable host/provider; revalidate captures after consent and never inject commands into an existing agent/editor.
4. File SFTP per pane, Explorer/Commander-like local and remote directory panels with navigation, details, copy arrows and drag/drop. Copy only, no destructive move implied. Keep existing exclusive transfer publication and confirmations. Bind directory selections and pending transfers to their pane owner.
5. Shared full-height resizable/collapsible scratchpad: editable plain text with safe Markdown/code highlighting, deliberate load/save, no automatic cloud transfer or secret persistence. PSReadLine colors for supported PowerShell installations. New ordinary/admin local tabs use the current run's numbered Local PowerShell names. The next-launch Administrator switch requests Windows UAC for an embedded, newly owned ConPTY without elevating BetterSSH.
6. Regression/full/static/packaged checks and pinned Codex install instructions with backup, safe close, no security bypass and no production commands.
7. Final focused security review of new IPC, file access, session ownership, notes, action settings and UAC paths. Record findings and limits without claiming universal security or confidentiality against same-user malware.

The owner's clarified October 2 list supersedes the earlier request: Focus mode is removed, the feature is named SFTP with a per-pane File SFTP control, and the destructive control reads End Session. The owner explicitly permits modifying regression tests to validate the implementation while retaining safety coverage. Selecting an action stages a review for the captured session/provider; execution requires deliberate approval in a separate task so it cannot overwrite an existing agent/editor's input.

## Research and decisions

- Electron dialog API: https://www.electronjs.org/docs/latest/api/dialog — explicit button order plus cancelId/defaultId. Our app dialogs use Continue/Run/End first, Cancel last and default. OS-owned UAC/file pickers keep Windows behavior.
- Microsoft Start-Process: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/start-process — RunAs uses Windows elevation. The earlier checkpoint used a separate administrator window; the current implementation uses `src/elevated-pty.cjs` and `src/elevated-console.cs` for a short-lived UAC helper and embedded ConPTY. BetterSSH stays unelevated, collects no Windows password, disables no UAC/security control and installs no persistent privileged service. The admin toggle applies to the next launch, not an existing process. Only fixed supported shell IDs/paths are accepted; exact loaded C# bytes are hash-checked before compilation, not signed. The local protected pipe verifies both process IDs plus a fresh nonce, and the helper's own kill-on-close Job owns its new shell tree. Revalidated launch/review captures prevent focus or destination changes during consent from redirecting startup commands. Same-user/admin malware remains outside this boundary; real UAC and alternate-account acceptance are pending.
- Microsoft ConPTY: https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session — use dedicated input/output service and drain output during teardown. The helper uses asynchronous duplex pipe handles so a blocking input-frame read does not prevent output forwarding. Synthetic/no-elevation fixtures cannot prove a real Windows consent flow and inherit their runner's token.
- Microsoft PSReadLine: https://learn.microsoft.com/en-us/powershell/module/psreadline/set-psreadlineoption — shell-native syntax coloring is for interactive input, not arbitrary process output. Import the bundled PSReadLine module from a fixed installation location; do not alter profiles/execution policy or install a module automatically.
- WinSCP Commander UI: https://winscp.net/eng/docs/ui_commander — explicit local/remote panels and visible transfer direction. We retain per-pane ownership; narrow panes can scroll rather than redirecting transfer to another focused session.
- Scratchpad renders highlighted spans with textContent/text nodes, never raw HTML/Markdown links or images. It is not a full Notepad++ clone. Notes remain in memory until explicit Save; warn on quitting with unsaved edits.

## Known root cause found before implementation

Remote._discover returned immediately on 'no server running/no sessions', leaving old view/control state and failing to emit the empty panes list. The fix routes the empty result through normal reconciliation and notification.

## Checkpoints

Implementation and evidence to be appended here as each checkpoint is saved. The research describes design choices, not proof that native UAC, all file dialogs, every remote distribution or the owner's Windows desktop have been tested.
