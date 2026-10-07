'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Remote } = require('../src/remote.cjs');
const { Control } = require('../src/control.cjs');
const { commandInput, installSessionCommands } = require('../src/session-commands.cjs');
const { validateSettings, configuredActions, compileConfigured, previewFacts } = require('../src/action-settings.cjs');
const { compileAction, availableActions } = require('../src/action-catalog.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const customId = 'custom.01234567-1234-1234-1234-0123456789ab';
const otherId = 'custom.01234567-1234-1234-1234-0123456789ac';
function fixture({ os = 'Ubuntu', shell = 'powershell' } = {}) {
  const facts = previewFacts(os, shell);
  const handlers = {}, written = [], connections = new Map();
  const profile = { id: 'fixture', name: 'Fixture', host: 'fixture.example', username: 'synthetic', auth: 'password' }, pane = { key: 'fixture/one', sessionToken: 'session-one', sessionId: '$1', paneId: '%1' };
  const view = { active: true, initialized: true, snapshotSerial: 0, pane };
  const remote = { connected: true, closing: false, client: {}, profile, panes: [pane], views: new Map([[pane.key, view]]),
    pane(key) { const result = this.panes.find(item => item.key === key); if (!result) throw Error('Unknown pane'); return result; },
    input(key, text) { written.push({ key, text }); return Promise.resolve(); } };
  const runtime = { profile, remote }; connections.set(profile.id, runtime);
  let locked = false, settings = validateSettings({ custom: [{ id: customId, os, ...(os === 'Windows' ? { shell } : {}), title: 'Fixture command', code: 'printf original' }] });
  const commands = installSessionCommands({ handle: (name, fn) => { handlers[name] = fn; }, connections,
    forKey: key => { const r = connections.get(key.split('/')[0]); if (!r) throw Error('Disconnected'); r.remote.pane(key); return r; },
    assertInput() { if (locked) throw Error('Input is locked'); }, resolveAction: (_key, id, argument) => compileConfigured(id, facts, argument, settings) });
  const request = (changes = {}) => ({ target: commands.context(pane.key), actionId: 'system.disk', argument: '', bracketedPaste: true, ...changes });
  return { handlers, commands, request, remote, runtime, connections, pane, view, written,
    setLocked: value => { locked = value; }, setCode: code => { settings = validateSettings({ custom: [{ ...settings.custom[0], code }] }); } };
}

test('command input matches paste normalization and includes Enter in the same event', () => {
  assert.equal(commandInput('printf "é"\r\nprintf "😀"', true), '\x1b[200~printf "é"\rprintf "😀"\x1b[201~\r');
  assert.equal(commandInput('echo one\necho two', false), 'echo one\recho two\r');
  for (const code of ['', 'echo\0bad', '\x1b[201~injected', 'a\u202eb', 'a\x03b']) assert.throws(() => commandInput(code, false));
  assert.throws(() => commandInput('echo ok', 'true'), /paste mode/);
});
test('the main process resolves a saved action ID and writes only to its captured terminal', async () => {
  const h = fixture(), other = { ...h.pane, key: 'fixture/two', sessionToken: 'session-two' };
  h.remote.panes.push(other); h.remote.views.set(other.key, { ...h.view, pane: other });
  const request = h.request();
  await assert.rejects(h.handlers.paneActionRun(other.key, request), /menu changed/);
  await h.handlers.paneActionRun(h.pane.key, request);
  assert.deepEqual(h.written, [{ key: 'fixture/one', text: '\x1b[200~df -h\x1b[201~\r' }]);
});
test('action IPC rejects renderer commands, OS claims, malformed parameters and disabled locks', async () => {
  const h = fixture();
  for (const changed of [{ code: 'echo not saved' }, { os: 'Windows' }, { argument: [] }, { argument: 'x'.repeat(129) }, { target: '' }, { actionId: {} }, { bracketedPaste: 'yes' }, { actionId: 'missing' }]) {
    await assert.rejects(h.handlers.paneActionRun(h.pane.key, h.request(changed)));
  }
  h.setLocked(true); await assert.rejects(h.handlers.paneActionRun(h.pane.key, h.request()), /locked/);
  h.setLocked(false); await assert.rejects(h.handlers.paneActionRun(h.pane.key, h.request({ actionId: 'services.status', argument: 'fake;id' })), /exact name/);
  assert.equal(h.written.length, 0);
});
test('saved commands resolve from current configuration, including validation at the terminal boundary', async () => {
  const h = fixture(), request = h.request({ actionId: customId, bracketedPaste: false }); h.setCode('printf changed');
  await h.handlers.paneActionRun(h.pane.key, request); assert.equal(h.written[0].text, 'printf changed\r');
  await h.handlers.paneActionRun(h.pane.key, h.request({ actionId: 'services.status', argument: 'fixture@one.service', bracketedPaste: false }));
  assert.equal(h.written[1].text, "systemctl status --no-pager -- 'fixture@one.service'\r");
});
test('compiled CMD actions reject overlong individual lines before dispatch while preserving other shells and multiline input', async () => {
  const cmd = fixture({ os: 'Windows', shell: 'cmd' }), long = 'echo ' + 'x'.repeat(8187);
  cmd.setCode(long);
  await assert.rejects(cmd.handlers.paneActionRun(cmd.pane.key, cmd.request({ actionId: customId, bracketedPaste: false })), /8,191.*not sent/);
  assert.equal(cmd.written.length, 0);
  const boundary = long.slice(0, 8191); cmd.setCode(boundary);
  await cmd.handlers.paneActionRun(cmd.pane.key, cmd.request({ actionId: customId, bracketedPaste: false }));
  assert.equal(cmd.written[0].text, boundary + '\r');
  const multiline = 'x'.repeat(4095) + '\n' + 'y'.repeat(4096); cmd.setCode(multiline);
  await cmd.handlers.paneActionRun(cmd.pane.key, cmd.request({ actionId: customId, bracketedPaste: false }));
  assert.equal(cmd.written[1].text, multiline.replace('\n', '\r') + '\r');
  const powershell = fixture({ os: 'Windows', shell: 'powershell' }); powershell.setCode(long);
  await powershell.handlers.paneActionRun(powershell.pane.key, powershell.request({ actionId: customId, bracketedPaste: false }));
  assert.equal(powershell.written[0].text, long + '\r');
});
for (const change of ['runtime', 'remote', 'client', 'view', 'session token', 'snapshot', 'inactive', 'not initialized', 'disconnected', 'closing', 'forgotten']) {
  test(`a ${change} change invalidates an old action target without sending input`, async () => {
    const h = fixture(), request = h.request();
    if (change === 'runtime') h.connections.set('fixture', { ...h.runtime });
    if (change === 'remote') h.runtime.remote = { ...h.remote };
    if (change === 'client') h.remote.client = {};
    if (change === 'view') h.remote.views.set(h.pane.key, { ...h.view });
    if (change === 'session token') h.pane.sessionToken = 'replacement';
    if (change === 'snapshot') h.view.snapshotSerial++;
    if (change === 'inactive') h.view.active = false;
    if (change === 'not initialized') h.view.initialized = false;
    if (change === 'disconnected') h.remote.connected = false;
    if (change === 'closing') h.remote.closing = true;
    if (change === 'forgotten') h.commands.forget(h.pane.key);
    await assert.rejects(h.handlers.paneActionRun(h.pane.key, request)); assert.equal(h.written.length, 0);
  });
}
test('recovery issues a fresh target but never replays an old command', async () => {
  const h = fixture(), prior = h.request(); h.view.snapshotSerial++; const next = h.request(); assert.notEqual(next.target, prior.target);
  await assert.rejects(h.handlers.paneActionRun(h.pane.key, prior), /menu changed/);
  assert.equal(h.written.length, 0); await h.handlers.paneActionRun(h.pane.key, next); assert.equal(h.written.length, 1);
});
test('a replaced nonpersistent shell record or stream cannot inherit an earlier action target', async () => {
  for (const change of ['record', 'stream', 'closed']) {
    const h = fixture(), record = { stream: {}, serial: 0 };
    h.remote.shells = new Map([[h.pane.key, record]]); const request = h.request();
    if (change === 'record') h.remote.shells.set(h.pane.key, { ...record });
    if (change === 'stream') record.stream = {};
    if (change === 'closed') record.channelClosed = true;
    await assert.rejects(h.handlers.paneActionRun(h.pane.key, request), /changed/); assert.equal(h.written.length, 0);
  }
});
test('cleanup tolerates a partially initialized or already removed runtime', () => {
  const h = fixture(); h.connections.set('fixture', { profile: h.runtime.profile, remote: {} });
  h.commands.forget(h.pane.key); h.commands.disconnect('fixture'); h.connections.delete('fixture'); h.commands.disconnect('fixture');
});

class Stream extends EventEmitter {
  constructor() { super(); this.commands = []; this.number = 0; }
  write(command) { this.commands.push(command.trim()); return true; }
  reply() { const n = ++this.number; this.emit('data', Buffer.from(`%begin ${n} ${n} 1\n%end ${n} ${n} 1\n`)); }
  destroy() {}
}
function queueFixture(t) {
  const stream = new Stream(), control = new Control(stream); control.feed(Buffer.from('%begin 0 0 0\n%end 0 0 0\n'));
  const h = fixture(), remote = new Remote(h.runtime.profile);
  remote.connected = true; remote.panes = h.remote.panes; remote.views = h.remote.views; remote.controls.set('$1', control); remote.control = async () => control;
  h.runtime.remote = remote; h.remote = remote; t.after(() => remote.disconnect());
  const sent = () => Buffer.concat(stream.commands.filter(command => command.startsWith("send-keys -H -t '%1' ")).map(command => Buffer.from(command.split("' ")[1].replace(/ /g, ''), 'hex'))).toString();
  async function drain() { for (let attempt = 0; attempt < 30; attempt++) { await tick(); if (control.active) stream.reply(); } }
  return { ...h, remote, stream, control, sent, drain };
}
test('long Actions, Favorites and ordinary keys share the actual transport event order', async t => {
  const h = queueFixture(t), code = 'printf ' + 'é'.repeat(700); h.setCode(code);
  const one = h.handlers.paneActionRun(h.pane.key, h.request({ actionId: customId }));
  const two = h.handlers.paneActionRun(h.pane.key, h.request({ bracketedPaste: false }));
  const key = h.remote.input(h.pane.key, 'MANUAL'); await h.drain(); await Promise.all([one, two, key]);
  assert.equal(h.sent(), commandInput(code, true) + 'df -h\rMANUAL');
});
test('disconnect during a partially sent command discards its Enter and subsequent queued action', async t => {
  const h = queueFixture(t); h.setCode('printf ' + 'x'.repeat(1200));
  const pending = Promise.allSettled([h.handlers.paneActionRun(h.pane.key, h.request({ actionId: customId })), h.handlers.paneActionRun(h.pane.key, h.request())]);
  await tick(); h.remote.disconnect(); const results = await pending;
  assert.ok(results.every(result => result.status === 'rejected')); assert.equal(Buffer.byteLength(h.sent()), 512);
  assert.equal(h.sent().includes('\r'), false); assert.equal(h.sent().includes('df -h'), false);
});
test('locking during queued action input invalidates remaining bytes and its Enter', async t => {
  const h = queueFixture(t); h.setCode('printf ' + 'x'.repeat(1200));
  const pending = Promise.allSettled([h.handlers.paneActionRun(h.pane.key, h.request({ actionId: customId })), h.handlers.paneActionRun(h.pane.key, h.request())]);
  await tick(); h.view.inputSerial = (h.view.inputSerial || 0) + 1; h.setLocked(true); await h.drain();
  assert.ok((await pending).every(result => result.status === 'rejected')); assert.equal(Buffer.byteLength(h.sent()), 512); assert.equal(h.sent().includes('\r'), false);
});

test('Windows custom action migration preserves PowerShell and makes new CMD actions explicit', () => {
  const checked = validateSettings({ custom: [
    { id: customId, os: 'Windows', title: 'Existing PowerShell', code: 'Write-Output old' },
    { id: otherId, os: 'Windows', shell: 'cmd', title: 'Command Prompt', code: 'echo %CD%' }
  ], favoritesByOS: { Windows: [customId, otherId] } });
  assert.equal(checked.custom[0].shell, 'powershell');
  assert.deepEqual(configuredActions(previewFacts('Windows'), checked).filter(action => action.id.startsWith('custom.')).map(action => action.id), [customId]);
  assert.deepEqual(configuredActions(previewFacts('Windows', 'cmd'), checked).filter(action => action.id.startsWith('custom.')).map(action => action.id), [otherId]);
  assert.throws(() => compileConfigured(customId, previewFacts('Windows', 'cmd'), '', checked), /unavailable/);
  assert.throws(() => compileConfigured(otherId, previewFacts('Windows'), '', checked), /unavailable/);
  assert.equal(compileConfigured(otherId, previewFacts('Windows', 'cmd'), '', checked).shell, 'cmd');
  assert.throws(() => validateSettings({ custom: [{ ...checked.custom[0], shell: 'bash' }] }), /PowerShell or Command Prompt/);
});
test('Command Prompt built-in recipes use supported CMD syntax without PowerShell or Unix tokens', () => {
  const cmd = previewFacts('Windows', 'cmd'), commands = availableActions(cmd).filter(action => action.enabled).map(action => compileAction(action.id, cmd));
  assert.equal(commands.length, 8); assert.ok(commands.every(plan => plan.shell === 'cmd'));
  for (const plan of commands) assert.doesNotMatch(plan.code, /Get-|Select-Object|\$PSVersionTable|sudo|systemctl|apt\b/);
  assert.equal(compileAction('updates.check', cmd).code, 'start "" ms-settings:windowsupdate');
  assert.equal(compileAction('system.processes', cmd).code, 'tasklist');
  assert.throws(() => compileAction('system.shutdown', cmd));
  assert.throws(() => previewFacts('Windows', 'bash')); assert.throws(() => compileAction('system.disk', { system: 'Windows', shell: 'bash' }));
});
