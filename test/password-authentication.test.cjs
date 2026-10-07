'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { Server, utils } = require('ssh2');
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
