'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { Remote } = require('../src/remote.cjs');
const { shellQuote: q } = require('../src/core.cjs');

// The existing CI fixture owns the loopback server and key. Never use a real host.
test('real SSH: concurrent long paste and Enter preserve shell command boundaries', {
  skip: !process.env.NERDSSHELL_TEST_KEY, timeout: 90000
}, async t => {
  const host = process.env.NERDSSHELL_TEST_HOST || '127.0.0.1';
  assert.equal(host, '127.0.0.1', 'Only the disposable loopback fixture is permitted');
  const socket = `nerdsshell-ci-input-order-${process.pid}`, proof = `/tmp/${socket}-proof`;
  const port = Number(process.env.NERDSSHELL_TEST_PORT || 22222);
  const pub = fs.readFileSync(process.env.NERDSSHELL_TEST_HOST_KEY + '.pub', 'utf8').trim().split(/\s+/);
  const r = new Remote({ id: 'ci-input-order', name: 'CI input ordering', host, port,
    username: process.env.NERDSSHELL_TEST_USER || os.userInfo().username,
    auth: 'key', keyPath: process.env.NERDSSHELL_TEST_KEY, socket }, {
    knownHosts: `[${host}]:${port} ${pub[0]} ${pub[1]}\n`, pins: {},
    ask: async () => { throw new Error('The isolated test must not prompt or install software'); },
    trust: async () => { throw new Error('Unexpected untrusted test host'); }
  });
  t.after(async () => {
    try { if (r.connected) await r.exec(`${r.prefix} kill-server 2>/dev/null; rm -f ${q(proof)}`); }
    finally { r.disconnect(); }
  });
  await r.connect(); const pane = await r.create('Input ordering'); await r.open(pane.key);
  const a = 'a'.repeat(700), b = '😀'.repeat(180);
  await Promise.all([
    r.input(pane.key, `printf '%s' ${q(a)} > ${q(proof)}`), r.input(pane.key, '\r'),
    r.input(pane.key, `printf '%s' ${q(b)} >> ${q(proof)}`), r.input(pane.key, '\r')
  ]);
  let actual = '';
  for (let attempt = 0; attempt < 120; attempt++) {
    actual = await r.checked(`cat ${q(proof)} 2>/dev/null || true`);
    if (actual === a + b) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(actual, a + b, 'Both complete commands must execute once, in order, without injected line breaks');
  await r.endSession(pane.key);
});

// Delay only the control protocol's incoming bytes. The owned OpenSSH/tmux
// server and its actual commands are real; the added reply latency is synthetic.
test('real SSH: delayed tmux replies batch typing and editing without changing command or session identity', {
  skip: !process.env.NERDSSHELL_TEST_KEY, timeout: 90000
}, async t => {
  const host = process.env.NERDSSHELL_TEST_HOST || '127.0.0.1';
  assert.equal(host, '127.0.0.1', 'Only the disposable loopback fixture is permitted');
  const socket = `nerdsshell-ci-input-latency-${process.pid}`, proof = `/tmp/${socket}-proof`;
  const port = Number(process.env.NERDSSHELL_TEST_PORT || 22222);
  const pub = fs.readFileSync(process.env.NERDSSHELL_TEST_HOST_KEY + '.pub', 'utf8').trim().split(/\s+/);
  const r = new Remote({ id: 'ci-input-latency', name: 'CI input latency', host, port,
    username: process.env.NERDSSHELL_TEST_USER || os.userInfo().username,
    auth: 'key', keyPath: process.env.NERDSSHELL_TEST_KEY, socket }, {
    knownHosts: `[${host}]:${port} ${pub[0]} ${pub[1]}\n`, pins: {},
    ask: async () => { throw new Error('The isolated test must not prompt or install software'); },
    trust: async () => { throw new Error('Unexpected untrusted test host'); }
  });
  const timers = new Set();
  t.after(async () => {
    for (const timer of timers) clearTimeout(timer);
    try { if (r.connected) await r.exec(`${r.prefix} kill-server 2>/dev/null; rm -f ${q(proof)}`); }
    finally { r.disconnect(); }
  });
  await r.connect();
  const pane = await r.create('Input latency', 'exec env INPUTRC=/dev/null bash --noprofile --norc -i');
  await r.open(pane.key);
  const c = r.controls.get(pane.sessionId), feed = c.feed.bind(c), request = c.request.bind(c);
  let requests = 0;
  c.feed = chunk => {
    const bytes = Buffer.from(chunk);
    const timer = setTimeout(() => {
      timers.delete(timer);
      try { feed(bytes); } catch (error) { c.fail(error); }
    }, 150);
    timers.add(timer);
  };
  c.request = (command, ...args) => {
    if (command.startsWith('send-keys -H ')) requests++;
    return request(command, ...args);
  };
  const expected = 'BATCHED-é-😀', command = `printf '%s' ${q(expected)} > ${q(proof)}`;
  const keys = [...command], started = Date.now(), pending = [r.input(pane.key, keys[0])];
  await new Promise(resolve => setImmediate(resolve));
  // Append XY, move left, erase X, move right and erase Y. Only the original
  // complete command may execute after its separate acknowledged Enter.
  const editing = ['X', 'Y', '\x1b[D', '\x7f', '\x1b[C', '\b'];
  pending.push(...[...keys.slice(1), ...editing].map(key => r.input(pane.key, key)), r.input(pane.key, '\r'));
  await Promise.all(pending);
  t.diagnostic(JSON.stringify({ addedReplyLatencyMs: 150, inputEvents: keys.length + editing.length + 1, sendKeysRequests: requests, elapsedMs: Date.now() - started }));
  assert.equal(requests, 3, 'first key, one pending typing/editing batch, then a separately acknowledged Enter');
  let actual = '';
  for (let attempt = 0; attempt < 50; attempt++) {
    actual = await r.checked(`cat ${q(proof)} 2>/dev/null || true`);
    if (actual === expected) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(actual, expected, 'The real shell receives the exact Unicode command once');
  r.closeView(pane.key); await r.discover(); await r.open(pane.key);
  assert.equal(r.pane(pane.key).sessionToken, pane.sessionToken, 'reattachment preserves the same persistent session');
  await r.endSession(pane.key);
});
