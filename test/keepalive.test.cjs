'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { generateKeyPairSync } = require('node:crypto');
const { Server, Client, utils } = require('ssh2');
const { Remote } = require('../src/remote.cjs');
const { fingerprint } = require('../src/core.cjs');
const { closeSshTransport } = require('../src/ssh-transport.cjs');

test('graceful SSH teardown pins only the abandoned socket and cancels its deadline on normal close', async () => {
  const socket = new EventEmitter(), client = new EventEmitter(), sibling = new EventEmitter();
  socket.destroy = () => { socket.destroyed = true; socket.emit('close'); };
  sibling.destroy = () => { throw Error('Sibling socket must not close'); };
  client._sock = socket; client.end = () => {};
  client.destroy = () => { throw Error('Client.destroy is not valid after half-close'); };
  closeSshTransport(client, { graceMs: 15 }); client._sock = sibling;
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(socket.destroyed, true); assert.equal(client.listenerCount('close'), 0);
  const cooperative = new EventEmitter(), cooperativeSocket = new EventEmitter(); let forced = 0;
  cooperative._sock = cooperativeSocket; cooperativeSocket.destroy = () => { forced++; };
  cooperative.end = () => cooperative.emit('close');
  closeSshTransport(cooperative, { graceMs: 15 }); await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(forced, 0); assert.equal(cooperativeSocket.listenerCount('close'), 0);
});

test('real hostile loopback SSH half-close is forcibly cleaned after grace despite Client.destroy becoming a no-op', { timeout: 10000 }, async t => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  let peer, sessions = 0;
  const server = new Server({ hostKeys: [privateKey] }, incoming => {
    peer = incoming; incoming.on('error', () => {});
    incoming.on('authentication', context => context.method === 'password' && context.username === 'test' && context.password === 'synthetic' ? context.accept() : context.reject());
    incoming.on('session', (_accept, reject) => { sessions++; reject(); });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const client = new Client(); client.on('error', () => {});
  t.after(async () => { client._sock?.destroy(); peer?._sock.destroy(); await new Promise(resolve => server.close(resolve)); });
  await new Promise((resolve, reject) => { client.once('error', reject); client.once('ready', resolve); client.connect({ host: '127.0.0.1', port: server.address().port,
    username: 'test', password: 'synthetic', hostVerifier: key => fingerprint(key) === fingerprint(utils.parseKey(privateKey).getPublicSSH()),
    keepaliveInterval: 50, keepaliveCountMax: 3 }); });
  // Pause only this owned fixture peer so it ignores DISCONNECT and FIN while
  // retaining its side. No server/session/system configuration is changed.
  peer._sock.pause(); const socket = client._sock;
  client.end(); client.destroy();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(socket.destroyed, false, 'the pinned library public destroy is a no-op once end makes the socket nonwritable');
  const closed = new Promise(resolve => client.once('close', resolve));
  closeSshTransport(client, { graceMs: 50 }); await closed;
  assert.equal(socket.destroyed, true); assert.equal(sessions, 0, 'teardown never launches or sends commands to remote jobs');
});

function withoutServerCommands(remote) {
  remote.ensureSupport = async () => {};
  remote.discover = async () => [];
  return remote;
}
test('every SSH connection enables 15-second keepalives with a bounded unanswered-probe limit', async t => {
  class CapturedClient extends EventEmitter {
    connect(options) { this.options = options; options.hostVerifier(Buffer.from('synthetic-host'), accepted => { assert.equal(accepted, true); queueMicrotask(() => this.emit('ready')); }); }
    end() { this.emit('close'); }
  }
  const client = new CapturedClient();
  const remote = withoutServerCommands(new Remote({ host: 'example.invalid', username: 'test', auth: 'password' }, {
    clientFactory: () => client, secrets: { password: 'synthetic' }, knownHosts: '', pins: { 'example.invalid:22': fingerprint(Buffer.from('synthetic-host')) }
  }));
  t.after(() => remote.disconnect()); await remote.connect();
  assert.equal(client.options.keepaliveInterval, 15000); assert.equal(client.options.keepaliveCountMax, 3);
});

test('real loopback SSH stays idle through answered keepalives and detects a non-responsive peer without shell input', { timeout: 10000 }, async t => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  let probes = 0, replies = 0, sessions = 0, peer;
  const server = new Server({ hostKeys: [privateKey], debug: line => { if (line.includes('Inbound: GLOBAL_REQUEST (keepalive@openssh.com)')) probes++; } }, client => {
    peer = client; client.on('error', () => {});
    client.on('authentication', context => context.method === 'password' && context.username === 'test' && context.password === 'synthetic' ? context.accept() : context.reject());
    client.on('session', (_accept, reject) => { sessions++; reject(); });
  });
  t.after(async () => { peer?._sock.destroy(); await new Promise(resolve => server.close(resolve)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port, client = new Client(), connect = client.connect.bind(client);
  client.connect = options => {
    assert.equal(options.keepaliveInterval, 15000); assert.equal(options.keepaliveCountMax, 3);
    // Compress time only inside the injected test client; production settings remain unchanged.
    return connect({ ...options, keepaliveInterval: 50, debug: line => { if (line.includes('Inbound: Received REQUEST_FAILURE')) replies++; } });
  };
  const remote = withoutServerCommands(new Remote({ host: '127.0.0.1', port, username: 'test', auth: 'password' }, {
    clientFactory: () => client, secrets: { password: 'synthetic' }, knownHosts: '', pins: { [`127.0.0.1:${port}`]: fingerprint(utils.parseKey(privateKey).getPublicSSH()) }
  }));
  t.after(() => remote.disconnect()); await remote.connect();
  for (let i = 0; replies < 6 && i < 400; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(probes >= 6); assert.ok(replies >= 6); assert.equal(remote.connected, true); assert.equal(sessions, 0);
  const lost = new Promise(resolve => remote.once('disconnected', resolve));
  // Blackhole just this disposable peer's transport; no server configuration changes.
  peer._sock.pause(); const error = await lost;
  assert.match(error.message, /Keepalive timeout/); assert.equal(error.level, 'client-timeout');
  assert.equal(remote.connected, false); assert.equal(sessions, 0);
});
