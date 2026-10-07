# Sessions, tabs and layouts

[Manual home](Home.md) · [Shortcuts](Keyboard-Shortcuts.md)

## Pick the correct session type

| Session type | Where the process runs | After closing NerdSSHell |
| --- | --- | --- |
| Persistent Session (tmux) | On the SSH server inside tmux | The server-side session is intended to keep running |
| Standard SSH | On the SSH server through an ordinary SSH shell channel | It cannot be reattached; work can stop |
| Local PowerShell / Command Prompt | On this Windows PC | The console/work does not persist |

Persistence protects against closing/disconnecting the client, not against server reboot, killing tmux, storage failure or an administrator terminating your process. A background job has its own application-level failure modes. Important work still needs sensible checkpoints and backups.

## Create and reopen remote sessions

Select the saved connection, connect, and use the new-session control or **Ctrl+Shift+T**. Supply a recognizable name. Leave **Persistent Session (tmux)** enabled for work that should survive disconnects; clear it to create Standard SSH.

Running persistent sessions are discovered under their connection. Select one to open its view. Depending on the connection's startup preference, NerdSSHell opens all running sessions, restores previously viewed sessions, or only lists them. These policies restore views of existing work; they do not resurrect processes lost in a reboot.

## Close, Disconnect, End and Rename

**Close view/tab:** removes that local view. For a persistent session this is not the same as terminating the server-side session. For a local or Standard shell, closing the view can terminate work and requires consequence confirmation.

**Disconnect:** disconnects remote transport/view handling while persistent server work remains alive. A connection-level disconnect can affect several open views. Local consoles do not have a Disconnect control because there is no remote transport to detach from.

**End:** deliberately terminates the selected session/shell. Read the confirmation and verify the destination; it is destructive. For persistent work this is the action that kills the server-side session rather than merely hiding it.

**Rename:** changes the selected session's display/session name through the relevant control. Renaming is not reconnection, migration or a new process.

Cancel is the safe default for app-owned confirmation dialogs. Windows-owned dialogs, file pickers and UAC have their own platform layout.

## Local Windows terminals

Use **PowerShell** or **Command Prompt** in the sidebar. The app discovers supported installations rather than requiring a manually typed executable path. PowerShell 7 must be installed separately to be available; Windows PowerShell and PowerShell 7 are distinct shells.

New local terminals are numbered and appear alongside remote sessions with a **LOCAL** badge. Remote terminals have a **REMOTE** badge. Check that badge and the connection/session label before pasting a command.

The compact **Administrator** switch applies to the next local-shell launch. It requests Windows UAC for that newly owned shell; it does not convert an existing terminal into an administrator session. NerdSSHell itself is intended to remain unelevated. Cancel UAC when elevation is unnecessary or unexpected. Do not run the whole application as administrator for ordinary SSH.

Local and Standard sessions are not restartable saved processes. The next application launch can create new local shells, but cannot recover their lost state or unsaved programs.

## Tabs and layouts

The main toolbar provides **1**, **2 side by side**, **2 stacked**, and **4 quadrants**. Tabs and pane assignment let you keep more sessions available than simultaneously visible. Select a tab/session to focus its terminal. A selected visible pane stays in its current slot rather than rearranging the workspace unnecessarily.

Drag a terminal's grip handle to swap it with an occupied slot or move it into an empty one. Drag pane dividers to allocate more width/height. Changes in terminal dimensions are sent to the terminal program, which may redraw. Do not use an unexpected repaint as a reason to inject random control sequences or kill a running job.

Collapse the sidebar for more terminal space; the separate expand control remains available. Scratchpad is a shared panel, while File SFTP belongs to a particular remote pane. Collapsing either panel does not mean its underlying data or transfers were deleted.

## Scrollback, search and recovery

Scroll with the mouse wheel; **Alt+wheel** passes wheel input to the terminal application. **Ctrl+F** searches the current terminal buffer. Scrollback is bounded and separate from optional disk recording and tmux's retained history.

On reconnection, a persistent view reconstructs available server-retained output and screen state. That is not a continuous recording of everything that happened while disconnected. Very busy/full-screen applications can redraw. If buffering limits are reached, the view can resynchronize with a notice rather than retain unbounded data.

Disconnected keystrokes must not be replayed later. After a network failure, inspect the current prompt and destination before entering another command. For Standard SSH, create a new shell deliberately; do not assume the previous one returned.

Source references: `ui/app.js`, `src/remote.cjs`, `src/standard-remote.cjs`, `src/local-remote.cjs`, `src/storage.cjs`.
