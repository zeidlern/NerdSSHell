'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { openSftp, SFTP_CHANNEL_LIMIT } = require('../src/transfer.cjs');
const { FileListings } = require('../src/file-listings.cjs');
const { listDirectory, download } = require('../src/sftp-browser.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(t) {
  const client = new EventEmitter(), callbacks = [];
  const remote = { client, sftp: () => new Promise((resolve, reject) => callbacks.push({ resolve, reject })) };
  t.after(() => client.emit('close'));
  return { client, remote, callbacks };
}
function channel() {
  const s = new EventEmitter(); s.ended = 0;
  s.end = () => { s.ended++; }; // A hostile peer can withhold channel CLOSE.
  return s;
}

test('cancelled listings retain a bounded reservation when channel-open never calls back', async t => {
  const h = fixture(t), registry = new FileListings(1);
  for (let i = 0; i < SFTP_CHANNEL_LIMIT; i++) {
    const task = registry.run({ key: 'host/view', browserId: 'browser', profileId: 'host', valid: () => true },
      signal => listDirectory(h.remote, '/', { signal, timeoutMs: 10000 }));
    await tick(); registry.cancel('host/view', 'browser'); await assert.rejects(task, /abort|cancel/i);
    assert.equal(registry.pending.size, 0, 'caller cancellation remains responsive');
  }
  await assert.rejects(openSftp(h.remote, undefined, 10000), /Too many outstanding/);
  assert.equal(h.callbacks.length, SFTP_CHANNEL_LIMIT);
  assert.equal(h.client.listenerCount('close'), 1, 'one listener per transport');
  h.client.emit('close'); assert.equal(h.client.listenerCount('close'), 0);
  const fresh = openSftp(h.remote, undefined, 10000); await tick();
  h.callbacks.at(-1).reject(new Error('synthetic rejection')); await assert.rejects(fresh, /synthetic rejection/);
  assert.equal(h.client.listenerCount('close'), 0);
});

test('timed-out opens stay bounded across transports until their transports close', async t => {
  const a = fixture(t), b = fixture(t);
  for (let i = 0; i < SFTP_CHANNEL_LIMIT; i++) await assert.rejects(openSftp(i % 2 ? a.remote : b.remote, undefined, 2), /timed out/);
  await assert.rejects(openSftp(a.remote, undefined, 10000), /Too many outstanding/);
  assert.equal(a.callbacks.length + b.callbacks.length, SFTP_CHANNEL_LIMIT);
  a.client.emit('close'); b.client.emit('close');
  assert.equal(a.client.listenerCount('close'), 0); assert.equal(b.client.listenerCount('close'), 0);
});

test('late open success is ended and remains reserved until channel CLOSE', async t => {
  const h = fixture(t), channels = [];
  for (let i = 0; i < SFTP_CHANNEL_LIMIT; i++) {
    const controller = new AbortController(), task = openSftp(h.remote, controller.signal, 10000);
    await tick(); controller.abort(); await assert.rejects(task);
    const s = channel(); channels.push(s); h.callbacks[i].resolve(s); await tick();
    assert.equal(s.ended, 1); s.emit('error', new Error('late channel error'));
  }
  await assert.rejects(openSftp(h.remote, undefined, 10000), /Too many outstanding/);
  channels[0].emit('close');
  const fresh = openSftp(h.remote, undefined, 10000); await tick(); const s = channel(); h.callbacks.at(-1).resolve(s);
  assert.equal(await fresh, s); s.end();
  await assert.rejects(openSftp(h.remote, undefined, 10000), /Too many outstanding/);
  s.emit('close'); for (const old of channels) old.emit('close');
  assert.equal(h.client.listenerCount('close'), 0);
});

test('transport closure rejects pending callers and late channels never become usable', async t => {
  const h = fixture(t), pending = openSftp(h.remote, undefined, 10000); await tick(); h.client.emit('close');
  await assert.rejects(pending, /transport closed/);
  const s = channel(); h.callbacks[0].resolve(s); await tick(); assert.equal(s.ended, 1);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(openSftp(h.remote, controller.signal, 10000)); assert.equal(h.callbacks.length, 1);
  const immediate = new AbortController(), aborted = openSftp(h.remote, immediate.signal, 10000);
  immediate.abort(); await assert.rejects(aborted); await tick(); assert.equal(h.callbacks.length, 1);
  assert.equal(h.client.listenerCount('close'), 0);
});

test('download rejects a persistent final symlink replacement after opening even with matching metadata', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'betterssh-sftp-resource-'));
  t.after(async () => {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const attrs = { size: 5, mtime: 100, isFile: () => true, isSymbolicLink: () => false };
  let opened = false, reads = 0, closes = 0;
  const s = Object.assign(new EventEmitter(), {
    end() {}, realpath: (p, cb) => cb(null, p),
    lstat: (_p, cb) => cb(null, opened ? { ...attrs, isFile: () => false, isSymbolicLink: () => true } : attrs),
    open: (_p, _flags, cb) => { opened = true; cb(null, Buffer.from('handle')); },
    fstat: (_h, cb) => cb(null, attrs),
    createReadStream: () => { reads++; return Readable.from(['other']); },
    close: (_h, cb) => { closes++; cb(null); }
  });
  await assert.rejects(download({ sftp: async () => s }, '/selected/file', path.join(directory, 'download.txt')), /symbolic link/);
  assert.equal(reads, 0); assert.equal(closes, 1); assert.deepEqual(await fs.readdir(directory), []);
});
