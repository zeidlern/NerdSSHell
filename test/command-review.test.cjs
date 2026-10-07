'use strict';
// Phase 3: synthetic commands, transports and native dialogs only. No production hosts.
const test = require('node:test'), assert = require('node:assert/strict');
const { installWorkbench } = require('../src/workbench.cjs');
const { ReviewTickets, scriptText } = require('../src/action-catalog.cjs');
const { extractBlocks } = require('../ui/command-review.js');
const { Remote } = require('../src/remote.cjs');
const { StandardRemote } = require('../src/standard-remote.cjs');
const { EventEmitter } = require('node:events');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function harness() {
  const handlers = {}, events = [], launches = [], dialogs = [], connections = new Map();
  for (const id of ['a', 'b']) {
    const profile = { id, name: id.toUpperCase(), host: `${id}.example`, username: 'tester', port: 22, sessionMode: 'persistent' };
    const remote = { connected: true, closing: false, views: new Map([[id+'/pane', { active: true, initialized: true, inputSerial: 0 }]]), shells: new Map(),
      checked: async () => 'system:Linux\ncap:apt\ncap:systemctl',
      input() { throw Error('Reviewed commands must not go into an existing terminal'); },
      createTask: async (name, code) => { launches.push({ id, name, code }); return { key: id+'/task', profileId: id }; } };
    connections.set(id, { profile, remote, state: 'connected' });
  }
  let confirmation = async () => ({ response: 0 });
  const wb = installWorkbench({ handle: (n, fn) => { handlers[n] = fn; }, connections,
    getStore: () => ({ data: {}, save() { throw Error('Commands must not be saved'); } }),
    app: { isPackaged: false, getVersion: () => 'fixture' }, getWindow: () => ({}),
    dialog: { showMessageBox: (_w, options) => { dialogs.push(options); return confirmation(); } },
    emit: (type, data) => events.push({ type, ...data }), queueOutput() {}, discardOutput() {}, output: { flush() {} },
    forKey: key => { const r = connections.get(key.split('/')[0]); if (!r?.remote.connected || !r.remote.views.has(key)) throw Error('Unknown view'); return r; },
    shellProvider: () => [] });
  return { handlers, connections, events, launches, dialogs, wb, setConfirmation(fn) { confirmation = fn; } };
}

