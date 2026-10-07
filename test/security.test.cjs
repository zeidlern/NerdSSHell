'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Control } = require('../src/control.cjs');
const { Remote } = require('../src/remote.cjs');
const { parsePanes } = require('../src/core.cjs');
const { PlainText } = require('../src/storage.cjs');
const { MAX_OPEN_VIEWS, MAX_DISCOVERED_PANES, ViewBudget } = require('../src/session-limits.cjs');
const base = { id: 'security-test', name: 'Disposable test', host: 'server.example', username: 'tester', auth: 'password' };
const token = '11111111-2222-4333-8444-555555555555';
class Stream extends EventEmitter { write() { return true; } destroy() { this.destroyed = true; } }
function control(t, maxBuffer = 1024) {
  const stream = new Stream(), c = new Control(stream, { maxBuffer });
  c.feed(Buffer.from('%begin 1 1 0\n%end 1 1 0\n')); t.after(() => c.detach());
  return { c, stream };
}

test('blank protocol response lines consume the response memory budget', async t => {
  const { c, stream } = control(t, 256);
  const job = c.request('capture-pane'); job.catch(() => {});
  stream.emit('data', Buffer.from('%begin 2 2 1\n'));
  for (let i = 0; i < 100 && !c.closed; i++) stream.emit('data', Buffer.from('\n'));
  assert.equal(c.closed, true, 'empty lines must not grow an unaccounted response array');
  await assert.rejects(job, /limit|large/i);
});

test('protocol close releases retained response and fragment buffers', t => {
  const { c } = control(t);
  c.feed(Buffer.from('%begin 2 2 1\nkept in block\nfragment'));
  c.detach();
  assert.equal(c.block, null);
  assert.equal(c.fragmentBytes, 0);
  assert.equal(c.fragments.length + c.pendingFragments.length, 0);
});

test('oversized packet is rejected before retaining it', t => {
  const { c } = control(t, 128);
  assert.throws(() => c.feed(Buffer.alloc(129)), /limit/i);
  assert.equal(c.fragmentBytes, 0);
  assert.equal(c.fragments.length + c.pendingFragments.length, 0);
});

test('explicit disconnect drops the Remote credential and client references', () => {
  const secrets = { password: 'synthetic-test-password', passphrase: 'synthetic-passphrase' };
  const r = new Remote(base, { secrets });
  let ended = 0; r.client = { end() { ended++; } };
  r.disconnect();
  assert.equal(ended, 1);
  assert.equal(r.client, null);
  assert.deepEqual(r.secrets, {});
  // The caller owns retry state; disconnect must not mutate somebody else's object.
  assert.equal(secrets.password, 'synthetic-test-password');
});

class DeniedClient extends EventEmitter {
  connect(options) {
    options.hostVerifier(Buffer.from('synthetic-server-key'), accepted => {
      assert.equal(accepted, false);
      const error = new Error('Host denied (verification failed)'); error.level = 'handshake';
      this.emit('error', error); this.emit('close');
    });
  }
  end() {}
}
test('cancelled host trust is preserved instead of becoming a retryable network error', async () => {
  let saved = 0;
  const r = new Remote(base, { secrets: { password: 'synthetic' }, knownHosts: '', trust: async () => false,
    savePin: () => { saved++; }, clientFactory: () => new DeniedClient() });
  await assert.rejects(r.connect(), e => e.code === 'NERDSSHELL_HOST_VERIFICATION' && /cancel/i.test(e.message));
  assert.equal(saved, 0); r.disconnect();
});
test('changed host identity keeps its non-retryable verification error', async () => {
  const r = new Remote(base, { secrets: { password: 'synthetic' }, knownHosts: '',
    pins: { 'server.example:22': 'SHA256:old-key-for-unit-test' }, clientFactory: () => new DeniedClient() });
  await assert.rejects(r.connect(), e => e.code === 'NERDSSHELL_HOST_VERIFICATION' && /changed/i.test(e.message));
  r.disconnect();
});

