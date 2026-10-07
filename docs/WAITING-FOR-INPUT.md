# Waiting for input

NerdSSHell can mark a terminal that appears to need a response and alert when that terminal is in the background. Each open session has independent attention state. Preferences → Notifications & Alerts controls detection, sound, Windows notifications, and visual indicators independently. All four default to enabled.

An ordinary idle Bash, PowerShell, Command Prompt, or application prompt does not request attention. A newly detected question normally produces one alert. Merely leaving a prompt unanswered does not repeat it. Selecting the terminal acknowledges attention while its **WAITING FOR INPUT** badge remains until the prompt is answered or output resumes. Enter, cancellation, and a single yes/no answer clear appropriate prompts immediately; ordinary password typing only acknowledges attention.

The active terminal in the focused application stays quiet. A different terminal, a minimized window, or another foreground application makes a new question eligible for audio and native notification. Simultaneous questions are grouped into one short sound and one notification. Clicking opens a still-current waiting terminal; it never submits input or approves an operation.

## Detection architecture

`ui/session-attention.js` contains the screen reader, classifier, per-session state machine, xterm adapter, and short Web Audio sound. The module also exports CommonJS functions so Node tests exercise the actual implementation.

The screen reader inspects xterm's parsed active buffer near the **live cursor**, using `baseY` and `cursorY`. Scrolling up through history does not change the evidence. It reads at most 32 physical rows and 32 KiB of text per sample, joins wrapped rows, and honors normal versus alternate buffers. It does not scan the scrollback archive or reimplement ANSI parsing. Erased and overwritten prompt text therefore stops being evidence.

Detection requires actionable prompt structure at the input location: an explicit response choice, a confirmation question, an authentication input prompt, instructions to continue, or a menu with independent question/selection/navigation evidence. Log prefixes, ordinary shell prompts (including typed shell commands), historical prompts followed by new output, and ordinary numbered lists are excluded. English prompt families cover multiple applications, including common Hermes and Codex approval/menu styles.

A candidate must remain semantically unchanged for 900 ms before becoming waiting. Color changes and unchanged redraws do not restart it. A 250 ms disappearance grace avoids clearing and re-alerting during a brief terminal redraw; sustained resumed output clears it. Fingerprints include the question and menu choices but omit the selection arrow, so navigating the same menu does not create a new question. Snapshot reconstruction suspends sampling and preserves the same event/fingerprint until the restored live screen is ready. Handling a prompt suppresses its old fingerprint until the screen changes. The same wording can generate another event after work resumes.

Where a cooperating shell already emits OSC 133 markers, prompt phases suppress detection and command phases permit it. NerdSSHell only observes these markers; it does not inject shell integration, edit shell profiles, install hooks, or change remote settings. BEL and terminal titles alone never create a waiting event.

The state is ephemeral and belongs to the open session view:

```js
{
  sourceId,       // Detector identity, stable for this view.
  revision,       // Increases on each state transition.
  eventId,        // Increases for each newly detected question.
  waiting,       // The current prompt appears to need a response.
  acknowledged,  // The user has viewed or interacted with it.
  kind,          // confirmation, selection, password, input, or empty.
  label          // Fixed application text for that kind.
}
```

Only state transitions cross IPC. Screen contents, raw prompt text, passwords, typed responses, and fingerprints are never sent to native notifications or persisted by this feature. The detector does not execute terminal commands or interact with an application on the user's behalf.

## Native coordinator

`src/session-notifications.cjs` exports `createSessionNotifications`. The main process resolves the actual open session before accepting a transition and again before delivery or click routing. It rejects malformed fields, noncanonical labels, extra payload fields, invalid keys, out-of-order revisions, old event IDs, and attempts to revive an acknowledged or cleared event. A changed backend view identity invalidates its former attention record.

The coordinator holds at most 128 session records. New events are coalesced for 200 ms, with a two-second global and five-second per-session interval. An eligible event arriving during its interval remains queued until delivery or acknowledgement; it is not repeated on a timer. Closed, disconnected, replaced, or handled sessions are removed from pending delivery. Continued incoming transitions do not postpone an already scheduled alert indefinitely.

Windows toasts use Electron's main-process `Notification`, with `silent: true`. The separate sound preference controls the short application chime, avoiding duplicate OS and application sounds. Taskbar flashing uses `BrowserWindow.flashFrame` while the window is unfocused and a session still needs attention. Focus, acknowledgement, completion, disconnection, and disabling notifications stop appropriate attention. Failed or unsupported native toasts do not prevent the independent sound and taskbar mechanisms.

Notification bodies contain a bounded session display name and fixed application wording. They do not include terminal excerpts or authentication details. Session names can themselves contain information a user chose to expose, so those names should be considered when using Windows lock-screen notifications.

## Integration contract

Load `session-attention.js` before `app.js` through the existing bundled-asset protocol. After constructing an xterm view:

```js
view.attentionWatcher = NerdSSHellAttention.attach({
  terminal: view.terminal,
  isReady: () => view.ready,
  enabled: () => notifications.enabled,
  onChange: state => {
    view.attention = state;
    renderAttentionIndicators();
    api.sessionAttention(view.pane.key, state);
  }
});
```

The adapter subscribes to `onWriteParsed` so it inspects parsed screen updates. `sample()` can also explicitly inspect the screen after an awaited terminal write. For a snapshot, call `suspend()` before reconstructing xterm, then `resume()` after the final awaited write and `view.ready = true`. This prevents partial/history snapshots from creating false candidates and preserves deduplication if the same unanswered prompt is restored. xterm writes are asynchronous; reading immediately after calling `write()` can observe an old buffer.

