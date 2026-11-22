# Architecture

## Responsibilities

`src/core.cjs` validates profiles, shell quoting, tmux IDs, restore policy and known_hosts keys. `src/tmux-sessions.cjs` owns the Persistent pane list format, stable session identity, and guarded attachment, Rename and End operations. `src/control.cjs` parses raw tmux control-mode bytes and serializes guarded command responses. `src/remote.cjs` owns SSH authentication, connection and view reconciliation, per-session control channels, snapshots, input and sizing. `src/storage.cjs` owns atomic settings and bounded streaming plaintext archives. `src/main.cjs` owns Electron privileges, confirmations, reconnect scheduling, bounded output delivery and IPC. `src/preload.cjs` exposes only named operations. `ui/` is the terminal/layout interface.

## Connection modes

`src/standard-remote.cjs` inherits verified authentication and keepalives from Remote, but replaces support/discovery/control operations with ordinary PTY shells. Existing profiles default to Persistent. Standard network loss releases credentials and requires explicit new-shell creation; confirmed channel closure may terminate work. Its ordered bounded input queue drops pending submissions on invalidation. A stalled write reports partial-delivery uncertainty without closing the shell, blocks fresh writes until the submitted chunk drains, and retains at most one 32 KiB submitted chunk. Stdout/stderr backpressure remains active through natural exit so the stderr tail is not lost.

`src/file-operations.cjs` owns consent, captured transfer targets, revalidation, cancellation and progress across terminal uploads, native dialogs and File SFTP copy arrows. `src/local-files.cjs` owns per-pane Local folder grants and Remote listing selections. `src/file-listings.cjs` scopes pending requests to a terminal and browser instance. `src/sftp-browser.cjs` implements handle-based browsing and exclusive local download publication. `ui/files.js` owns each view's independent browser state and dock/splitter. `src/transfer.cjs` owns upload staging and publication and bounds outstanding SFTP opens and channels through caller cancellation.

`src/session-limits.cjs` caps live and pending terminals across the app at 64. A launch reserves capacity before asynchronous work. A Standard or local provider supplies the exact shell record when it registers the shell, so the budget counts the opening and registered shell once. Reopening or reconnecting an existing identity consumes no extra slot. The renderer separately caps retained tabs at 64, including offline tabs, while the sidebar can list unopened sessions. Persistent discovery accepts at most 1,024 valid pane records before metadata and view reconciliation. Excess results fail without truncation, server mutation or termination of remote work.

## Persistence is server-side

Remembered SSH passwords are separate from server-side session persistence. `src/password-store.cjs` uses main-process Electron `safeStorage` and Windows DPAPI, with no plaintext fallback. Its encrypted payload binds the profile ID, hostname, port and username; ordinary settings contain only the opt-in preference. Main-process prompt consent applies only to SSH login passwords accepted by the verified transport. Credential revisions invalidate pending saving on Forget/profile changes, and the renderer receives metadata rather than saved secrets. Forget leaves existing sessions alive; rejection removes the saved password and requires an explicit new sign-in. Interactive second-factor answers and key passphrases remain memory-only.

Persistent views are not processes. Closing a view destroys only its local terminal and, when no other view needs it, its SSH control channel. The existing session remains alive. Discovery and reconnect never invoke new-session or a user's launch command. A session uses a UUID in `@nerdsshell-id`, with the legacy `@betterssh-id` marker retained for compatibility. Persisted view keys combine connection ID, session UUID and pane ID. UUIDs prevent a restarted server's reused numeric IDs from being mistaken for old work. Session termination checks the UUID atomically in the server-side conditional before killing; conflicting markers fail closed. See [identity compatibility](IDENTITY-COMPATIBILITY.md).

SSH connection recovery discards disconnected input. Keyboard input is encoded into hexadecimal `send-keys -H` data; it cannot become control protocol commands. Adjacent queued printable and complete Backspace/arrow events share a batch of at most 512 bytes, without an added flush timer. Recognized arrows include normal/application cursor modes and Shift/Alt/Ctrl combinations. Enter, Tab, other control/unknown escape events and multi-chunk pastes remain separate acknowledgement barriers. Every original event remains charged to the bounded queue until its batch is acknowledged. Commands remain serialized because response guards and asynchronous output share one stream. A command timeout invalidates the channel so a late reply cannot be attributed to a later command. Control output is decoded as bytes before UTF-8 rendering.

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

`src/release-updater.cjs` validates the official stable release and streamed installer identity. `src/release-transport.cjs` adapts Chromium request/response events to its bounded, credentialless download interface, exposing redirects before the updater authorizes each destination. `src/update-handoff.cjs` and the bundled Windows runner retain the consent-bound normal quit, original process identity, exact registered installation and verified restart boundary. The Windows runner defines supported recovery layouts by installed version. Package verification checks the built files using the same recovery code after comparing the bundled runner with reviewed source.

Source and disposable SSH tests cover protocol and lifecycle behavior. Native consoles, packaging, elevation and desktop interaction need Windows validation for the exact source and artifact. Use [TESTING.md](TESTING.md), preserve the [security boundaries](SECURITY-REVIEW.md), and follow the [release process](PUBLIC-RELEASE.md). Current results are recorded in [validation results](VALIDATION.md).

## Temporary network-device connections

`src/quick-connect.cjs` validates endpoint forms, nonsecret defaults and the bounded recent list. Main owns temporary IDs and their runtime registry separately from stored profiles. Quick requests reserve terminal capacity before login, reuse verified SSH and serialized prompts, and disable remembered-password storage. Normal closure, network loss and stale callbacks retire resources while a bounded ended transcript can remain until final tab closure. Temporary IDs are excluded from persisted workspace restoration. Atomic promotion retains the live identity and generic capability.

Validated `terminalType: generic` uses plain Standard SSH and blocks OS/tmux discovery and task/startup commands at provider and workbench boundaries. The pane Actions UI does not initiate platform detection for generic endpoints. Missing terminalType defaults to existing server behavior; saved Persistent/local flows are unchanged.
