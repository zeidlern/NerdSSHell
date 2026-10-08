'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { Server, Client, utils } = require('ssh2');
const { StandardRemote } = require('../src/standard-remote.cjs');
const { fingerprint } = require('../src/core.cjs');

async function authenticate(t, kind) {
  const hostKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs1' });
  const pin = fingerprint(utils.parseKey(hostKey).getPublicSSH()), peers = new Set(), methods = [], prompts = [];
  const server = new Server({ hostKeys: [hostKey] }, peer => {
    peers.add(peer); peer.on('error', () => {}); peer.on('close', () => peers.delete(peer));
    peer.on('authentication', context => {
      methods.push(context.method);
      if (kind === 'none' && context.method === 'none') return context.accept();
      if (context.method === 'password') {
        if (kind === 'direct') return context.password === 'synthetic-login-only' ? context.accept() : context.reject(['password']);
        return context.reject(['keyboard-interactive'], kind === 'partial');
      }
      if (context.method === 'keyboard-interactive') {
        return context.prompt([{ prompt: 'Synthetic challenge:', echo: false }], answers => {
          answers[0] === 'synthetic-interactive-only' ? context.accept() : context.reject();
        });
      }
      context.reject(['password', 'keyboard-interactive']);
    });
  });
  server.on('error', () => {}); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const remote = new StandardRemote({ id: 'authentication-fixture', host: '127.0.0.1', port: server.address().port, username: 'fixture', auth: 'password' }, {
    knownHosts: '', trust: async value => value.fingerprint === pin,
    ask: async options => { prompts.push(options); return options.credentialKind === 'ssh-password' ? 'synthetic-login-only' : 'synthetic-interactive-only'; }
  });
  t.after(async () => { remote.disconnect(); for (const peer of peers) peer.end(); await new Promise(resolve => server.close(resolve)); });
  await remote.connect(); return { remote, methods, prompts };
}

test('real verified SSH password authentication is eligible for remembering', { timeout: 10000 }, async t => {
  const h = await authenticate(t, 'direct'); assert.equal(h.remote.passwordAuthenticated, true);
  assert.equal(h.remote.passwordRejected, false); assert.equal(h.remote.passwordFactorAccepted, true);
  assert.deepEqual(h.methods, ['none', 'password']); assert.equal(h.prompts.length, 1); assert.equal(h.prompts[0].credentialKind, 'ssh-password');
});
test('rejected password followed by successful interactive sign-in is not remembered as a valid password', { timeout: 10000 }, async t => {
  const h = await authenticate(t, 'fallback'); assert.equal(h.remote.passwordAuthenticated, false);
  assert.equal(h.remote.passwordRejected, true); assert.equal(h.remote.passwordFactorAccepted, false);
  assert.deepEqual(h.methods, ['none', 'password', 'keyboard-interactive']); assert.equal(h.prompts.length, 2);
  assert.equal(h.prompts[1].credentialKind, undefined, 'Interactive answers have no login-password consent');
});
test('accepted password factor plus interactive second factor remembers only the password factor', { timeout: 10000 }, async t => {
  const h = await authenticate(t, 'partial'); assert.equal(h.remote.passwordAuthenticated, true);
  assert.equal(h.remote.passwordRejected, false); assert.equal(h.remote.passwordFactorAccepted, true);
  assert.deepEqual(h.methods, ['none', 'password', 'keyboard-interactive']); assert.equal(h.prompts[1].credentialKind, undefined);
});
test('server accepting the none method cannot validate an unused entered password for saving', { timeout: 10000 }, async t => {
  const h = await authenticate(t, 'none'); assert.equal(h.remote.passwordAuthenticated, false); assert.deepEqual(h.methods, ['none']);
});


