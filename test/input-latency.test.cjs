'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Remote } = require('../src/remote.cjs');
const { Control } = require('../src/control.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));

// Execute the production Remote and Control with a deterministic delayed reply
// transport. This models RTT, not an EC2 host, SSH congestion or Windows rendering.
function fixture(t, { rtt = 150, failures = [], noisy = false } = {}) {
  let now = 0, number = 0;
  const timers = [], commands = [], echoes = [], output = [];
  class Stream extends EventEmitter {
    write(line) {
      const match = /^send-keys -H -t '(%\d+)' ([0-9a-f ]+)\n$/.exec(line);
      const id = ++number, bytes = match ? Buffer.from(match[2].replace(/ /g, ''), 'hex') : Buffer.alloc(0);
      commands.push({ at: now, line, bytes, pane: match?.[1] });
      timers.push({ due: now + rtt, fn: () => {
        if (this.destroyed) return;
        const failed = failures.includes(id);
        if (noisy) this.emit('data', Buffer.from(`%extended-output %2 0 : ${'z'.repeat(32768)}\n`));
        this.emit('data', Buffer.from(`%begin 1 ${id} 1\n${failed ? 'synthetic failure\n' : ''}%${failed ? 'error' : 'end'} 1 ${id} 1\n`));
        if (match && !failed) {
          echoes.push({ at: now, bytes });
          const escaped = [...bytes].map(b => b < 32 || b === 92 ? '\\' + b.toString(8).padStart(3, '0') : String.fromCharCode(b)).join('');
          this.emit('data', Buffer.from(`%output ${match[1]} ${escaped}\n`, 'latin1'));
        }
      } });
      return true;
    }
    destroy() { this.destroyed = true; timers.length = 0; }
  }
  const stream = new Stream(), control = new Control(stream);
  control.feed(Buffer.from('%begin 0 0 0\n%end 0 0 0\n'));
  control.on('output', (pane, bytes) => output.push({ pane, bytes }));
  const remote = new Remote({ id: 'latency', host: 'fixture.example', username: 'fixture', auth: 'password' });
  const pane = { key: 'latency/pane', paneId: '%1', sessionId: '$0', sessionToken: 'fixture-token' };
  const view = { pane, active: true, initialized: true, snapshotSerial: 0 };
  remote.connected = true; remote.controls.set('$0', control); remote.control = async () => control;
  remote.panes = [pane]; remote.views.set(pane.key, view);
  t.after(() => remote.disconnect());
  async function advance(until) {
    await tick();
    for (;;) {
      timers.sort((a, b) => a.due - b.due);
      if (!timers.length || timers[0].due > until) break;
      const timer = timers.shift(); now = timer.due; timer.fn(); await tick();
    }
    now = until; await tick();
  }
  async function drain() {
    for (let i = 0; i < 1024; i++) {
      await tick();
      if (!timers.length) return;
      await advance(Math.min(...timers.map(timer => timer.due)));
    }
    throw new Error('Delayed transport did not drain within its fixture budget');
  }
  return { remote, pane, view, control, stream, commands, echoes, output, advance, drain,
    input: data => remote.input(pane.key, data), sent: () => Buffer.concat(commands.map(c => c.bytes)), now: () => now };
}

for (const rtt of [1, 75, 150, 300]) test(`sustained typing does not accumulate one round trip per key at ${rtt} ms RTT`, async t => {
  const f = fixture(t, { rtt }), pending = [], text = 'abcdefgh'.repeat(10), interval = 10;
  for (let i = 0; i < text.length; i++) { await f.advance(i * interval); pending.push(f.input(text[i])); }
  await f.drain(); await Promise.all(pending);
  const lastKey = (text.length - 1) * interval, lastEcho = f.echoes.at(-1).at;
  t.diagnostic(JSON.stringify({ simulatedRttMs: rtt, keys: text.length, lastKeyMs: lastKey, lastEchoMs: lastEcho, requests: f.commands.length }));
  assert.equal(f.sent().toString(), text);
  assert.equal(Buffer.concat(f.output.filter(e => e.pane === '%1').map(e => e.bytes)).toString(), text);
  assert.ok(lastEcho <= lastKey + 2 * rtt, `last echo ${lastEcho} ms; typing ended ${lastKey} ms`);
  assert.equal(f.view.inputMessages, 0); assert.equal(f.view.inputBytes, 0);
});

test('the first key is immediate and a waiting burst shares one acknowledged request', async t => {
  const f = fixture(t), first = f.input('a'); await tick();
  assert.equal(f.commands.length, 1); assert.equal(f.commands[0].at, 0);
  const pending = Array.from({ length: 120 }, () => f.input('x'));
  let finished = 0; for (const promise of pending) promise.then(() => finished++);
  await f.advance(150); await first;
  assert.equal(finished, 0, 'acceptance into a local batch is not delivery acknowledgement');
  assert.equal(f.commands.length, 2); assert.equal(f.commands[1].bytes.length, 120);
  await f.advance(300); await Promise.all(pending); assert.equal(finished, 120);
});

test('batching preserves Unicode bytes, 512-byte chunks and per-event accounting', async t => {
  const f = fixture(t), values = ['first', ...Array.from({ length: 180 }, () => 'é😀')];
  const done = Promise.all(values.map(value => f.input(value)));
  await f.drain(); await done;
  assert.deepEqual(f.sent(), Buffer.from(values.join('')));
  assert.ok(f.commands.length <= 4, 'small pending events should share bounded requests');
  assert.ok(f.commands.every(command => command.bytes.length <= 512));
  assert.equal(f.view.inputMessages, 0); assert.equal(f.view.inputBytes, 0);
});

test('Enter and control events remain separate acknowledgement barriers', async t => {
  const f = fixture(t), values = ['a', 'b', '\r', 'c', 'd', '\x03', 'e', 'f', '\n'];
  const done = Promise.all(values.map(value => f.input(value))); await f.drain(); await done;
  assert.equal(f.sent().toString(), values.join(''));
  for (const byte of [13, 3, 10]) {
    const command = f.commands.find(c => c.bytes.includes(byte));
    assert.deepEqual(command.bytes, Buffer.from([byte]), 'control events cannot join adjacent typing');
  }
});

test('a failed coalesced batch drops queued Enter and recovers only on fresh deliberate input', async t => {
  const f = fixture(t, { failures: [2] }), first = f.input('first'); await tick();
  const pending = Promise.allSettled([f.input('a'), f.input('b'), f.input('c'), f.input('\r')]);
  await f.drain(); await first;
  assert.ok((await pending).every(result => result.status === 'rejected'));
  assert.equal(f.sent().toString(), 'firstabc');
  const fresh = f.input('NEW'); await f.drain(); await fresh;
  assert.equal(f.sent().toString(), 'firstabcNEW');
  assert.equal(f.view.inputMessages, 0); assert.equal(f.view.inputBytes, 0);
});

test('the last chunk of a failed long paste never includes later typing or Enter', async t => {
  const f = fixture(t, { failures: [2] });
  const done = Promise.allSettled([f.input('p'.repeat(700)), f.input('a'), f.input('b'), f.input('\r')]);
  await f.drain(); assert.ok((await done).every(result => result.status === 'rejected'));
  assert.equal(f.commands.length, 2); assert.equal(f.sent().toString(), 'p'.repeat(700));
});

test('pending batches cannot cross snapshot generations even if the same view is ready again', async t => {
  const f = fixture(t), old = Promise.allSettled([f.input('a'), f.input('b')]);
  f.view.snapshotSerial++;
  const raced = assert.rejects(f.input('RACED'), /View changed/);
  await f.drain(); await raced;
  assert.ok((await old).every(result => result.status === 'rejected'));
  assert.equal(f.sent().length, 0);
  const fresh = f.input('NEW'); await f.drain(); await fresh;
  assert.equal(f.sent().toString(), 'NEW');
});

test('pending batched typing is not dispatched after closing its view', async t => {
  const f = fixture(t), pending = Promise.allSettled([f.input('a'), f.input('b'), f.input('\r')]);
  f.remote.closeView(f.pane.key); await f.drain();
  assert.ok((await pending).every(result => result.status === 'rejected'));
  assert.equal(f.commands.length, 0); assert.equal(f.view.inputMessages, 0); assert.equal(f.view.inputBytes, 0);
});

test('large asynchronous pane output does not corrupt batched input replies', async t => {
  const f = fixture(t, { noisy: true }), pending = [f.input('first')]; await tick();
  pending.push(...Array.from({ length: 100 }, () => f.input('x')));
  await f.drain(); await Promise.all(pending);
  assert.equal(f.commands.length, 2); assert.equal(f.sent().toString(), 'first' + 'x'.repeat(100));
  assert.equal(f.output.filter(e => e.pane === '%2').length, 2);
  assert.equal(Buffer.concat(f.output.filter(e => e.pane === '%1').map(e => e.bytes)).toString(), 'first' + 'x'.repeat(100));
});
