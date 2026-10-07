# Architecture

## Responsibilities

`src/core.cjs` validates profiles, shell quoting, tmux IDs/formats, stable session identity, restore policy and known_hosts keys. `src/control.cjs` parses raw tmux control-mode bytes and serializes guarded command responses. `src/remote.cjs` owns SSH authentication, server discovery, per-session control channels, lifecycle actions, snapshots, input and sizing. `src/storage.cjs` owns atomic settings and bounded streaming plaintext archives. `src/transfer.cjs` owns SFTP staging and atomic replacement. `src/main.cjs` owns Electron privileges, confirmations, reconnect scheduling, bounded output delivery and IPC. `src/preload.cjs` exposes only named operations. `ui/` is the terminal/layout interface.

## Connection modes

`src/standard-remote.cjs` inherits verified authentication and keepalives from Remote, but replaces support/discovery/control operations with ordinary PTY shells. Existing profiles default to Persistent. Standard network loss releases credentials and requires explicit new-shell creation; confirmed channel closure may terminate work. Its ordered bounded input queue drops pending submissions on invalidation. A stalled write reports partial-delivery uncertainty without closing the shell, blocks fresh writes until the submitted chunk drains, and retains at most one 32 KiB submitted chunk. Stdout/stderr backpressure remains active through natural exit so the stderr tail is not lost.

`src/file-listings.cjs` scopes request generation/cancellation to a terminal/browser instance. `src/sftp-browser.cjs` implements handle-based browsing and exclusive local download publication. `ui/files.js` owns each view's independent browser state and dock/splitter. Transfers capture immutable endpoint/path before native dialogs. The underlying channel reservation in `src/transfer.cjs` bounds outstanding opens and actual channels even after caller cancellation.

`src/session-limits.cjs` caps live/pending terminals across the app at 64, including Standard/local shells before their renderer view opens. Reservations happen before asynchronous work and are released on completion or failure; reopening/reconnecting an existing identity consumes no extra slot. The renderer separately caps retained tabs at 64, including offline tabs, while the sidebar can list unopened sessions. Persistent discovery accepts at most 1,024 valid pane records before metadata/view reconciliation; excess results fail without truncation or server mutation. Reaching a limit does not terminate remote work.

## Persistence is server-side

Remembered SSH passwords are separate from server-side session persistence. `src/password-store.cjs` uses main-process Electron `safeStorage` and Windows DPAPI, with no plaintext fallback. Its encrypted payload binds the profile ID, hostname, port and username; ordinary settings contain only the opt-in preference. Main-process prompt consent applies only to SSH login passwords accepted by the verified transport. Credential revisions invalidate pending saving on Forget/profile changes, and the renderer receives metadata rather than saved secrets. Forget leaves existing sessions alive; rejection removes the saved password and requires an explicit new sign-in. Interactive second-factor answers and key passphrases remain memory-only.

Persistent views are not processes. Closing a view destroys only its local terminal and, when no other view needs it, its SSH control channel. The existing session remains alive. Discovery and reconnect never invoke new-session or a user's launch command. A session uses a UUID in `@nerdsshell-id`, with the legacy `@betterssh-id` marker retained for compatibility. Persisted view keys combine connection ID, session UUID and pane ID. UUIDs prevent a restarted server's reused numeric IDs from being mistaken for old work. Session termination checks the UUID atomically in the server-side conditional before killing; conflicting markers fail closed. See [identity compatibility](IDENTITY-COMPATIBILITY.md).

SSH connection recovery discards disconnected input. Keyboard input is encoded into hexadecimal `send-keys -H` data; it cannot become control protocol commands. Commands are serialized because response guards and asynchronous output share one stream. A command timeout invalidates the channel so a late reply cannot be attributed to a later command. Control output is decoded as bytes before UTF-8 rendering.

## Terminal history and flow control

xterm.js holds the configured finite local scrollback. Initial/reattachment capture reconstructs the current server-retained screen/history and common terminal modes. The snapshot completion callback is a synchronous output-order barrier in the parser. Screen metadata and capture are separate commands, so rapidly changing full-screen applications require live acceptance; exact replay of every terminal mode is not claimed.

tmux `pause-after` bounds server-side display lag. Main-to-renderer output is batched and acknowledged, with a 4 MB per-view pending limit. If a limit is reached, the view resynchronizes from bounded server history with a visible notice rather than silently keeping unlimited data in memory. Disk recording also has an 8 MB queued-write limit; recording stops visibly on disk failure/lag while the live terminal remains usable.

Text archives use incremental UTF-8 and VT escape filtering, JSONL segments, per-profile size retention, streaming search, and explicit export. They are searchable observations, not precise screen recordings. Input is not separately logged, but echoed commands/secrets can appear in output. No background remote recorder is installed.

## Source verification references

Primary documentation used for implementation:

- https://github.com/tmux/tmux/wiki/Control-Mode — guards, octal escaping, capture, notifications and flow control.
- https://man.openbsd.org/tmux — session options, sizing, history semantics and targeting.
- https://github.com/mscdex/ssh2 — SSH client, host verification, agent, channels and SFTP.
- https://www.electronjs.org/docs/latest/tutorial/security — context isolation, sandbox, navigation and IPC boundaries.
- https://www.electronjs.org/docs/latest/api/web-utils — obtaining paths for user-dropped native files.
- https://xtermjs.org/docs/api/terminal/classes/terminal/ — terminal rendering/input/scrolling API.

## Validation

Source and disposable SSH tests cover protocol and lifecycle behavior. Native consoles, packaging, elevation and desktop interaction need Windows validation for the exact source and artifact. Use [TESTING.md](TESTING.md), preserve the [security boundaries](SECURITY-REVIEW.md), and follow the [release process](PUBLIC-RELEASE.md). Current results are recorded in [validation results](VALIDATION.md).
