'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Control } = require('../src/control.cjs');
const { Remote } = require('../src/remote.cjs');
const { parsePanes } = require('../src/core.cjs');
const { PlainText } = require('../src/storage.cjs');
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
  await assert.rejects(r.connect(), e => e.code === 'BETTERSSH_HOST_VERIFICATION' && /cancel/i.test(e.message));
  assert.equal(saved, 0); r.disconnect();
});
test('changed host identity keeps its non-retryable verification error', async () => {
  const r = new Remote(base, { secrets: { password: 'synthetic' }, knownHosts: '',
    pins: { 'server.example:22': 'SHA256:old-key-for-unit-test' }, clientFactory: () => new DeniedClient() });
  await assert.rejects(r.connect(), e => e.code === 'BETTERSSH_HOST_VERIFICATION' && /changed/i.test(e.message));
  r.disconnect();
});

function paneLine(cols, rows) { return `$0\tExample\t@1\t0\tShell\t%1\t0\t${cols}\t${rows}\t0\t${token}\t1\tbash\n`; }
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
