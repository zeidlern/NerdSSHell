'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Remote } = require('../src/remote.cjs');
const { MixedRemote } = require('../src/mixed-remote.cjs');
const settings = { id: 'fixture', name: 'Fixture', host: 'fixture.invalid', username: 'tester', auth: 'agent' };
const token = '11111111-2222-4333-8444-555555555555';
function fixture(Ctor = Remote) {
  const r = new Ctor(settings); r.connected = true; r.client = new EventEmitter(); r.client.end = () => {};
  const p = { key: 'fixture/' + token + '/%0', sessionId: '$0', sessionToken: token, paneId: '%0', dead: false };
  const view = { pane: p, active: true };
  r.panes = [p]; r.views.set(p.key, view);
  let detaches = 0;
  r.controls.set('$0', { sessionToken: token, detach() { detaches++; } });
  r.opening.set('$0', { token, task: Promise.resolve() });
  return { r, p, view, detaches: () => detaches };
}
for (const message of ['no server running on /tmp/tmux-fixture/default', 'no sessions', 'error connecting: No such file or directory']) {
  test('empty tmux reconciliation publishes removal: ' + message, async () => {
    const h = fixture(); const events = [];
    h.r.exec = async () => ({ code: 1, stdout: '', stderr: message });
    h.r.on('ended', key => events.push(['ended', key])); h.r.on('panes', panes => events.push(['panes', panes]));
    assert.deepEqual(await h.r.discover(), []);
    assert.equal(h.view.active, false); assert.equal(h.r.views.size, 0);
    assert.equal(h.r.controls.size, 0); assert.equal(h.r.opening.size, 0); assert.equal(h.detaches(), 1);
    assert.deepEqual(events, [['ended', h.p.key], ['panes', []]]);
  });
}
test('unexpected discovery failure retains prior view instead of pretending it ended', async () => {
  const h = fixture(); h.r.exec = async () => ({ code: 1, stderr: 'permission denied', stdout: '' });
  await assert.rejects(h.r.discover(), /permission denied/);
  assert.equal(h.r.views.get(h.p.key), h.view); assert.equal(h.view.active, true); assert.equal(h.detaches(), 0);
});
test('mixed discovery removes final persistent view without closing a standard channel', async () => {
  const h = fixture(MixedRemote), key = 'fixture/standard-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const pane = { key, standard: true, sessionToken: 'standard-token', sessionId: 'standard-session' };
  const view = { pane, active: true, initialized: true };
  h.r.standard.panes = [pane]; h.r.panes.push(pane); h.r.views.set(key, view);
  h.r.persistenceReady = true;
  h.r.exec = async () => ({ code: 1, stdout: '', stderr: 'no server running' });
  const ended = []; h.r.on('ended', key => ended.push(key));
  const panes = await h.r.discover();
  assert.deepEqual(panes, [pane]); assert.deepEqual(ended, [h.p.key]);
  assert.equal(h.r.views.get(key), view); assert.equal(view.active, true); assert.equal(view.initialized, true);
  assert.equal(h.detaches(), 1);
});
test('Standard creation uses shared authenticated transport without enabling tmux', async () => {
  const r = new MixedRemote(settings); let support = 0;
  r.enablePersistence = async () => { support++; };
  r.standard.create = async name => ({ name, standard: true });
  assert.deepEqual(await r.createSession('Ordinary', false), { name: 'Ordinary', standard: true });
  assert.equal(support, 0);
  await assert.rejects(r.createSession('Wrong', 'false'), /persistent/);
});
test('ending a Standard session leaves persistent registry untouched', async () => {
  const h = fixture(MixedRemote); h.r.standard.connected = true;
  const key = 'fixture/standard-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const pane = { key, standard: true, sessionToken: 'std', sessionId: 'std' };
  let closed = 0; const record = { pane, serial: 0, dead: false, stream: { close() { closed++; } } };
  h.r.shells.set(key, record); h.r.standard.panes = [pane]; h.r.panes.push(pane);
  h.r.views.set(key, { pane, active: true });
  await h.r.endSession(key);
  assert.equal(closed, 1); assert.equal(h.r.views.get(h.p.key), h.view); assert.equal(h.view.active, true);
  assert.deepEqual(h.r.panes, [h.p]); assert.equal(h.detaches(), 0);
});