test('cancelling a review while its native confirmation is open prevents launch', async () => {
  const h = harness(), d = deferred(); h.setConfirmation(() => d.promise);
  const review = h.handlers.workbenchReview('a', { code: 'printf synthetic' });
  const pending = h.handlers.workbenchRun(review.token); h.handlers.workbenchCancelReview(review.token);
  d.resolve({ response: 0 });
  await assert.rejects(pending, /expired|cancel|review/i); assert.equal(h.launches.length, 0);
});
test('review expiry is enforced again AFTER native confirmation', async t => {
  let now = 0; t.mock.method(Date, 'now', () => now);
  const h = harness(), d = deferred(); h.setConfirmation(() => d.promise);
  const review = h.handlers.workbenchReview('a', { code: 'printf synthetic' });
  const pending = h.handlers.workbenchRun(review.token); now = 300001; d.resolve({ response: 0 });
  await assert.rejects(pending, /expired|review/i); assert.equal(h.launches.length, 0);
});
test('disconnect invalidates a review already in native confirmation', async () => {
  const h = harness(), d = deferred(); h.setConfirmation(() => d.promise);
  const review = h.handlers.workbenchReview('a', { code: 'printf synthetic' });
  const pending = h.handlers.workbenchRun(review.token); h.wb.disconnect('a'); d.resolve({ response: 0 });
  await assert.rejects(pending, /expired|review|changed/i); assert.equal(h.launches.length, 0);
});
test('in-flight native confirmations remain counted against the 16-review limit', async () => {
  const h = harness(), d = deferred(); h.setConfirmation(() => d.promise);
  const pending = Array.from({ length: 16 }, () => h.handlers.workbenchRun(h.handlers.workbenchReview('a', { code: 'printf synthetic' }).token));
  try { assert.throws(() => h.handlers.workbenchReview('a', { code: 'printf synthetic' }), /Too many/); }
  finally { d.resolve({ response: 1 }); await Promise.all(pending); }
});
test('duplicate Run consumes no second native dialog or task, and cannot cancel the first Run', async () => {
  const h = harness(), d = deferred(); h.setConfirmation(() => d.promise);
  const review = h.handlers.workbenchReview('a', { code: "printf '%s' 'reviewed 😀'" });
  const pending = h.handlers.workbenchRun(review.token);
  await assert.rejects(h.handlers.workbenchRun(review.token), /already used/); assert.equal(h.dialogs.length, 1);
  d.resolve({ response: 0 }); await pending;
  assert.deepEqual(h.launches.map(x => x.code), [review.code]);
});
test('reviewed code and destination do not follow request mutation or another target', async () => {
  const h = harness(), request = { code: "printf '%s' 'A'" };
  const a = h.handlers.workbenchReview('a', request); request.code = 'printf changed';
  h.handlers.workbenchReview('b', { code: 'printf B' }); await h.handlers.workbenchRun(a.token);
  assert.equal(h.launches.length, 1); assert.equal(h.launches[0].id, 'a'); assert.equal(h.launches[0].code, a.code);
});
test('a native-dialog failure consumes the review without starting a task', async () => {
  const h = harness(); h.setConfirmation(async () => { throw Error('fixture dialog failed'); });
  const r = h.handlers.workbenchReview('a', { code: 'printf synthetic' });
  await assert.rejects(h.handlers.workbenchRun(r.token), /dialog failed/);
  await assert.rejects(h.handlers.workbenchRun(r.token), /already used|expired/); assert.equal(h.launches.length, 0);
});
test('replacement connection at either runtime level rejects approval without touching either host', async () => {
  for (const replaceRuntime of [false, true]) {
    const h = harness(), d = deferred(); h.setConfirmation(() => d.promise);
    const r = h.handlers.workbenchReview('a', { code: 'printf synthetic' }); const pending = h.handlers.workbenchRun(r.token);
    const runtime = h.connections.get('a');
    if (replaceRuntime) h.connections.set('a', { ...runtime }); else runtime.remote = { ...runtime.remote };
    d.resolve({ response: 0 }); await assert.rejects(pending, /changed/); assert.equal(h.launches.length, 0);
  }
});
test('late destination loss reports uncertain task submission rather than falsely claiming nothing ran', async () => {
  const h = harness(), d = deferred(), r = h.connections.get('a');
  r.remote.createTask = async () => { h.launches.push({ id: 'a' }); return d.promise; };
  const review = h.handlers.workbenchReview('a', { code: 'printf synthetic' });
  const pending = h.handlers.workbenchRun(review.token); await tick(); assert.equal(h.launches.length, 1);
  r.remote.connected = false; d.resolve({ key: 'a/task' });
  await assert.rejects(pending, e => /may have started|may already/.test(e.message) && !/Nothing was run/.test(e.message));
  assert.equal(h.launches.length, 1);
});
test('cancelled and expired tickets can never be taken, including at the exact deadline', () => {
  let now = 0; const tickets = new ReviewTickets({ now: () => now }), owner = { validate() {} };
  const a = tickets.issue({ code: 'first' }, owner); tickets.cancel(a); assert.throws(() => tickets.take(a));
  const b = tickets.issue({ code: 'second' }, owner); now = 300000; assert.throws(() => tickets.take(b));
});
test('template editing cannot silently retain template metadata or its approval', async () => {
  const h = harness(); await h.handlers.workbenchDetect('a');
  assert.throws(() => h.handlers.workbenchReview('a', { actionId: 'system.disk', code: 'df -h; printf modified' }), /edited/);
  const r = h.handlers.workbenchReview('a', { code: 'df -h; printf modified' }); assert.equal(r.risk, 'custom');
});
test('fenced chat import preserves independent quoted/Unicode blocks and literal shell prompts', () => {
  assert.deepEqual(extractBlocks('text\r\n~~~~powershell\r\nPS C:\\> Write-Output "é 😀"\r\n~~~~\r\n```sh\n$ printf one\n```'), [
    { language: 'powershell', code: 'PS C:\\> Write-Output "é 😀"' }, { language: 'sh', code: '$ printf one' }]);
  assert.deepEqual(extractBlocks('````sh\nprintf one\n```\nprintf two\n````'), [{ language: 'sh', code: 'printf one\n```\nprintf two' }]);
});
test('chat import does not accept an unfinished trailing block or silently strip input controls', () => {
  assert.throws(() => extractBlocks('```sh\nprintf first\n```\n~~~sh\nprintf unfinished'), /incomplete/);
  const [b] = extractBlocks('```sh\nprintf \u202eunsafe\n```'); assert.throws(() => scriptText(b.code), /direction/);
});
test('cancel native confirmation starts no task and releases its bounded review slot', async () => {
  const h = harness(); h.setConfirmation(async () => ({ response: 1 }));
  for (let i = 0; i < 20; i++) assert.equal(await h.handlers.workbenchRun(h.handlers.workbenchReview('a', { code: 'printf fixture' }).token), null);
  assert.equal(h.launches.length, 0);
});
test('backend input locks are per-view, explicit and cleared only for a replacement owner', () => {
  const h = harness(); h.handlers.inputLock('a/pane', true);
  assert.throws(() => h.wb.assertInput('a/pane'), /locked/); assert.doesNotThrow(() => h.wb.assertInput('b/pane'));
  h.handlers.inputLock('a/pane', false); assert.doesNotThrow(() => h.wb.assertInput('a/pane'));
  h.handlers.inputLock('a/pane', true); h.connections.get('a').remote.views.set('a/pane', { active: true });
  assert.doesNotThrow(() => h.wb.assertInput('a/pane'));
  assert.throws(() => h.handlers.inputLock('b/pane', 'false'), /Invalid/);
});
test('locking persistent input discards queued paste tail and Enter, but cannot undo submitted bytes', async () => {
  const h = harness(), remote = new Remote({ id: 'a', name: 'A', host: 'a.example', username: 'tester', auth: 'password' });
  remote.connected = true;
  const pane = { key: 'a/pane', sessionId: '$1', sessionToken: 'fixture', paneId: '%1' }, view = { pane, active: true, initialized: true };
  remote.views.set(pane.key, view); remote.panes = [pane]; h.connections.get('a').remote = remote;
  const first = deferred(), sent = [];
  const control = { request: command => { sent.push(command); return sent.length === 1 ? first.promise : Promise.resolve(); } };
  remote.controls.set(pane.sessionId, control); remote.control = async () => control;
  const paste = remote.input(pane.key, 'x'.repeat(700)), enter = remote.input(pane.key, '\r'); paste.catch(() => {}); enter.catch(() => {});
  await tick(); assert.equal(sent.length, 1); h.handlers.inputLock(pane.key, true); first.resolve([]);
  await assert.rejects(paste, /discard|changed|disconnect/i); await assert.rejects(enter, /discard|changed|disconnect/i);
  assert.equal(sent.length, 1); assert.throws(() => h.wb.assertInput(pane.key), /locked/);
});
test('locking Standard input discards unsent messages on the actual ordered transport path', async () => {
  const h = harness(), r = new StandardRemote({ id: 'a', name: 'A', host: 'a.example', username: 'tester', auth: 'password' }); r.connected = true;
  const pane = { key: 'a/pane' }, view = { pane, active: true, initialized: true }, stream = new EventEmitter();
  const writes = []; let finish; stream.write = (bytes, done) => { writes.push(bytes); finish = done; };
  r.views.set(pane.key, view); r.shells.set(pane.key, { pane, stream, dead: false, channelClosed: false, serial: 0, pendingBytes: 0, pendingCount: 0, tail: Promise.resolve() }); h.connections.get('a').remote = r;
  const paste = r.input(pane.key, 'x'.repeat(33000)), enter = r.input(pane.key, '\r'); paste.catch(() => {}); enter.catch(() => {});
  await tick(); assert.equal(writes.length, 1); h.handlers.inputLock(pane.key, true); finish();
  await assert.rejects(paste, /discard|changed/i); await assert.rejects(enter, /discard|changed/i);
  assert.equal(writes.length, 1); assert.equal(writes[0].length, 32768);
});

