'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { generateKeyPairSync } = require('node:crypto');
const { StandardRemote } = require('../src/standard-remote.cjs');
const { OutputBuffer } = require('../src/output-buffer.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const settings = { id: 'test', host: 'server.example', username: 'tester', auth: 'password' };

function display(t, remote, automatic = true) {
  const received = [], deliveries = [], timers = new Set(); let recoveries = 0;
  const pressure = key => {
    const state = buffer.states.get(key);
    remote.setOutputPaused(key, !!state && (state.inflight || state.bytes >= 262144 || state.overflow));
  };
  const ack = event => { buffer.ack(event.key, event.epoch, event.sequence); pressure(event.key); };
  const buffer = new OutputBuffer({
    emit(type, event) {
      if (type !== 'output') return;
      received.push(Buffer.from(event.data, 'base64')); deliveries.push(event); pressure(event.key);
      if (automatic) {
        const timer = setTimeout(() => { timers.delete(timer); ack(event); }, 5); timers.add(timer);
      }
    },
    recover() { recoveries++; throw new Error('Standard output must not request a snapshot.'); }
  });
  remote.on('output', (key, bytes) => { buffer.queue(key, bytes); pressure(key); });
  remote.on('ended', key => buffer.flush(key));
  t.after(() => { for (const timer of timers) clearTimeout(timer); for (const key of buffer.keys()) buffer.discard(key); });
  return { buffer, received, deliveries, ack, recoveries: () => recoveries };
}

for (const mixed of [false, true]) test(`real loopback Standard shell drains ${mixed ? 'stdout and stderr' : 'stderr only'} before ending`, { timeout: 10000 }, async t => {
  const { Server } = require('ssh2');
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs1' });
  const stdout = mixed ? Buffer.alloc(130000, 65) : Buffer.alloc(0), stderr = Buffer.alloc(104000, 66);
  let peer, executions = 0, shells = 0;
  const server = new Server({ hostKeys: [key] }, client => {
    peer = client; client.on('error', () => {});
    client.on('authentication', ctx => ctx.method === 'password' && ctx.password === 'synthetic-only' ? ctx.accept() : ctx.reject());
    client.on('ready', () => client.on('session', accept => {
      const session = accept(); session.on('pty', acceptPty => acceptPty());
      session.on('exec', (_accept, reject) => { executions++; reject(); });
      session.on('shell', acceptShell => {
        shells++; const stream = acceptShell(); stream.on('error', () => {});
        if (stdout.length) stream.write(stdout);
        stream.stderr.write(stderr); stream.exit(1); stream.end();
      });
    }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const remote = new StandardRemote({ ...settings, host: '127.0.0.1', port: server.address().port },
    { secrets: { password: 'synthetic-only' }, knownHosts: '', trust: async () => true });
  t.after(() => { remote.disconnect(); peer?.end(); server.close(); });
  const output = display(t, remote), ended = deferred(); let endings = 0;
  remote.on('ended', () => { endings++; ended.resolve(); });
  await remote.connect(); const pane = await remote.create('Finite output'); await remote.open(pane.key);
  await ended.promise;
  const bytes = Buffer.concat(output.received);
  assert.equal(bytes.length, stdout.length + stderr.length);
  assert.equal([...bytes].filter(byte => byte === 65).length, stdout.length);
  assert.equal([...bytes].filter(byte => byte === 66).length, stderr.length);
  assert.equal(endings, 1); assert.equal(remote.activeShellCount(), 0);
  assert.equal(output.recoveries(), 0); assert.equal(executions, 0); assert.equal(shells, 1);
  await assert.rejects(remote.open(pane.key), /ended/);
});

class Channel extends EventEmitter {
  constructor() { super(); this.stderr = new PassThrough(); this.writes = []; }
  pause() { this.paused = true; }
  resume() { this.paused = false; }
  close() { if (!this.closed) { this.closed = true; this.emit('close'); } }
  write(bytes) { this.writes.push(Buffer.from(bytes)); return false; }
  setWindow() { throw new Error('Closed channels must not be resized.'); }
}
async function fixture(t, automatic = true, RemoteClass = StandardRemote) {
  const remote = new RemoteClass(settings), channel = new Channel(); remote.connected = true;
  remote.client = new EventEmitter(); remote.client.end = () => {};
  remote.client.shell = (_options, callback) => callback(null, channel);
  t.after(() => { remote.disconnect(); channel.stderr.destroy(); });
  const output = display(t, remote, automatic), pane = await remote.create('Tail'); await remote.open(pane.key);
  return { remote, channel, pane, output };
}

test('channel close rejects pending input while paused stderr drains through acknowledgements', async t => {
  const { remote, channel, pane, output } = await fixture(t), ended = deferred();
  remote.on('ended', () => ended.resolve());
  const input = Promise.allSettled([remote.input(pane.key, 'x'.repeat(50000)), remote.input(pane.key, '\r')]);
  await tick(); channel.stderr.write(Buffer.alloc(40000, 66)); await tick();
  channel.stderr.end(Buffer.alloc(64000, 66)); channel.close();
  assert.equal(remote.activeShellCount(), 1, 'the draining record remains available to output acknowledgements');
  await assert.rejects(remote.input(pane.key, 'late'), /Input was not sent/);
  await remote.resize(pane.key, 80, 24);
  assert.ok((await input).every(result => result.status === 'rejected'));
  assert.equal(Buffer.concat(channel.writes).includes(13), false);
  await ended.promise;
  assert.equal(Buffer.concat(output.received).length, 104000); assert.equal(remote.activeShellCount(), 0);
  assert.equal(output.recoveries(), 0);
});

test('explicit disconnect during a paused tail ends once and stale acknowledgements cannot revive it', async t => {
  const { remote, channel, pane, output } = await fixture(t, false); let endings = 0;
  remote.on('ended', () => endings++);
  channel.stderr.write(Buffer.alloc(40000, 66)); await tick();
  channel.stderr.end(Buffer.alloc(64000, 66)); channel.close();
  assert.equal(remote.activeShellCount(), 1); assert.ok(output.deliveries.length);
  remote.disconnect(); const received = Buffer.concat(output.received).length;
  for (const event of [...output.deliveries]) output.ack(event);
  await tick();
  assert.equal(endings, 1); assert.equal(remote.activeShellCount(), 0); assert.equal(remote.views.size, 0);
  assert.equal(Buffer.concat(output.received).length, received); assert.equal(output.recoveries(), 0);
  await assert.rejects(remote.open(pane.key), /ended/);
});

function inputClock() {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const { createRequire } = require('node:module'), timers = new Set(), module = { exports: {} };
  const filename = path.resolve(__dirname, '../src/standard-remote.cjs');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: createRequire(filename), module, Buffer,
    setTimeout(callback, delay) { assert.equal(delay, 20000); const timer = { callback }; timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); }
  }, { filename });
  return { RemoteClass: module.exports.StandardRemote,
    expire() { assert.equal(timers.size, 1); const timer = [...timers][0]; timers.delete(timer); timer.callback(); }, timers };
}

test('write timeout preserves shell, rejects queued Enter and blocks input until the submitted chunk drains', async t => {
  const clock = inputClock(), { remote, channel, pane } = await fixture(t, true, clock.RemoteClass);
  const callbacks = []; channel.write = (bytes, callback) => { channel.writes.push(bytes); callbacks.push(callback); return false; };
  const record = remote.shells.get(pane.key);
  const results = Promise.allSettled([remote.input(pane.key, 'x'.repeat(1024 * 1024)), remote.input(pane.key, '\r')]);
  await tick(); assert.equal(channel.writes.length, 1); clock.expire();
  const rejected = await results;
  assert.ok(rejected.every(result => result.status === 'rejected'));
  assert.match(rejected[0].reason.message, /may still arrive.*shell remains open/);
  assert.equal(remote.connected, true); assert.equal(remote.activeShellCount(), 1); assert.equal(channel.closed, undefined);
  assert.equal(record.pendingBytes, 0); assert.equal(record.pendingCount, 0);
  assert.equal(channel.writes[0].length, 32768); assert.equal(channel.writes[0].buffer.byteLength, 32768);
  assert.equal(clock.timers.size, 0);
  for (let i = 0; i < 3; i++) await assert.rejects(remote.input(pane.key, 'fresh'), /still pending.*Input was not sent/);
  assert.equal(channel.writes.length, 1, 'fresh input does not build behind the uncertain write');
  callbacks[0](); assert.equal(record.pendingWrite, null);
  const deliberate = remote.input(pane.key, 'later deliberate input'); await tick();
  assert.equal(channel.writes.length, 2); callbacks[1](); await deliberate;
  assert.equal(Buffer.concat(channel.writes).toString(), 'x'.repeat(32768) + 'later deliberate input');
  assert.equal(remote.activeShellCount(), 1); assert.equal(clock.timers.size, 0);
});

for (const action of ['close', 'disconnect']) test(`${action} invalidates a timed-out write and its late callback cannot revive input`, async t => {
  const clock = inputClock(), { remote, channel, pane } = await fixture(t, true, clock.RemoteClass);
  let callback, endings = 0; remote.on('ended', () => endings++);
  channel.write = (bytes, done) => { channel.writes.push(bytes); callback = done; return false; };
  const results = Promise.allSettled([remote.input(pane.key, 'paste'.repeat(20000)), remote.input(pane.key, '\r')]);
  await tick(); clock.expire(); await results;
  if (action === 'close') remote.closeView(pane.key); else remote.disconnect();
  callback(); await tick();
  assert.equal(endings, 1); assert.equal(channel.closed, true); assert.equal(remote.activeShellCount(), 0);
  await assert.rejects(remote.input(pane.key, 'late'), /Input was not sent/);
  assert.equal(channel.writes.length, 1); assert.equal(clock.timers.size, 0);
});

test('disconnect immediately rejects an outstanding write without waiting for a channel close reply', async t => {
  const clock = inputClock(), { remote, channel, pane } = await fixture(t, true, clock.RemoteClass);
  channel.close = () => { channel.closed = true; };
  const results = Promise.allSettled([remote.input(pane.key, 'paste'), remote.input(pane.key, '\r')]);
  await tick(); remote.disconnect();
  assert.ok((await results).every(result => result.status === 'rejected'));
  assert.equal(clock.timers.size, 0); assert.equal(channel.writes.length, 1);
});