Before submitting user input, capture `token = watcher.captureInput()`. After the backend accepts that write, call `watcher.acceptInput(data, token)` only if the renderer view and its generation still match. A rejected write must not clear an unanswered prompt. The opaque token changes when semantic evidence changes, so a delayed write completion cannot clear a newer prompt or its not-yet-settled candidate. Both normal input and Actions/Favorites use this path. The lower-level `input(data)` method is for already accepted synchronous input and detector tests.

The adapter ignores cursor reports, device reports, mode-query replies, mouse reports, and focus reports. Do not treat output or a programmatic protocol reply as a user's acknowledgement. Call `acknowledge()` when the user selects the terminal. Call `reset()` on disconnect/detach/end; call `dispose()` before disposing the terminal. Applying detection preferences should immediately sample/reset existing watchers. A bounded hash of live context lets a new authentication retry rearm even when the error text and identical prompt arrive in the same parsed write; raw context and keystrokes are not retained. Snapshot restoration rebases that hash without reviving an already handled prompt.

Main-process wiring:

```js
const attention = createSessionNotifications({
  getWindow: () => window,
  Notification,
  getPreferences: () => store.data.notifications,
  resolveSession(key) {
    // Resolve from live backend state, not renderer-supplied metadata.
    // Return null for a missing, ended, disconnected or unopened session.
    return { identity: actualBackendView, label: sessionDisplayName };
  },
  onActivate: key => emit('attention-activate', { key }),
  onAudio: () => emit('attention-audio')
});
handle('sessionAttention', (key, state) => attention.update(key, state));
handle('activeSession', key => attention.setActive(key));
```

Use the existing IPC sender/main-frame/origin validation and expose only these named methods through preload. Report the active key after layout/open/close/selection changes, including an empty key when none is active. Handle `attention-activate` by selecting the existing view and acknowledging it; handle `attention-audio` with `NerdSSHellAttention.playAlert()`.

Use `forget(key)` when a backend view ends or is removed, `clearProfile(profileId)` on disconnection, `refreshPreferences()` after saving preferences, and `dispose()` during teardown. Preserve the coordinator record through a snapshot of the same backend view; the adapter republishes waiting state with a higher revision on resume. A renderer transition received while the backend is temporarily unready is rejected without erasing the previous event identity. These hooks apply to local terminals as well as SSH. `resolveSession` must reject a retained but inactive backend view.

Set the BrowserWindow's `webPreferences.backgroundThrottling` to `false` so minimized terminal parsing and detector timers continue promptly. Main uses the actual window focus/minimized state rather than renderer `visibilityState`; disabling background throttling affects Page Visibility semantics. Retain the existing application AppUserModelID and installed Start Menu shortcut identity for Windows notifications and compatibility.

## Tests and practical limits

Run:

```sh
node --test test/session-attention.test.cjs
```

The tests exercise real xterm parsing with fragmented ANSI, carriage-return erase, wrapped/wide text, alternate-screen menus, scrolling away from the live cursor, OSC 133, independent sessions, keyboard versus protocol reports, prompt settlement, redraw grace, and resumed work. Deterministic native tests cover focus, simultaneous alerts, click routing, stale state and identities, malformed IPC, preferences, rate/session bounds, lifecycle cleanup, and timer starvation.

A terminal emulator sees screen state; it does not have a portable SSH/ConPTY API exposing whether an arbitrary application is blocked on a read. Detection therefore remains a conservative inference. Unusual prompts, unsupported languages, a hidden prompt far from the cursor, or an application that provides no identifiable request may be missed. Text printed exactly like an unanswered prompt at the live cursor can still be mistaken for a request. These limits should be addressed with synthetic regression transcripts and clean application-specific signals, not by treating inactivity as proof.

Actual installed Windows toast delivery, Windows notification policies/Do Not Disturb, taskbar appearance, and audible playback require native acceptance. A passing fake-Notification test does not establish that Windows displayed a toast. Verify a background Hermes/Codex approval, generic yes/no prompt, password prompt, simultaneous waiting sessions, cancelled prompt, and disconnect in the installed build. The same check should confirm that ordinary idle PowerShell and Command Prompt remain quiet.

## Primary references

- [xterm Terminal API](https://xtermjs.org/docs/api/terminal/classes/terminal/): asynchronous `write` and coalesced `onWriteParsed`.
- [xterm buffer API](https://xtermjs.org/docs/api/terminal/interfaces/ibuffer/): live `baseY`/cursor position versus scrollback `viewportY`.
- [xterm parser hooks](https://xtermjs.org/docs/guides/hooks/): parsing lifecycle and non-consuming handlers.
- [iTerm2 shell integration markers](https://iterm2.com/documentation-escape-codes.html): OSC 133 semantic prompt/command markers.
- [Electron Notification API](https://www.electronjs.org/docs/latest/api/notification): native notification support, silent delivery, click/failure events and dismissal.
- [Electron Windows notifications](https://www.electronjs.org/docs/latest/tutorial/notifications): installed shortcut and AppUserModelID requirements.
- [Electron BrowserWindow API](https://www.electronjs.org/docs/latest/api/browser-window/): background throttling and focus/visibility behavior.
- [Electron taskbar customization](https://www.electronjs.org/docs/latest/tutorial/windows-taskbar): taskbar flash and clearing it on focus.