test('expired but open native dialogs cannot bypass the concurrent review limit', async t => {
  let now = 0; t.mock.method(Date, 'now', () => now);
  const h = harness(), d = deferred(); h.setConfirmation(() => d.promise);
  const pending = Array.from({ length: 16 }, () => h.handlers.workbenchRun(h.handlers.workbenchReview('a', { code: 'printf synthetic' }).token));
  try { now = 300001; assert.throws(() => h.handlers.workbenchReview('a', { code: 'printf synthetic' }), /Too many/); }
  finally { d.resolve({ response: 1 }); await Promise.all(pending); }
  assert.doesNotThrow(() => h.handlers.workbenchReview('a', { code: 'printf synthetic' }));
});
test('revoked approvals cannot accumulate more than 16 still-open native confirmations', async () => {
  const h = harness(), d = deferred(); h.setConfirmation(() => d.promise);
  const pending = [];
  for (let i = 0; i < 16; i++) {
    const r = h.handlers.workbenchReview('a', { code: 'printf fixture' });
    pending.push(h.handlers.workbenchRun(r.token)); h.handlers.workbenchCancelReview(r.token);
  }
  const extra = h.handlers.workbenchRun(h.handlers.workbenchReview('a', { code: 'printf fixture' }).token);
  extra.catch(() => {}); d.resolve({ response: 1 }); await Promise.all(pending);
  await assert.rejects(extra, /confirmations/); assert.equal(h.dialogs.length, 16); assert.equal(h.launches.length, 0);
});