async function hostVerificationFixture(t, condition) {
  const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs1' });
  const publicKey = utils.parseKey(privateKey).getPublicSSH(), expected = fingerprint(publicKey);
  const peers = new Set(), authenticationRequests = [], savedPins = [];
  const server = new Server({ hostKeys: [privateKey] }, peer => {
    peers.add(peer); peer.on('error', () => {}); peer.on('close', () => peers.delete(peer));
    peer.on('authentication', context => { authenticationRequests.push(context.method); context.method === 'password' ? context.accept() : context.reject(['password']); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port, endpoint = '127.0.0.1:' + port;
  const oldPublicKey = condition === 'known-hosts-changed' ? utils.parseKey(generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs1' })).getPublicSSH() : null;
  let answer, requested, verifierReturn, trustCalls = 0;
  const decision = new Promise(resolve => { answer = resolve; }), trustRequested = new Promise(resolve => { requested = resolve; });
  const client = new Client(), connect = client.connect.bind(client);
  const clientClosed = new Promise(resolve => client.once('close', resolve));
  client.connect = options => {
    const verify = options.hostVerifier;
    options.hostVerifier = (key, done) => { verifierReturn = verify(key, done); return verifierReturn; };
    return connect(options);
  };
  const remote = new StandardRemote({ id: 'host-key-boundary', host: '127.0.0.1', port, username: 'fixture', auth: 'password' }, {
    secrets: { password: 'synthetic-host-verification-password' }, clientFactory: () => client,
    knownHosts: condition === 'revoked' ? '@revoked [127.0.0.1]:' + port + ' ssh-rsa ' + publicKey.toString('base64') : oldPublicKey ? '[127.0.0.1]:' + port + ' ssh-rsa ' + oldPublicKey.toString('base64') : '',
    pins: condition === 'changed' ? { [endpoint]: 'SHA256:independently-pinned-different-key' } : {},
    trust: value => { trustCalls++; assert.equal(value.fingerprint, expected); requested(); return condition === 'trust-rejection' ? Promise.reject('synthetic non-Error rejection') : decision; },
    savePin: (target, value) => { if (condition === 'pin-save-error') throw Error('Synthetic fingerprint persistence failure'); savedPins.push([target, value]); }
  });
  t.after(async () => { answer(false); remote.disconnect(); for (const peer of peers) peer._sock?.destroy(); await new Promise(resolve => server.close(resolve)); });
  const connecting = remote.connect(); connecting.catch(() => {});
  return { peer: () => [...peers][0], remote, connecting, clientClosed, trustRequested, answer, authenticationRequests, savedPins, expected, endpoint, verifierReturn: () => verifierReturn, trustCalls: () => trustCalls };
}

for (const accept of [false, true]) test('real SSH waits for explicit asynchronous host approval before any authentication: ' + (accept ? 'approve' : 'decline'), { timeout: 10000 }, async t => {
  const h = await hostVerificationFixture(t, 'unknown'); await h.trustRequested;
  assert.equal(h.verifierReturn(), undefined, 'ssh2 asynchronous verifier must return undefined, never a truthy Promise');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.deepEqual(h.authenticationRequests, [], 'No SSH authentication may run while host approval is pending');
  assert.deepEqual(h.savedPins, []); assert.equal(h.remote.connected, false);
  h.answer(accept);
  if (accept) { await h.connecting; assert.deepEqual(h.authenticationRequests, ['none', 'password']); assert.deepEqual(h.savedPins, [[h.endpoint, h.expected]]); }
  else { await assert.rejects(h.connecting, { code: 'NERDSSHELL_HOST_VERIFICATION' }); assert.deepEqual(h.authenticationRequests, []); assert.deepEqual(h.savedPins, []); }
});

for (const condition of ['changed', 'known-hosts-changed', 'revoked']) test('real SSH rejects a ' + condition + ' host key before authentication without requesting approval', { timeout: 10000 }, async t => {
  const h = await hostVerificationFixture(t, condition);
  await assert.rejects(h.connecting, { code: 'NERDSSHELL_HOST_VERIFICATION' });
  assert.equal(h.verifierReturn(), undefined); assert.equal(h.trustCalls(), 0);
  assert.deepEqual(h.authenticationRequests, []); assert.deepEqual(h.savedPins, []); assert.equal(h.remote.connected, false);
});


for (const condition of ['trust-rejection', 'pin-save-error']) test('real SSH fails closed before authentication on ' + condition, { timeout: 10000 }, async t => {
  const h = await hostVerificationFixture(t, condition); await h.trustRequested; h.answer(true);
  await assert.rejects(h.connecting, error => error instanceof Error && error.code === 'NERDSSHELL_HOST_VERIFICATION');
  assert.equal(h.verifierReturn(), undefined); assert.deepEqual(h.authenticationRequests, []); assert.deepEqual(h.savedPins, []);
});

test('late approval after disconnect cannot authenticate or pin the disconnected host', { timeout: 10000 }, async t => {
  const h = await hostVerificationFixture(t, 'unknown'); await h.trustRequested;
  h.remote.disconnect(); h.answer(true); await assert.rejects(h.connecting);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.authenticationRequests, []); assert.deepEqual(h.savedPins, []); assert.equal(h.remote.connected, false);
});


test('late host approval after completed transport cleanup is harmless and cannot authenticate', { timeout: 10000 }, async t => {
  const h = await hostVerificationFixture(t, 'unknown'); await h.trustRequested;
  h.remote.disconnect(); await assert.rejects(h.connecting); await h.clientClosed;
  h.answer(true); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.authenticationRequests, []); assert.deepEqual(h.savedPins, []); assert.equal(h.remote.connected, false);
});


test('verified same-key server rekey preserves authentication and does not request another approval', { timeout: 10000 }, async t => {
  const h = await hostVerificationFixture(t, 'unknown'); await h.trustRequested; h.answer(true); await h.connecting;
  const before = [...h.authenticationRequests];
  await new Promise((resolve, reject) => h.peer().rekey(error => error ? reject(error) : resolve()));
  assert.equal(h.remote.connected, true); assert.equal(h.trustCalls(), 1);
  assert.deepEqual(h.authenticationRequests, before); assert.deepEqual(h.savedPins, [[h.endpoint, h.expected]]);
});