const { installSessionActions, isStandardSession } = require('../src/session-actions.cjs');
function lifecycleHarness({ standard = false, local = false } = {}) {
  const key = standard ? 'fixture/standard-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' : 'fixture/' + token + '/%0';
  const pane = { key, sessionId: '$0', sessionToken: token, sessionName: 'Fixture', standard };
  const calls = [], dialogs = [], handlers = new Map(), pending = [];
  const remote = { profile: { id: 'fixture', local }, connected: true, closing: false,
    panes: [pane], views: new Map([[key, { pane, active: true }]]), shells: new Map(standard ? [[key, {}]] : []),
    pane(k) { const value = this.panes.find(p => p.key === k); if (!value) throw new Error('Session no longer exists.'); return value; },
    isStandard(k) { return k.startsWith('fixture/standard-'); },
    closeView(k) { calls.push(['close', k]); }, endSession(k) { calls.push(['end', k]); },
    createSession(name, persistent) { calls.push(['create', name, persistent]); return { name, persistent }; },
    create(name) { calls.push(['local-create', name]); return { name, local: true }; }
  };
  const runtime = { profile: { id: 'fixture', name: 'Test host' }, remote };
  const connections = new Map([['fixture', runtime]]);
  installSessionActions({ handle: (name, fn) => handlers.set(name, fn), connections,
    runtime: id => { assert.equal(id, 'fixture'); return runtime; },
    forKey: k => { remote.pane(k); return runtime; }, getWindow: () => 'fixture-window',
    forget: k => calls.push(['forget', k]),
    dialog: { showMessageBox(window, options) { assert.equal(window, 'fixture-window'); dialogs.push(options); return new Promise((resolve, reject) => pending.push({ resolve, reject })); } }
  });
  return { key, pane, remote, runtime, connections, calls, dialogs, handlers,
    answer: response => pending.shift().resolve({ response }), fail: () => pending.shift().reject(new Error('Dialog failed.')) };
}
test('create defaults to persistent and passes an explicit Standard choice to the same transport', () => {
  const h = lifecycleHarness();
  assert.deepEqual(h.handlers.get('create')('fixture', 'Persistent'), { name: 'Persistent', persistent: true });
  assert.deepEqual(h.handlers.get('create')('fixture', 'Ordinary', false), { name: 'Ordinary', persistent: false });
  assert.throws(() => h.handlers.get('create')('fixture', 'Invalid', 'false'), /persistent/);
  assert.equal(h.dialogs.length, 0);
});
test('local session creation stays nonpersistent regardless of the default checkbox value', () => {
  const h = lifecycleHarness({ local: true, standard: true });
  assert.deepEqual(h.handlers.get('create')('fixture', 'Local'), { name: 'Local', local: true });
  assert.deepEqual(h.calls, [['local-create', 'Local']]);
});
test('End requires explicit consent, affirmative left and Cancel right/default', async () => {
  const h = lifecycleHarness(), promise = h.handlers.get('end')(h.key);
  assert.deepEqual(h.calls, []); assert.deepEqual(h.dialogs[0].buttons, ['End session', 'Cancel']);
  assert.equal(h.dialogs[0].cancelId, 1); assert.equal(h.dialogs[0].defaultId, 1);
  h.answer(1); assert.equal(await promise, false); assert.deepEqual(h.calls, []);
  const accepted = h.handlers.get('end')(h.key); h.answer(0); assert.equal(await accepted, true);
  assert.deepEqual(h.calls, [['end', h.key], ['forget', h.key]]);
});
for (const mutation of ['connection', 'remote', 'identity', 'disconnected']) {
  test('End approval cannot follow changed ' + mutation, async () => {
    const h = lifecycleHarness(), promise = h.handlers.get('end')(h.key);
    if (mutation === 'connection') h.connections.set('fixture', { ...h.runtime });
    if (mutation === 'remote') h.runtime.remote = { ...h.remote };
    if (mutation === 'identity') h.pane.sessionToken = 'replacement';
    if (mutation === 'disconnected') h.remote.connected = false;
    h.answer(0); await assert.rejects(promise, /changed/); assert.deepEqual(h.calls, []);
  });
}
test('duplicate End opens one native dialog and performs one operation', async () => {
  const h = lifecycleHarness(), first = h.handlers.get('end')(h.key);
  await assert.rejects(h.handlers.get('end')(h.key), /existing confirmation/);
  assert.equal(h.dialogs.length, 1); h.answer(0); await first;
  assert.equal(h.calls.filter(c => c[0] === 'end').length, 1);
});
test('dialog failure frees the confirmation reservation without performing an operation', async () => {
  const h = lifecycleHarness(), first = h.handlers.get('end')(h.key);
  h.fail(); await assert.rejects(first, /Dialog failed/); assert.deepEqual(h.calls, []);
  const second = h.handlers.get('end')(h.key); h.answer(1); await second;
  assert.equal(h.dialogs.length, 2);
});
test('persistent Disconnect detaches its view without a terminate command or native dialog', async () => {
  const h = lifecycleHarness(); assert.equal(await h.handlers.get('close')(h.key), true);
  assert.equal(h.dialogs.length, 0); assert.deepEqual(h.calls, [['forget', h.key], ['close', h.key]]);
});
test('Standard Disconnect needs consent and cannot close a replaced view', async () => {
  const h = lifecycleHarness({ standard: true }), first = h.handlers.get('close')(h.key);
  assert.deepEqual(h.dialogs[0].buttons, ['Disconnect', 'Cancel']); h.answer(1);
  assert.equal(await first, false); assert.deepEqual(h.calls, []);
  const second = h.handlers.get('close')(h.key); h.remote.views.set(h.key, { pane: h.pane, active: true });
  h.answer(0); await assert.rejects(second, /view changed/); assert.deepEqual(h.calls, []);
  const third = h.handlers.get('close')(h.key); h.answer(0); assert.equal(await third, true);
  assert.deepEqual(h.calls, [['forget', h.key], ['close', h.key]]);
});
test('session kind remains identifiable after its Standard record is removed', () => {
  const h = lifecycleHarness({ standard: true }); h.remote.shells.delete(h.key);
  assert.equal(isStandardSession(h.remote, h.key), true);
  assert.equal(isStandardSession(h.remote, 'fixture/' + token + '/%0'), false);
});
test('mixed transport closes Standard records before publishing loss of the SSH connection', async () => {
  const r = new MixedRemote(settings); r.client = new EventEmitter(); const order = [];
  r.client.on('close', () => order.push('connection-lost'));
  r.shells.set('temporary', {}); r.standard.finishShell = () => order.push('standard-ended');
  await r.ensureSupport(); r.client.emit('close');
  assert.deepEqual(order, ['standard-ended', 'connection-lost']);
});
test('unfinished native confirmations are bounded across distinct sessions', async () => {
  const h = lifecycleHarness(), tasks = [];
  for (let i = 0; i < 17; i++) h.remote.panes.push({ ...h.pane, key: 'fixture/session-' + i, sessionId: '$' + i });
  for (let i = 0; i < 16; i++) tasks.push(h.handlers.get('end')('fixture/session-' + i));
  await assert.rejects(h.handlers.get('end')('fixture/session-16'), /Too many/);
  assert.equal(h.dialogs.length, 16);
  for (let i = 0; i < 16; i++) h.answer(1);
  await Promise.all(tasks); assert.deepEqual(h.calls, []);
});
