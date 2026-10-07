'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { Remote } = require('../src/remote.cjs');
const { Control } = require('../src/control.cjs');
const { OutputBuffer } = require('../src/output-buffer.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
class Stream extends EventEmitter {
  constructor() { super(); this.commands = []; this.number = 0; }
  write(command) { this.commands.push(command.trim()); return true; }
  reply(failed = false) {
    const n = ++this.number;
    this.emit('data', Buffer.from(`%begin ${n} ${n} 1\n${failed ? 'synthetic failure\n' : ''}%${failed ? 'error' : 'end'} ${n} ${n} 1\n`));
  }
  destroy() { this.destroyed = true; }
}
function fixture(t) {
  const stream = new Stream(), c = new Control(stream);
  c.feed(Buffer.from('%begin 0 0 0\n%end 0 0 0\n'));
  const remote = new Remote({ id: 'test', host: 'server.example', username: 'tester', auth: 'password' });
  remote.connected = true; remote.controls.set('$0', c); remote.control = async () => c;
  const pane = { key: 'test/pane', paneId: '%1', sessionId: '$0', sessionToken: 'test-token' };
  const view = { pane, active: true, initialized: true, snapshotSerial: 0 };
  remote.panes = [pane]; remote.views.set(pane.key, view);
  t.after(() => remote.disconnect());
  return { remote, stream, c, pane, view };
}
function sent(stream, pid = '%1') {
  return Buffer.concat(stream.commands.filter(command => command.startsWith(`send-keys -H -t '${pid}' `))
    .map(command => Buffer.from(command.split("' ")[1].replace(/ /g, ''), 'hex')));
}
async function drain(c, stream, attempts = 30) {
  for (let i = 0; i < attempts; i++) { await tick(); if (c.active) stream.reply(); }
}

test('whole paste completes before a concurrently submitted Enter', async t => {
  const { remote, stream, c, pane } = fixture(t);
  const first = remote.input(pane.key, 'x'.repeat(700)); await tick();
  const second = remote.input(pane.key, '\r'); const done = Promise.all([first, second]);
  await drain(c, stream); await done;
  assert.equal(sent(stream).toString(), 'x'.repeat(700) + '\r');
});

test('concurrent multiline Unicode pastes and Enter preserve complete-event byte order', async t => {
  const { remote, stream, c, pane } = fixture(t);
  const values = ['😀'.repeat(200) + '\nEND-A', 'é'.repeat(400) + '\nEND-B', '\r'];
  const done = Promise.all(values.map(value => remote.input(pane.key, value)));
  await drain(c, stream); await done;
  assert.deepEqual(sent(stream), Buffer.from(values.join('')));
});

test('ordinary Ctrl+C remains ordinary terminal input', async t => {
  const { remote, stream, c, pane } = fixture(t);
  const done = remote.input(pane.key, '\x03'); await drain(c, stream); await done;
  assert.deepEqual(sent(stream), Buffer.from([3]));
});

test('a slow pane does not impose its full-message queue on another pane', async t => {
  const { remote, stream, c, pane } = fixture(t);
  const other = { ...pane, key: 'test/other', paneId: '%2' };
  remote.views.set(other.key, { pane: other, active: true, initialized: true });
  const first = remote.input(pane.key, 'a'.repeat(700)); await tick();
  const second = remote.input(other.key, 'b'); const done = Promise.all([first, second]);
  await drain(c, stream); await done;
  assert.equal(sent(stream).toString(), 'a'.repeat(700));
  assert.equal(sent(stream, '%2').toString(), 'b');
  assert.ok(stream.commands[1].includes("'%2'"));
});

test('closing a view discards the rest of its paste and its queued Enter, not a sibling pane', async t => {
  const { remote, stream, c, pane, view } = fixture(t);
  const other = { ...pane, key: 'test/other', paneId: '%2' };
  remote.views.set(other.key, { pane: other, active: true, initialized: true });
  const done = Promise.allSettled([remote.input(pane.key, 'x'.repeat(700)), remote.input(pane.key, '\r')]);
  await tick(); remote.closeView(pane.key);
  await drain(c, stream); assert.ok((await done).every(r => r.status === 'rejected'));
  assert.equal(sent(stream).length, 512); assert.equal(c.closed, false);
  const sibling = remote.input(other.key, 'ok'); await drain(c, stream); await sibling;
  assert.equal(sent(stream, '%2').toString(), 'ok');
  assert.equal(view.inputBytes, 0); assert.equal(view.inputMessages, 0);
});

test('a close cancels input already waiting inside the shared control-command queue', async t => {
  const { remote, stream, c, pane } = fixture(t);
  const other = { ...pane, key: 'test/other', paneId: '%2' };
  remote.views.set(other.key, { pane: other, active: true, initialized: true });
  const blocker = c.request('display-message -p busy');
  const input = remote.input(pane.key, 'NEVER_SENT'); const checked = assert.rejects(input, /View changed/);
  await tick(); remote.closeView(pane.key); stream.reply(); await blocker;
  await drain(c, stream); await checked;
  assert.equal(sent(stream).length, 0); assert.equal(c.closed, false);
});

test('replacement views never inherit old queued input', async t => {
  const { remote, stream, c, pane } = fixture(t);
  const done = Promise.allSettled([remote.input(pane.key, 'x'.repeat(700)), remote.input(pane.key, '\r')]);
  await tick();
  remote.views.set(pane.key, { pane, active: true, initialized: true, snapshotSerial: 0 });
  const fresh = remote.input(pane.key, 'NEW'); await drain(c, stream); await fresh;
  assert.ok((await done).every(r => r.status === 'rejected'));
  assert.equal(sent(stream).toString(), 'x'.repeat(512) + 'NEW');
});

test('disconnect rejects queued input without replaying it', async t => {
  const { remote, stream, pane, view } = fixture(t);
  const done = Promise.allSettled([remote.input(pane.key, 'x'.repeat(700)), remote.input(pane.key, '\r')]);
  await tick(); remote.disconnect();
  assert.ok((await done).every(r => r.status === 'rejected'));
  assert.equal(sent(stream).length, 512); assert.equal(view.inputBytes, 0);
  await assert.rejects(remote.input(pane.key, 'later'), /Not connected/);
});

test('a new snapshot generation invalidates an old paste even when readiness returns', async t => {
  const { remote, stream, c, pane, view } = fixture(t);
  const done = Promise.allSettled([remote.input(pane.key, 'x'.repeat(700)), remote.input(pane.key, '\r')]);
  await tick(); view.snapshotSerial++;
  await drain(c, stream); assert.ok((await done).every(r => r.status === 'rejected'));
  assert.equal(sent(stream).length, 512);
});

test('a failed paste discards its queued Enter but allows later deliberate input', async t => {
  const { remote, stream, c, pane } = fixture(t);
  const done = Promise.allSettled([remote.input(pane.key, 'x'.repeat(700)), remote.input(pane.key, '\r')]);
  await tick(); stream.reply(true); await tick();
  assert.ok((await done).every(r => r.status === 'rejected'));
  const fresh = remote.input(pane.key, 'NEW'); await drain(c, stream); await fresh;
  assert.equal(sent(stream).toString(), 'x'.repeat(512) + 'NEW');
});

test('pending input has a per-view message-count budget including the active message', async t => {
  const { remote, pane, view } = fixture(t);
  const done = Promise.allSettled(Array.from({ length: 256 }, () => remote.input(pane.key, 'x')));
  await assert.rejects(remote.input(pane.key, '\r'), /queue is full/);
  remote.disconnect(); await done;
  assert.equal(view.inputMessages, 0); assert.equal(view.inputBytes, 0);
});

test('pending input has a per-view byte budget including active message data', async t => {
  const { remote, pane, view } = fixture(t);
  const done = Promise.allSettled([remote.input(pane.key, 'x'.repeat(1024 * 1024)), remote.input(pane.key, 'y'.repeat(1024 * 1024))]);
  await assert.rejects(remote.input(pane.key, '\r'), /queue is full/);
  remote.disconnect(); await done;
  assert.equal(view.inputBytes, 0); assert.equal(view.inputMessages, 0);
});

test('invalid send guards fail before transport write', async t => {
  const { c, stream } = fixture(t);
  await assert.rejects(c.request('send-keys', undefined, true), /Invalid send guard/);
  assert.equal(stream.commands.length, 0);
});

test('a rejected dispatch guard does not strand the next valid control command', async t => {
  const { c, stream } = fixture(t);
  const rejected = assert.rejects(c.request('never', undefined, () => false), /View changed/);
  const valid = c.request('ok'); stream.reply(); await valid; await rejected;
  assert.deepEqual(stream.commands, ['ok']); assert.equal(c.queuedBytes, 0);
});

function outputFixture(t, options = {}) {
  const events = [], calls = []; let output;
  output = new OutputBuffer({ emit: (type, data) => events.push({ type, ...data }), recover: async key => { calls.push(key); output.discard(key); }, ...options });
  t.after(() => { for (const key of output.keys()) output.discard(key); });
  return { output, events, calls };
}

test('first output exceeding 4 MiB starts recovery without an acknowledgement and resumes afterward', async t => {
  const { output, calls, events } = outputFixture(t);
  output.queue('pane', Buffer.alloc(4 * 1024 * 1024 + 1, 65)); await tick();
  assert.deepEqual(calls, ['pane']); assert.equal(events[0].type, 'recovering');
  output.queue('pane', Buffer.from('LIVE')); output.flush('pane');
  assert.equal(Buffer.from(events.at(-1).data, 'base64').toString(), 'LIVE');
});

test('accumulated pre-flush overflow also recovers without an acknowledgement', async t => {
  const { output, calls } = outputFixture(t, { maxBytes: 16, flushDelay: 10000 });
  output.queue('pane', Buffer.alloc(10)); output.queue('pane', Buffer.alloc(7)); await tick();
  assert.deepEqual(calls, ['pane']);
});

test('overflow with output in flight waits for the matching ack and recovers once', async t => {
  const { output, calls, events } = outputFixture(t, { maxBytes: 16 });
  output.queue('pane', Buffer.from('old')); output.flush('pane'); const old = events[0];
  output.queue('pane', Buffer.alloc(17)); output.queue('pane', Buffer.alloc(17));
  output.ack('pane', 'wrong-epoch', old.sequence); output.ack('pane', old.epoch, 999); await tick();
  assert.equal(calls.length, 0);
  output.ack('pane', old.epoch, old.sequence); output.ack('pane', old.epoch, old.sequence); await tick();
  assert.deepEqual(calls, ['pane']); assert.equal(events.filter(e => e.type === 'recovering').length, 1);
});

test('an old ack cannot acknowledge a new output generation', async t => {
  const { output, events } = outputFixture(t);
  output.queue('pane', Buffer.from('old')); output.flush('pane'); const old = events.at(-1);
  output.discard('pane'); output.queue('pane', Buffer.from('new')); output.flush('pane'); const fresh = events.at(-1);
  output.queue('pane', Buffer.from('pending')); const count = events.length;
  output.ack('pane', old.epoch, old.sequence); assert.equal(events.length, count);
  output.ack('pane', fresh.epoch, fresh.sequence); assert.equal(events.length, count + 1);
});

test('failed recovery stays visibly stale, consumes further output, and does not retry in a loop', async t => {
  let attempts = 0;
  const { output, events } = outputFixture(t, { maxBytes: 16, recover: async () => { attempts++; throw new Error('synthetic failure'); } });
  output.queue('pane', Buffer.alloc(17)); await tick();
  output.queue('pane', Buffer.alloc(17)); output.flush('pane'); await tick();
  assert.equal(attempts, 1); assert.ok(events.some(e => e.type === 'recovery-failed'));
  assert.ok(events.some(e => e.type === 'notice' && /Reopen/.test(e.message)));
  output.discard('pane'); output.queue('pane', Buffer.from('retry')); output.flush('pane');
  assert.equal(events.at(-1).type, 'output');
});

test('a no-op snapshot is reported as failed recovery rather than success', async t => {
  const { output, events } = outputFixture(t, { maxBytes: 16, recover: async () => {} });
  output.queue('pane', Buffer.alloc(17)); await tick();
  assert.ok(events.some(e => e.type === 'recovery-failed'));
});

test('closing before the deferred recovery prevents a stale snapshot request', async t => {
  const { output, calls } = outputFixture(t, { maxBytes: 16 });
  output.queue('pane', Buffer.alloc(17)); output.discard('pane'); await tick();
  assert.equal(calls.length, 0);
});

test('a late failed recovery cannot mark a replacement view stale', async t => {
  const wait = deferred();
  const { output, events } = outputFixture(t, { maxBytes: 16, recover: () => wait.promise });
  output.queue('pane', Buffer.alloc(17)); await tick();
  output.discard('pane'); output.queue('pane', Buffer.from('new')); output.flush('pane'); const count = events.length;
  wait.reject(new Error('old failure')); await tick();
  assert.equal(events.length, count);
});

// Execute the actual main-process wiring without starting Electron or touching a server.
function mainHarness(t) {
  const main = path.resolve(__dirname, '../src/main.cjs'), localRequire = createRequire(main);
  const events = [], handlers = new Map();
  const electron = { app: { requestSingleInstanceLock: () => false, quit() {} },
    dialog: {},
    protocol: { registerSchemesAsPrivileged() {} }, ipcMain: { handle: (name, handler) => handlers.set(name, handler) } };
  const context = vm.createContext({ require: name => name === 'electron' ? electron : localRequire(name),
    __dirname: path.dirname(main), Buffer, process, setTimeout, clearTimeout, console, events });
  vm.runInContext(fs.readFileSync(main, 'utf8') + `
    window = { isDestroyed: () => false, webContents: { mainFrame: { url: uiURL }, send: (_channel, event) => events.push(event) } };
    let recoveries = 0;
    connections.set('test', { remote: { connected: true, pane: () => ({}), snapshot: async key => {
      recoveries++; discardOutput(key); emit('snapshot', { key, data: '' });
    } } });
    registerIPC();
    globalThis.harness = { queueOutput, recoveries: () => recoveries,
      clear: () => { for (const key of [...output.keys()]) discardOutput(key); } };
  `, context);
  t.after(() => context.harness.clear()); return { ...context.harness, events, handlers };
}

test('actual main-process output wiring requests and delivers a snapshot after initial overflow', async t => {
  const h = mainHarness(t);
  h.queueOutput('test/pane', Buffer.alloc(4 * 1024 * 1024 + 1, 65)); await tick();
  assert.equal(h.recoveries(), 1);
  assert.ok(h.events.some(event => event.type === 'recovering'));
  assert.ok(h.events.some(event => event.type === 'snapshot'));
});

test('renderer recovery events disable input and invalidate pending renders', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../ui/app.js'), 'utf8');
  const start = source.indexOf('api.onEvent(event => {'), end = source.indexOf("$('connectionForm').addEventListener", start);
  assert.ok(start >= 0 && end > start);
  let handler, renders = 0;
  const view = { ready: true, generation: 3, state: { textContent: 'Live' } };
  const context = vm.createContext({ window: {}, api: { onEvent: fn => { handler = fn; } }, views: new Map([['pane', view]]), renderTabs: () => { renders++; } });
  vm.runInContext(source.slice(start, end), context);
  handler({ type: 'recovering', key: 'pane' });
  assert.equal(view.ready, false); assert.equal(view.generation, 4); assert.match(view.state.textContent, /Refreshing/);
  handler({ type: 'recovery-failed', key: 'pane' });
  assert.equal(view.ready, false); assert.equal(view.generation, 5); assert.match(view.state.textContent, /reopen view/);
  assert.equal(renders, 2);
});
