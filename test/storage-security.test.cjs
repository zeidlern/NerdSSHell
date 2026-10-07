'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Archive, publishExport } = require('../src/storage.cjs');
const { Control } = require('../src/control.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nerdsshell-archive-security-'));
  const archive = new Archive(root, 'synthetic', 16, 128);
  t.after(async () => { try { await archive.close(); } catch {} fs.rmSync(root, { recursive: true, force: true }); });
  return archive;
}

test('archive rejects a single excessive output chunk before decoding or queueing it', t => {
  const archive = fixture(t); archive.chunkBudgetBytes = 128;
  archive.append('synthetic-pane', Buffer.alloc(129, 65));
  assert.match(archive.error.message, /memory budget/);
  assert.equal(archive.pending.length, 0);
  assert.equal(archive.queuedBytes, 0);
});

test('history search scans bounded recent segments and export remains separate', async t => {
  const archive = fixture(t); const key = 'synthetic-pane';
  archive.append(key, Buffer.from('OLD_MARKER\n')); await archive.flush();
  archive.current = null; archive.currentBytes = 0;
  archive.append(key, Buffer.from('NEW_MARKER\n')); await archive.flush();
  const files = await archive.files(); assert.equal(files.length, 2);
  archive.searchBudgetBytes = fs.statSync(path.join(archive.dir, files[1])).size;
  assert.deepEqual((await archive.search(key, 'MARKER')).map(row => row.text), ['NEW_MARKER']);
});

test('a second history search is rejected while the first is reading files', async t => {
  const archive = fixture(t); const key = 'synthetic-pane';
  archive.append(key, Buffer.from('marker\n')); await archive.flush();
  const original = archive.files.bind(archive);
  let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  let paused = false;
  archive.files = async () => {
    if (!paused) { paused = true; entered(); await new Promise(resolve => { release = resolve; }); }
    return original();
  };
  const first = archive.search(key, 'marker'); await waiting;
  await assert.rejects(archive.search(key, 'marker'), /already running/);
  release(); assert.equal((await first)[0].text, 'marker');
});

test('queued session commands have a count and aggregate byte budget', async () => {
  class Stream extends EventEmitter { write() { return true; } destroy() {} }
  const control = new Control(new Stream());
  control.feed(Buffer.from('%begin 1 1 0\n%end 1 1 0\n'));
  const active = control.request('display-message'); active.catch(() => {});
  const queued = Array.from({ length: 256 }, () => control.request('display-message'));
  queued.forEach(job => job.catch(() => {}));
  await assert.rejects(control.request('display-message'), /queue is full/);
  assert.ok(control.queuedBytes < 2 * 1024 * 1024);
  control.detach(); await Promise.allSettled([active, ...queued]);
  assert.equal(control.queuedBytes, 0);

  const second = new Control(new Stream());
  second.feed(Buffer.from('%begin 1 1 0\n%end 1 1 0\n'));
  await assert.rejects(second.request('x'.repeat(2 * 1024 * 1024)), /queue is full/);
  second.detach();
});

test('fragmented protocol input accumulates bounded line pieces without repeated full copies', async () => {
  class Stream extends EventEmitter { write() { return true; } destroy() {} }
  const control = new Control(new Stream(), { maxBuffer: 4096 });
  control.feed(Buffer.from('%begin 1 1 0\n%end 1 1 0\n'));
  const data = 'x'.repeat(3000);
  for (const character of data) control.feed(Buffer.from(character));
  assert.equal(control.fragmentBytes, data.length);
  assert.ok(control.fragments.length <= 3);
  assert.ok(control.pendingFragments.length < 1024);
  control.feed(Buffer.from('\n'));
  assert.equal(control.fragmentBytes, 0);
  assert.equal(control.fragments.length, 0);
  assert.equal(control.pendingFragments.length, 0);
  control.detach();
});

test('export publication never overwrites a file created after the Save dialog', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nerdsshell-export-security-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'pending.tmp'), destination = path.join(dir, 'chosen.txt');
  fs.writeFileSync(source, 'new export');
  fs.writeFileSync(destination, 'other process wrote this');
  assert.throws(() => publishExport(source, destination), /No file was overwritten/);
  assert.equal(fs.readFileSync(destination, 'utf8'), 'other process wrote this');
  fs.unlinkSync(destination);
  publishExport(source, destination);
  assert.equal(fs.readFileSync(destination, 'utf8'), 'new export');
});