function paneLine(cols, rows) { return `$0\tExample\t@1\t0\tShell\t%1\t0\t${cols}\t${rows}\t0\t${token}\t1\tbash\n`; }
test('discovery bounds valid pane records before any session reconciliation', async () => {
  const listing = paneLine(120, 36).repeat(MAX_DISCOVERED_PANES);
  assert.equal(parsePanes(listing).length, MAX_DISCOVERED_PANES);
  assert.throws(() => parsePanes(listing + paneLine(120, 36)), /1024-pane safety limit/);
  assert.throws(() => parsePanes('\n' + listing + '\n' + paneLine(120, 36)), /1024-pane safety limit/);
  const r = new Remote(base); r.connected = true;
  const prior = { key: 'prior', active: true }; r.views.set('prior', prior);
  const commands = []; r.exec = async command => { commands.push(command); return { code: 0, stdout: listing + paneLine(120, 36), stderr: '' }; };
  await assert.rejects(r.discover(), /1024-pane safety limit/);
  assert.equal(commands.length, 1); assert.match(commands[0], /list-panes/);
  assert.equal(r.views.get('prior'), prior, 'an oversized reply must not reconcile away existing work');
});

test('app-wide view budget deduplicates live shells and permits reconnect at the cap', async () => {
  const remote = { views: new Map(), shells: new Map() }, sibling = { views: new Map(), shells: new Map() };
  for (let i = 0; i < MAX_OPEN_VIEWS; i++) {
    const target = i % 2 ? remote : sibling, key = 'pane-' + i;
    target.views.set(key, { active: true }); target.shells.set(key, { dead: false });
  }
  const connections = new Map([['first', { remote }], ['second', { remote: sibling }]]), budget = new ViewBudget(connections);
  let called = 0;
  await assert.rejects(budget.run(remote, 'new', () => { called++; }), /limit 64 across the app/);
  assert.equal(called, 0);
  await budget.run(remote, 'pane-1', () => { called++; }); assert.equal(called, 1);
  sibling.views.delete('pane-0'); sibling.shells.get('pane-0').dead = true;
  await budget.run(remote, 'new', () => { called++; }); assert.equal(called, 2);
});

test('pending opens reserve capacity before awaits and release after failure or cancellation', async () => {
  const remote = { views: new Map(), shells: new Map(), client: new EventEmitter() }, connections = new Map([['fixture', { remote }]]), budget = new ViewBudget(connections);
  const controls = [];
  const pending = Array.from({ length: MAX_OPEN_VIEWS }, (_, i) => budget.run(remote, 'pending-' + i, () => new Promise((resolve, reject) => controls.push({ resolve, reject }))));
  const settled = Promise.allSettled(pending); let called = 0;
  assert.equal(remote.client.listenerCount('close'), 1, 'all reservations share one cleanup listener per transport');
  await assert.rejects(budget.run(remote, 'overflow', () => { called++; }), /limit 64/);
  assert.equal(called, 0);
  controls[0].reject(Error('synthetic failed open')); await pending[0].catch(() => {});
  await budget.run(remote, 'replacement', () => { called++; }); assert.equal(called, 1);
  for (const control of controls.slice(1)) control.resolve({ cancelled: true }); await settled;
  assert.equal(budget.pending.size, 0);
  assert.equal(remote.client.listenerCount('close'), 0);
});

test('pending Standard shells count before a renderer view exists', async () => {
  const remote = { views: new Map(), shells: new Map(Array.from({ length: MAX_OPEN_VIEWS }, (_, i) => ['pending-' + i, { dead: false, stream: null }])) };
  const budget = new ViewBudget(new Map([['fixture', { remote }]])); let called = 0;
  await assert.rejects(budget.run(remote, undefined, () => { called++; }), /limit 64/);
  await budget.run(remote, 'pending-0', () => { called++; }); assert.equal(called, 1);
});

