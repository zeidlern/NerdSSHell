'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const { Terminal } = require('@xterm/xterm');
const { LABELS, readScreen, classifyPrompt, createDetector, attach } = require('../ui/session-attention.js');
const { createSessionNotifications, validateState } = require('../src/session-notifications.cjs');
const write = (terminal, value) => new Promise(resolve => terminal.write(value, resolve));
function terminal(t, options = {}) { const value = new Terminal({ cols: 90, rows: 28, scrollback: 1000, ...options }); t.after(() => value.dispose()); return value; }
function screen(...lines) { return { lines, cursorLine: lines.length - 1, cursorSuffix: '', type: 'normal' }; }
function clock() {
  let at = 0, sequence = 0; const timers = new Map();
  return { now: () => at, setTimer(fn, delay) { const id = ++sequence; timers.set(id, { fn, at: at + delay }); return id; }, clearTimer(id) { timers.delete(id); },
    advance(ms) { const end = at + ms; let count = 0;
      while (true) { const next = [...timers].filter(([, item]) => item.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break;
        assert.ok(++count < 1000, 'Timers must not spin'); timers.delete(next[0]); at = next[1].at; next[1].fn(); }
      at = end;
    }, count: () => timers.size };
}
function watch(t, term, options = {}) { const timer = clock(), states = [], alerts = [];
  const watcher = attach({ terminal: term, ...timer, onChange: state => states.push(state), onAlert: state => alerts.push(state), ...options });
  t.after(() => watcher.dispose()); return { ...timer, states, alerts, watcher };
}
test('silence and ordinary bash, PowerShell, cmd, application and log prompts never request attention', () => {
  for (const text of ['', '$ ', '# ', 'dev@host:~/project$ ', 'bash-5.2$ ', 'PS C:\\Work> ', 'C:\\Windows\\System32> ',
    '(venv) PS D:\\Downloads> ', '❯', '>', 'Compilation finished.', 'Working…', 'INFO Waiting for approval', '2026-10-03 09:00 Waiting for input',
    'The application asks for a password.', 'echo "Proceed? [y/n]"', '$ echo Continue? [Y/n]', 'PS C:\\Work> Write-Output "Approve? [y/n]"']) {
    const detector = createDetector(); detector.observe(screen(text), 0); detector.tick(600000); assert.equal(detector.state().waiting, false, text);
  }
});
test('explicit prompt families recognize confirmation, password, selection and requested input', () => {
  const examples = { confirmation: ['Proceed? [Y/n]', 'Continue (y/n):', 'Delete it? (yes/no)', 'Are you sure you want to continue connecting (yes/no/[fingerprint])?',
    'Would you like to run the following command?', 'Press Enter to continue.', 'Hit any key to continue . . .',
    '[Y] Yes  [A] Yes to All  [N] No  [L] No to All  [S] Suspend  [?] Help (default is "Y"):'],
  password: ['Password:', '[sudo] password for tester:', "Enter passphrase for key '/home/test/.ssh/key':", "tester's password:", 'Verification code:'],
  input: ['Enter your choice:', 'Select an option:', 'Type DELETE to confirm:', 'Waiting for approval'] };
  for (const [kind, prompts] of Object.entries(examples)) for (const prompt of prompts) assert.equal(classifyPrompt(screen(prompt))?.kind, kind, prompt);
});
test('a current application prompt directly after the shell command remains actionable', async t => {
  for (const [shell, prompt, kind] of [
    ['tester@server:~$ ', 'Approve this operation? [y/N] ', 'confirmation'],
    ['tester@server:~$ sudo example', '[sudo] password for tester: ', 'password'],
    ['PS C:\\Work> Invoke-Example', '[Y] Yes [N] No (default is "Y"): ', 'confirmation']
  ]) {
    const term = terminal(t), observed = watch(t, term); await write(term, `${shell}\r\n${prompt}`);
    observed.watcher.sample(); observed.advance(900); assert.equal(observed.watcher.state().kind, kind, prompt); assert.equal(observed.alerts.length, 1);
  }
});
test('parsed fragmented ANSI prompt settles once; cosmetic redraws do not repeat its event', async t => {
  const term = terminal(t), observed = watch(t, term);
  await write(term, '\x1b[3'); await write(term, '3mApprove the operation? [Y/'); observed.watcher.sample(); observed.advance(2000); assert.equal(observed.alerts.length, 0);
  await write(term, 'n]\x1b[0m '); observed.watcher.sample(); observed.advance(899); assert.equal(observed.alerts.length, 0);
  observed.advance(1); assert.equal(observed.alerts.length, 1); assert.equal(observed.watcher.state().waiting, true);
  for (let i = 0; i < 4; i++) { await write(term, '\r\x1b[2K\x1b[32mApprove the operation? [Y/n]\x1b[0m '); observed.watcher.sample(); observed.advance(1000); }
  assert.equal(observed.alerts.length, 1); assert.equal(observed.states[0].kind, 'confirmation');
  assert.equal(JSON.stringify(observed.states).includes('operation'), false, 'Raw prompt text is never retained in public state');
});
test('a temporary question in streaming output does not alert, and overwritten ANSI content is gone', async t => {
  const term = terminal(t), observed = watch(t, term);
  await write(term, 'Continue? [Y/n]'); observed.watcher.sample(); observed.advance(300);
  await write(term, '\r\x1b[2KWorking: 10%'); observed.watcher.sample(); observed.advance(5000);
  assert.equal(observed.alerts.length, 0); assert.equal(readScreen(term).lines.at(-1), 'Working: 10%');
});
test('historical questions and menus do not alert after work resumes or shell prompt returns', async t => {
  const term = terminal(t), observed = watch(t, term);
  await write(term, 'Would you like to run the following command?\r\n1. Yes\r\n2. No\r\nPress enter to confirm or esc to cancel\r\nExecuting requested work…');
  observed.watcher.sample(); observed.advance(5000); assert.equal(observed.alerts.length, 0);
  await write(term, '\r\nProceed? [Y/n]\r\nPS C:\\Work> '); observed.watcher.sample(); observed.advance(5000); assert.equal(observed.alerts.length, 0);
});
test('normal-buffer scrollback position does not change detection of the live prompt', async t => {
  const term = terminal(t); await write(term, 'old output\r\n'.repeat(100) + 'Enter your choice: '); term.scrollLines(-50);
  assert.ok(term.buffer.active.viewportY < term.buffer.active.baseY);
  assert.equal(classifyPrompt(readScreen(term))?.kind, 'input');
  await write(term, '\r\nWorking again\r\n'.repeat(30)); assert.equal(classifyPrompt(readScreen(term)), null);
});
test('wrapped prompts are classified as logical lines, including wide glyphs', async t => {
  const term = terminal(t, { cols: 24 }); await write(term, 'Would you like to continue with the 漢字 project? [Y/n] ');
  assert.equal(classifyPrompt(readScreen(term))?.kind, 'confirmation');
});
test('Codex-style alternate-screen selection uses question plus choices and preserves event across navigation', async t => {
  const term = terminal(t), observed = watch(t, term);
  await write(term, '\x1b[?1049hWould you like to run the following command?\r\n\r\n  npm test\r\n\r\n› 1. Yes, proceed (y)\r\n  2. No, cancel (n)\r\nPress enter to confirm or esc to cancel');
  observed.watcher.sample(); observed.advance(900); assert.equal(observed.alerts.length, 1); assert.equal(observed.watcher.state().kind, 'selection');
  observed.watcher.input('\x1b[B'); assert.equal(observed.watcher.state().waiting, true); assert.equal(observed.watcher.state().acknowledged, true);
  await write(term, '\x1b[5;1H  1. Yes, proceed (y)\r\n› 2. No, cancel (n)\x1b[7;1H'); observed.watcher.sample(); observed.advance(2000);
  assert.equal(observed.alerts.length, 1);
  observed.watcher.input('\r'); assert.equal(observed.watcher.state().waiting, false);
  observed.watcher.sample(); observed.advance(5000); assert.equal(observed.alerts.length, 1, 'Unchanged old menu is suppressed after submission');
});
test('generic arrow-key menus require question and navigation evidence; ordinary numbered output is inert', () => {
  const menu = { ...screen('? Which environment? (Use arrow keys)', '❯ Development', '  Production'), type: 'alternate', cursorLine: 1, cursorSuffix: 'Development' };
  assert.equal(classifyPrompt(menu)?.kind, 'selection');
  assert.equal(classifyPrompt(screen('A numbered plan', '1. Build', '2. Deploy')), null);
  assert.equal(classifyPrompt(screen('Approval methods:', '1. Yes', '2. No', 'Working…')), null);
});
test('brief full-screen redraw does not clear then re-alert; real resumed output clears after grace', () => {
  const detector = createDetector(), prompt = screen('Proceed? [y/n]'); detector.observe(prompt, 0); detector.tick(900);
  assert.equal(detector.state().eventId, 1); detector.observe(screen(''), 1000); detector.observe(prompt, 1100); detector.tick(2000);
  assert.equal(detector.state().eventId, 1); assert.equal(detector.state().waiting, true);
  detector.observe(screen('Working'), 2100); detector.tick(2350); assert.equal(detector.state().waiting, false);
  detector.observe(prompt, 3000); detector.tick(3900); assert.equal(detector.state().eventId, 2, 'Later same-text question is a new event after progress');
});
test('password input acknowledges without retaining keystrokes; submit clears and terminal reports are ignored', () => {
  const detector = createDetector(); detector.observe(screen('Password:'), 0); detector.tick(900);
  for (const reply of ['\x1b[12;3R', '\x1b[?1;2c', '\x1b[I', '\x1b[<0;30;20M']) detector.input(reply);
  assert.equal(detector.state().acknowledged, false);
  detector.input('synthetic-secret'); assert.equal(detector.state().waiting, true); assert.equal(detector.state().acknowledged, true);
  assert.equal(JSON.stringify(detector.state()).includes('synthetic-secret'), false);
  detector.input('\r'); assert.equal(detector.state().waiting, false); detector.observe(screen('Password:'), 3000); detector.tick(10000); assert.equal(detector.state().waiting, false);
});
test('automatic xterm mode-query replies do not acknowledge waiting input', async t => {
  const term = terminal(t), observed = watch(t, term), replies = [];
  const listener = term.onData(data => { replies.push(data); observed.watcher.acceptInput(data, observed.watcher.captureInput()); });
  t.after(() => listener.dispose());
  await write(term, 'Password: '); observed.watcher.sample(); observed.advance(900);
  await write(term, '\x1b[?2026$p'); observed.watcher.sample();
  assert.deepEqual(replies, ['\x1b[?2026;2$y'], 'Use an actual parsed DECRQM response from the bundled terminal');
  assert.equal(observed.watcher.state().waiting, true); assert.equal(observed.watcher.state().acknowledged, false);
});
test('accepted input tokens protect a newer candidate before it has its own event ID', () => {
  const detector = createDetector(); detector.observe(screen('PS C:\\Work> '), 0);
  const command = detector.captureInput();
  detector.observe(screen('Password:'), 100); assert.equal(detector.state().eventId, 0);
  assert.equal(detector.acceptInput('sudo example\r', command), false, 'Old submitted command must not suppress the new password candidate');
  detector.tick(1000); assert.equal(detector.state().waiting, true);
  const response = detector.captureInput();
  assert.equal(detector.acceptInput('\r', { ...response, sourceId: 'another-view' }), false);
  assert.equal(detector.state().waiting, true, 'Rejected input cannot clear the prompt');
  assert.equal(detector.acceptInput('\r', response), true); assert.equal(detector.state().waiting, false);
  detector.reset(); assert.equal(detector.acceptInput('\r', response), false, 'Lifecycle reset invalidates old input tokens');
});
test('single-write authentication retry re-arms the same prompt after its previous response', async t => {
  const term = terminal(t), observed = watch(t, term);
  await write(term, 'Password: '); observed.watcher.sample(); observed.advance(900);
  const input = observed.watcher.captureInput(); assert.equal(observed.watcher.acceptInput('\r', input), true);
  await write(term, '\r\nSorry, try again.\r\nPassword: '); observed.watcher.sample();
  assert.equal(observed.watcher.acceptInput('\r', input), false, 'Late completion from previous input cannot clear the retry');
  observed.advance(900); assert.equal(observed.alerts.length, 2); assert.equal(observed.watcher.state().eventId, 2);
});
test('snapshot context reconstruction does not revive the already handled same prompt', async t => {
  const term = terminal(t), observed = watch(t, term);
  await write(term, 'Password: '); observed.watcher.sample(); observed.advance(900); observed.watcher.input('\r');
  observed.watcher.suspend(); term.reset(); await write(term, 'Restored history\r\nPassword: '); observed.watcher.resume(); observed.advance(3000);
  assert.equal(observed.alerts.length, 1); assert.equal(observed.watcher.state().waiting, false);
});
test('independent sessions, disabled detection, reset and dispose cannot leave timers or stale alerts', async t => {
  const a = terminal(t), b = terminal(t); let enabled = true, ready = true;
  const first = watch(t, a, { enabled: () => enabled, isReady: () => ready }), second = watch(t, b);
  await write(a, 'Proceed? [y/n]'); await write(b, 'Password:'); first.watcher.sample(); second.watcher.sample(); first.advance(900); second.advance(900);
  assert.equal(first.alerts.length, 1); assert.equal(second.alerts.length, 1);
  first.watcher.input('y'); assert.equal(first.watcher.state().waiting, false); assert.equal(second.watcher.state().waiting, true);
  enabled = false; first.watcher.sample(); first.advance(10000); assert.equal(first.alerts.length, 1);
  second.watcher.reset(); assert.equal(second.watcher.state().waiting, false); assert.equal(second.count(), 0);
  enabled = true; ready = false; first.watcher.sample(); first.advance(10000); assert.equal(first.alerts.length, 1);
  ready = true; first.watcher.sample(); first.watcher.dispose(); first.advance(10000); assert.equal(first.alerts.length, 1); assert.equal(first.count(), 0);
});
test('OSC 133 shell integration suppresses shell input and resumes classification during a command', async t => {
  const term = terminal(t), observed = watch(t, term);
  await write(term, '\x1b]133;A\x07Odd prompt: Continue? [y/n]\x1b]133;B\x07'); observed.watcher.sample(); observed.advance(5000); assert.equal(observed.alerts.length, 0);
  await write(term, '\x1b]133;C\x07\r\nPassword: '); observed.watcher.sample(); observed.advance(900); assert.equal(observed.alerts.length, 1);
  await write(term, '\x1b]133;D;0\x07\x1b]133;A\x07\r\nOdd prompt: Continue? [y/n]'); assert.equal(observed.watcher.state().waiting, false);
});
test('snapshot reconstruction preserves unanswered prompt identity and only a changed prompt creates another event', async t => {
  const term = terminal(t); let ready = true;
  const f = nativeFixture(t); f.add('server/task');
  const observed = watch(t, term, { isReady: () => ready, onChange: state => f.coordinator.update('server/task', state) });
  await write(term, 'Proceed? [y/n]'); observed.watcher.sample(); observed.advance(900); f.advance(200);
  assert.equal(f.sounds.length, 1); assert.equal(observed.watcher.state().eventId, 1);
  observed.watcher.suspend(); ready = false; term.reset();
  await write(term, 'historical prompt? [y/n]\r\n'); observed.advance(3000); assert.equal(observed.watcher.state().waiting, true);
  await write(term, 'Proceed? [y/n]'); ready = true; observed.watcher.resume(); observed.advance(1000); f.advance(10000);
  assert.equal(observed.watcher.state().eventId, 1); assert.equal(f.sounds.length, 1, 'Restoring the same unanswered prompt does not repeat audio');
  observed.watcher.suspend(); ready = false; term.reset(); await write(term, 'Allow another operation? [y/n]'); ready = true; observed.watcher.resume();
  observed.advance(900); f.advance(200); assert.equal(observed.watcher.state().eventId, 2); assert.equal(f.sounds.length, 2);
});
test('a waiting event pending native delivery survives a temporary snapshot readiness gap', async t => {
  const term = terminal(t); let ready = true;
  const f = nativeFixture(t); f.add('server/task'); const savedOwner = f.owners.get('server/task');
  const observed = watch(t, term, { isReady: () => ready, onChange: state => f.coordinator.update('server/task', state) });
  await write(term, 'Proceed? [y/n]'); observed.watcher.sample(); observed.advance(900);
  observed.watcher.suspend(); ready = false; f.owners.delete('server/task'); f.advance(200); assert.equal(f.sounds.length, 0);
  term.reset(); await write(term, 'Proceed? [y/n]'); ready = true; f.owners.set('server/task', savedOwner); observed.watcher.resume(); f.advance(200);
  assert.equal(f.sounds.length, 1); assert.equal(observed.watcher.state().eventId, 1);
});
test('a renderer transition during snapshot capture cannot erase already delivered event deduplication', t => {
  const f = nativeFixture(t); f.add('server/task'); const owner = f.owners.get('server/task');
  f.coordinator.update('server/task', state()); f.advance(200); assert.equal(f.sounds.length, 1);
  // Remote.snapshot temporarily clears initialized before the renderer sees
  // the snapshot event. A preceding frame's transition can arrive in that gap.
  f.owners.delete('server/task');
  assert.equal(f.coordinator.update('server/task', state({ revision: 2 })), false);
  assert.equal(f.toasts[0].closed, true, 'The unready target must no longer be actionable');
  f.owners.set('server/task', owner);
  assert.equal(f.coordinator.update('server/task', state({ revision: 3 })), true);
  f.advance(10000); assert.equal(f.sounds.length, 1, 'Resume must retain the delivered event identity');
});
test('screen sampling is bounded and never scans a million-line scrollback', () => {
  const reads = [];
  const term = { rows: 500, buffer: { active: { type: 'alternate', baseY: 1000000, cursorY: 250, cursorX: 10,
    getLine(row) { reads.push(row); return { translateToString: () => 'x'.repeat(10000), isWrapped: false }; } } } };
  const result = readScreen(term); assert.ok(reads.length <= 33); assert.ok(Math.min(...reads) >= 1000000); assert.ok(result.lines.join('').length <= 32768);
});

function nativeFixture(t, options = {}) {
  const timing = clock(), owners = new Map(), sounds = [], activated = [], toasts = [];
  const win = new EventEmitter(); let focused = false, minimized = false;
  Object.assign(win, { isDestroyed: () => false, isFocused: () => focused, isMinimized: () => minimized, flashes: [],
    flashFrame(value) { this.flashes.push(value); }, restore() { minimized = false; }, show() {}, focus() { focused = true; this.emit('focus'); } });
  class Notification extends EventEmitter { static isSupported() { return true; }
    constructor(value) { super(); this.options = value; this.closed = false; }
    show() { toasts.push(this); } close() { this.closed = true; }
  }
  const preferences = { enabled: true, audio: true, desktop: true };
  const coordinator = createSessionNotifications({ ...timing, getWindow: () => win, Notification, getPreferences: () => preferences,
    resolveSession: key => owners.get(key), onAudio: value => sounds.push(value), onActivate: key => activated.push(key), ...options });
  t.after(() => coordinator.dispose());
  return { ...timing, owners, sounds, activated, toasts, win, preferences, coordinator,
    add(key, label = key) { owners.set(key, { identity: {}, label }); }, focus(value) { focused = value; win.emit(value ? 'focus' : 'blur'); }, minimize() { minimized = true; focused = false; } };
}
function state(overrides = {}) { return { sourceId: 'view-1', revision: 1, eventId: 1, waiting: true, acknowledged: false, kind: 'confirmation', label: LABELS.confirmation, ...overrides }; }
test('native attention coalesces simultaneous sessions into one sound and actionable silent toast', t => {
  const f = nativeFixture(t); f.add('a/1', 'Server A · Task'); f.add('b/1', 'Server B · Task');
  f.coordinator.update('a/1', state()); f.coordinator.update('b/1', state({ sourceId: 'view-2' })); f.advance(200);
  assert.equal(f.sounds.length, 1); assert.deepEqual(f.sounds[0].keys, ['a/1', 'b/1']); assert.equal(f.toasts.length, 1); assert.equal(f.toasts[0].options.silent, true);
  assert.match(f.toasts[0].options.body, /Several/); assert.equal(f.win.flashes.at(-1), true);
  f.minimize(); f.toasts[0].emit('click'); assert.deepEqual(f.activated, ['a/1']); assert.equal(f.win.isMinimized(), false);
});
test('focused active session is quiet while a different session remains eligible', t => {
  const f = nativeFixture(t); f.add('a/1'); f.add('b/1'); f.coordinator.setActive('a/1'); f.focus(true);
  f.coordinator.update('a/1', state()); f.advance(1000); assert.equal(f.toasts.length, 0); assert.equal(f.sounds.length, 0);
  f.coordinator.update('b/1', state()); f.advance(200); assert.equal(f.toasts.length, 1); assert.equal(f.sounds.length, 1);
  f.coordinator.setActive('b/1'); assert.equal(f.toasts[0].closed, true); f.focus(false); f.advance(10000); assert.equal(f.sounds.length, 1);
});
test('duplicate, stale, resurrected and alternate-source state cannot replay alerts', t => {
  const f = nativeFixture(t); f.add('a/1'); f.coordinator.update('a/1', state()); f.advance(200);
  assert.equal(f.coordinator.update('a/1', state()), false);
  assert.equal(f.coordinator.update('a/1', state({ sourceId: 'unexpected-source', revision: 99 })), false);
  f.coordinator.update('a/1', state({ revision: 2, waiting: false, kind: '', label: '' })); assert.equal(f.toasts[0].closed, true);
  assert.equal(f.coordinator.update('a/1', state({ revision: 3 })), false, 'A cleared event cannot be revived');
  f.advance(10000); assert.equal(f.sounds.length, 1); assert.equal(f.win.flashes.at(-1), false);
});
test('new events are retained through per-session cooldown, not repeated continuously', t => {
  const f = nativeFixture(t); f.add('a/1'); f.coordinator.update('a/1', state()); f.advance(200);
  f.coordinator.update('a/1', state({ revision: 2, waiting: false, kind: '', label: '' }));
  f.coordinator.update('a/1', state({ revision: 3, eventId: 2 })); f.advance(4999); assert.equal(f.sounds.length, 1); f.advance(1); assert.equal(f.sounds.length, 2);
  f.advance(100000); assert.equal(f.sounds.length, 2); assert.equal(f.count(), 0);
});
test('acknowledgement, disconnect and identity replacement remove stale notices and pending alerts', t => {
  const f = nativeFixture(t); f.add('a/1'); f.add('a/2'); f.coordinator.update('a/1', state()); f.advance(200);
  f.coordinator.update('a/1', state({ revision: 2, acknowledged: true })); assert.equal(f.toasts[0].closed, true);
  assert.equal(f.coordinator.update('a/1', state({ revision: 3, acknowledged: false })), false);
  f.coordinator.update('a/2', state()); f.coordinator.clearProfile('a'); f.advance(10000); assert.equal(f.sounds.length, 1);
  f.coordinator.update('a/1', state({ sourceId: 'view-reopened' })); f.advance(200); const toast = f.toasts.at(-1);
  f.add('a/1', 'Replacement session'); toast.emit('click'); assert.deepEqual(f.activated, []);
  f.coordinator.update('a/1', state({ sourceId: 'replacement' })); f.advance(2000); assert.equal(f.toasts.length, 3);
});
test('malformed IPC state is rejected without side effects or content leakage', t => {
  const f = nativeFixture(t); f.add('a/1');
  for (const value of [null, [], {}, state({ revision: NaN }), state({ eventId: Infinity }), state({ waiting: 'yes' }),
    state({ sourceId: 'x'.repeat(101) }), state({ kind: '__proto__' }), state({ label: 'secret terminal content' }), state({ html: '<script>alert(1)</script>' }),
    state({ waiting: false }), state({ eventId: 0 })]) assert.throws(() => f.coordinator.update('a/1', value), /Invalid session attention/);
  assert.throws(() => f.coordinator.update('a/1\n', state()), /Invalid session/);
  assert.throws(() => f.coordinator.setActive('\x1b[31m'), /Invalid active session/);
  assert.equal(f.coordinator.update('unknown/1', state()), false); f.advance(10000); assert.equal(f.sounds.length, 0); assert.equal(f.toasts.length, 0);
  assert.deepEqual(validateState(state()), state());
});
test('preferences independently disable sound, desktop, and all detection attention', t => {
  const f = nativeFixture(t); f.add('a/1', 'Safe\nname\u202e'); f.preferences.audio = false;
  f.coordinator.update('a/1', state()); f.advance(200); assert.equal(f.sounds.length, 0); assert.equal(f.toasts.length, 1); assert.ok(!/[\n\u202e]/.test(f.toasts[0].options.body));
  f.preferences.desktop = false; f.coordinator.refreshPreferences(); assert.equal(f.toasts[0].closed, true); assert.equal(f.win.flashes.at(-1), false);
  f.preferences.audio = true; f.add('b/1'); f.coordinator.update('b/1', state()); f.advance(2000); assert.equal(f.sounds.length, 1); assert.equal(f.toasts.length, 1);
  f.preferences.enabled = false; f.coordinator.refreshPreferences(); f.add('c/1'); f.coordinator.update('c/1', state()); f.advance(10000); assert.equal(f.sounds.length, 1); assert.equal(f.count(), 0);
});
test('rate and session bounds survive repeated new sources and continuous state updates', t => {
  const f = nativeFixture(t);
  for (let i = 0; i < 160; i++) { const key = `host/${i}`; f.add(key); assert.equal(f.coordinator.update(key, state({ sourceId: `source-${i}` })), i < 128); }
  f.advance(200); assert.equal(f.sounds.length, 1); assert.equal(f.sounds[0].keys.length, 128); assert.equal(f.toasts.length, 1);
  f.coordinator.dispose(); assert.equal(f.count(), 0); assert.equal(f.win.listenerCount('focus'), 0); assert.equal(f.toasts[0].closed, true);
});
test('pending alert is not starved by additional sessions arriving during coalescing', t => {
  const f = nativeFixture(t); f.add('a/1'); f.coordinator.update('a/1', state()); f.advance(100);
  f.add('b/1'); f.coordinator.update('b/1', state()); f.advance(100); assert.equal(f.sounds.length, 1);
});
test('unsupported, failed or throwing native notifications retain independent sound/taskbar behavior', t => {
  for (const failure of ['unsupported', 'throws', 'failed']) {
    class BrokenNotification extends EventEmitter {
      static isSupported() { return failure !== 'unsupported'; }
      show() { if (failure === 'throws') throw new Error('Unavailable'); this.emit('failed', {}, 'Unavailable'); }
      close() {}
    }
    const f = nativeFixture(t, { Notification: BrokenNotification }); f.add('a/1'); f.coordinator.update('a/1', state()); f.advance(200);
    assert.equal(f.sounds.length, 1, failure); assert.equal(f.win.flashes.at(-1), true, failure);
    f.coordinator.forget('a/1'); assert.equal(f.win.flashes.at(-1), false); f.advance(10000); assert.equal(f.sounds.length, 1);
  }
});
test('the alert sound schedules one short tone and handles unavailable audio without throwing', async () => {
  const events = [], source = fs.readFileSync(path.join(__dirname, '../ui/session-attention.js'), 'utf8');
  class AudioContext {
    constructor() { this.currentTime = 10; this.state = 'suspended'; this.destination = {}; }
    async resume() { this.state = 'running'; }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
    createOscillator() { return { frequency: { setValueAtTime() {} }, connect() {}, disconnect() {},
      start(time) { events.push(['start', time]); }, stop(time) { events.push(['stop', time]); this.onended(); } }; }
  }
  const window = { AudioContext }; vm.runInNewContext(source, { window, setTimeout, clearTimeout });
  assert.equal(await window.NerdSSHellAttention.playAlert(), true); assert.deepEqual(events, [['start', 10], ['stop', 10.26]]);
  const unavailable = {}; vm.runInNewContext(source, { window: unavailable, setTimeout, clearTimeout });
  assert.equal(await unavailable.NerdSSHellAttention.playAlert(), false);
});
