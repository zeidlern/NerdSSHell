'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { Server, utils } = require('ssh2');
const { StandardRemote } = require('../src/standard-remote.cjs');

// Observe the decrypted received RFC 4254 packet without replacing encoder,
// decoder or transport. ssh2 1.17.0's public pty callback skips modes byte 0,
// so its parsed options alone cannot prove both speed fields reached the wire.
function ptyRequest(payload) {
  if (payload[0] !== 98) return null;
  let offset = 5;
  const string = () => {
    assert.ok(offset + 4 <= payload.length);
    const size = payload.readUInt32BE(offset); offset += 4;
    assert.ok(offset + size <= payload.length);
    const value = payload.subarray(offset, offset + size); offset += size; return value;
  };
  if (string().toString() !== 'pty-req') return null;
  offset++; const term = string().toString();
  const cols = payload.readUInt32BE(offset), rows = payload.readUInt32BE(offset + 4); offset += 16;
  const bytes = Buffer.from(string()), modes = {};
  for (let i = 0; i < bytes.length;) {
    const opcode = bytes[i++];
    if (opcode === 0) { assert.equal(i, bytes.length); break; }
    assert.ok(i + 4 <= bytes.length); modes[opcode] = bytes.readUInt32BE(i); i += 4;
  }
  return { term, cols, rows, bytes, modes };
}
async function wireFixture(t, settings = {}) {
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs1' });
  const publicKey = utils.parseKey(key).getPublicSSH(), peers = new Set(), requests = [], commands = [];
  const server = new Server({ hostKeys: [key] }, peer => {
    peers.add(peer); peer.on('error', () => {}); peer.on('close', () => peers.delete(peer));
    peer.on('authentication', context => context.method === 'password' && context.password === 'synthetic-fixture-only' ? context.accept() : context.reject(['password']));
    peer.on('ready', () => {
      const decipher = peer._protocol._decipher, received = decipher._onPayload;
      decipher._onPayload = payload => { const request = ptyRequest(payload); if (request) requests.push(request); return received(payload); };
    });
    peer.on('session', accept => {
      const session = accept(); session.on('pty', acceptPty => acceptPty());
      session.on('shell', acceptShell => { const channel = acceptShell(); channel.on('data', () => {}); });
      session.on('exec', (acceptExec, _reject, info) => { commands.push(info.command); const channel = acceptExec(); channel.on('data', () => {}); });
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const remote = new StandardRemote({ id: 'wire-fixture', host: '127.0.0.1', port: server.address().port, username: 'fixture', auth: 'password', ...settings }, {
    knownHosts: `[127.0.0.1]:${server.address().port} ssh-rsa ${publicKey.toString('base64')}\n`,
    ask: async () => 'synthetic-fixture-only', trust: async () => { throw new Error('Known fixture host must verify.'); }
  });
  t.after(async () => { remote.disconnect(); for (const peer of peers) peer.end(); await new Promise(resolve => server.close(resolve)); });
  await remote.connect();
  return { remote, requests, commands };
}

test('pinned ssh2 writes both RFC terminal baud opcodes to an actual verified SSH peer', { timeout: 10000 }, async t => {
  const h = await wireFixture(t);
  const channel = await new Promise((resolve, reject) => h.remote.client.shell({ term: 'xterm-256color', cols: 120, rows: 36,
    modes: { TTY_OP_ISPEED: 9600, TTY_OP_OSPEED: 9600 } }, (error, channel) => error ? reject(error) : resolve(channel)));
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.requests[0].modes, { 128: 9600, 129: 9600 });
  assert.deepEqual(h.requests[0].bytes, Buffer.from([128, 0, 0, 37, 128, 129, 0, 0, 37, 128, 0]));
  channel.close();
});

test('existing Standard SSH behavior leaves both terminal speed modes unspecified', { timeout: 10000 }, async t => {
  const h = await wireFixture(t);
  const pane = await h.remote.create('Server default');
  assert.equal(h.requests.length, 1); assert.deepEqual(h.requests[0].bytes, Buffer.from([0]));
  assert.deepEqual(h.requests[0].modes, {});
  await h.remote.open(pane.key); await h.remote.resize(pane.key, 100, 30);
  assert.equal(h.requests.length, 1, 'Reopening a view and resizing do not allocate or reconfigure the PTY.');
  assert.deepEqual(h.commands, [], 'Research neither injects stty nor launches extra commands in a shell.');
});