test('closed persistent generations retain separate slots while hostile attachment callbacks are withheld', async () => {
  const r = new Remote(base), pane = { key: 'security-test/' + token + '/%1', sessionId: '$0', sessionToken: token, paneId: '%1', dead: false };
  r.connected = true; r.panes = [pane];
  const callbacks = []; r.client = { exec(_command, callback) { callbacks.push(callback); } };
  r.checked = async command => command.includes('display-message -p') ? token : '';
  const budget = new ViewBudget(new Map([['security-test', { remote: r }]])), pending = [];
  for (let i = 0; i < MAX_OPEN_VIEWS; i++) {
    const opening = budget.run(r, pane.key, () => r.open(pane.key)); pending.push(opening);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(callbacks.length, i + 1); r.closeView(pane.key);
  }
  const settled = Promise.allSettled(pending);
  await assert.rejects(budget.run(r, pane.key, () => r.open(pane.key)), error => error.code === 'NERDSSHELL_RESOURCE_LIMIT');
  assert.equal(callbacks.length, MAX_OPEN_VIEWS, 'the 65th channel open must never reach the hostile server');
  for (const callback of callbacks) callback(null, { destroy() {} });
  assert.ok((await settled).every(result => result.status === 'rejected'));
  assert.equal(budget.pending.size, 0); assert.equal(r.views.size, 0);
});

test('repeat opens join their current pending view without another attachment', async () => {
  const remote = { views: new Map(), shells: new Map() }, budget = new ViewBudget(new Map([['fixture', { remote }]]));
  let resolve, opened = 0;
  const first = budget.run(remote, 'same', () => { remote.views.set('same', { active: true }); opened++; return new Promise(done => { resolve = done; }); });
  const second = budget.run(remote, 'same', () => { opened++; });
  resolve('synthetic pane'); assert.deepEqual(await Promise.all([first, second]), ['synthetic pane', 'synthetic pane']);
  assert.equal(opened, 1); assert.equal(budget.pending.size, 0);
});

test('actual transport closure releases abandoned-open capacity without waiting for a withheld callback', async () => {
  const remote = { connected: true, client: new EventEmitter(), views: new Map(), shells: new Map() };
  const connections = new Map([['fixture', { remote }]]), budget = new ViewBudget(connections, 1);
  let finish;
  const pending = budget.run(remote, 'held', () => { remote.views.set('held', { active: true }); return new Promise(resolve => { finish = resolve; }); });
  await assert.rejects(budget.run({}, 'other', () => {}), /limit 1/);
  remote.connected = false; remote.client.emit('close');
  assert.equal(budget.pending.size, 0);
  await budget.run({}, 'other', () => {});
  finish(); await pending; assert.equal(remote.client.listenerCount('close'), 0);
});

test('real pending Standard creation occupies one slot so the last two legitimate shells remain available', async () => {
  const { StandardRemote } = require('../src/standard-remote.cjs');
  const r = new StandardRemote(base); r.connected = true;
  const callbacks = [], client = r.client = new EventEmitter(); client.shell = (_geometry, callback) => callbacks.push(callback);
  const sibling = { views: new Map(Array.from({ length: MAX_OPEN_VIEWS - 2 }, (_, i) => ['prior-' + i, { active: true }])), shells: new Map() };
  const budget = new ViewBudget(new Map([['fixture', { remote: r }], ['sibling', { remote: sibling }]]));
  const first = budget.run(r, undefined, () => r.create('First')); first.catch(() => {});
  const second = budget.run(r, undefined, () => r.create('Second')); second.catch(() => {});
  assert.equal(callbacks.length, 2); assert.equal(r.shells.size, 2);
  await assert.rejects(budget.run(r, undefined, () => r.create('Overflow')), /limit 64/);
  for (const callback of callbacks) callback(Error('synthetic cancellation'));
  assert.ok((await Promise.allSettled([first, second])).every(result => result.status === 'rejected'));
  assert.equal(budget.pending.size, 0); assert.equal(r.shells.size, 0);
});

test('session, reviewed task, local and administrator launch routes all honor the shared capacity before creation', async () => {
  const { installSessionActions } = require('../src/session-actions.cjs');
  const { installWorkbench } = require('../src/workbench.cjs');
  const handlers = {}, calls = [];
  const remote = { connected: true, closing: false, profile: { id: 'fixture', host: 'fixture.invalid' },
    views: new Map(Array.from({ length: MAX_OPEN_VIEWS }, (_, i) => ['pane-' + i, { active: true }])),
    createSession() { calls.push('session'); }, createTask() { calls.push('task'); } };
  const connections = new Map([['fixture', { profile: remote.profile, remote }]]), budget = new ViewBudget(connections);
  const handle = (name, fn) => { handlers[name] = fn; }, withViewSlot = (owner, key, operation) => budget.run(owner, key, operation);
  installSessionActions({ handle, runtime: id => connections.get(id), connections, withViewSlot });
  const workbench = installWorkbench({ handle, connections, withViewSlot, getStore: () => ({ data: {} }),
    app: { isPackaged: false }, dialog: { showMessageBox: async () => ({ response: 0 }) }, getWindow: () => ({}),
    shellProvider: () => [{ id: 'local:powershell', name: 'Synthetic PowerShell', executable: 'synthetic-fixed-executable' }],
    localFactory: () => { calls.push('local factory'); throw Error('Native execution is forbidden'); } });
  for (const persistent of [true, false]) await assert.rejects(handlers.create('fixture', 'Test', persistent), /limit 64/);
  await assert.rejects(handlers.localOpen('local:powershell'), /limit 64/);
  await assert.rejects(workbench.openAdministrator('local:powershell'), /limit 64/);
  const reviewed = handlers.workbenchReview('fixture', { code: 'printf synthetic' });
  await assert.rejects(handlers.workbenchRun(reviewed.token), /limit 64/);
  assert.deepEqual(calls, []); assert.equal(budget.pending.size, 0);
});
test('discovery rejects remote dimensions outside the renderer budget', () => {
  assert.throws(() => parsePanes(paneLine(10000, 10000)), /columns|rows|geometry|limit/i);
  assert.throws(() => parsePanes(paneLine(1001, 30)), /columns|geometry|limit/i);
  assert.throws(() => parsePanes(paneLine(80, 501)), /rows|geometry|limit/i);
});
test('ordinary remote dimensions remain supported', () => {
  const [p] = parsePanes(paneLine(240, 90)); assert.equal(p.cols, 240); assert.equal(p.rows, 90);
});
test('snapshot rejects excessive geometry before capture or renderer emission', async () => {
  const r = new Remote(base); const pane = { key: 'example', paneId: '%1', sessionId: '$0' };
  r.connected = true;
  r.panes = [pane]; r.views.set('example', { pane, active: true, initialized: false });
  let captures = 0, snapshots = 0;
  const c = { request: async (command, complete) => {
    if (command.startsWith('display-message')) return [Buffer.from('10000|10000|0|0|0|0|0|0|0|0|0|1')];
    captures++; complete?.([]); return [];
  }};
  r.controls.set('$0', c); r.control = async () => c;
  r.on('snapshot', () => snapshots++);
  await assert.rejects(r.snapshot('example'), /columns|rows|geometry|limit/i);
  assert.equal(captures, 0); assert.equal(snapshots, 0);
});

test('plain-text archives do not preserve Unicode C1 terminal controls', () => {
  const f = new PlainText(); assert.equal(f.push(Buffer.from('A\u009b31mB\u0085C')), 'A31mBC');
});

const { pasteText } = require('../src/core.cjs');
test('clipboard text permits ordinary multiline text and Unicode', () => {
  assert.equal(pasteText('printf hello\r\n😀\tworld'), 'printf hello\r\n😀\tworld');
});
for (const value of ['\x1b[201~', '\x03', '\u009b', '\x00']) {
  test('clipboard text blocks control character ' + JSON.stringify(value), () => {
    assert.throws(() => pasteText('before' + value + 'after'), /control characters/);
  });
}
test('clipboard byte budget is enforced for Unicode and oversized input', () => {
  assert.throws(() => pasteText('😀'.repeat(262145)), /1 MB/);
  assert.throws(() => pasteText({}), /1 MB/);
});
