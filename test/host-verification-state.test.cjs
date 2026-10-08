'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { generateKeyPairSync } = require('node:crypto');
const { StandardRemote } = require('../src/standard-remote.cjs');
const turn = () => new Promise(resolve => setImmediate(resolve));
async function fixture(t, auth = 'password') {
  let approve, requested, options; const requests = [], pins = [];
  const decision = new Promise(resolve => { approve = resolve; }), pending = new Promise(resolve => { requested = resolve; });
  const originalAgent = process.env.SSH_AUTH_SOCK;
  if (auth === 'agent' && process.platform !== 'win32') { process.env.SSH_AUTH_SOCK = '/tmp/synthetic-agent-only'; t.after(() => { if (originalAgent === undefined) delete process.env.SSH_AUTH_SOCK; else process.env.SSH_AUTH_SOCK = originalAgent; }); }
  let keyPath;
  if (auth === 'key') {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nerdsshell-key-state-')); keyPath = path.join(directory, 'synthetic.pem');
    fs.writeFileSync(keyPath, generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  }
  class Client extends EventEmitter {
    connect(value) { options = value; this.answer = accepted => { this.accepted = accepted; }; assert.equal(options.hostVerifier(Buffer.from('synthetic-host-only'), this.answer), undefined); }
    end() { if (!this.closed) { this.closed = true; this.emit('close'); } }
  }
  const client = new Client();
  const remote = new StandardRemote({ id: 'state-fixture', host: 'synthetic.invalid', username: 'fixture', auth, keyPath }, {
    clientFactory: () => client, secrets: { password: 'synthetic-memory-only' }, knownHosts: '',
    trust: () => { requested(); return decision; }, savePin: (...values) => pins.push(values),
    ask: async value => { requests.push(value); return 'synthetic-response'; }
  });
  const connecting = remote.connect(); connecting.catch(() => {}); await pending;
  t.after(async () => { approve(false); remote.disconnect(); await turn(); });
  return { remote, client, connecting, requests, pins, options: () => options, approve };
}

test('library readiness before host approval cannot publish a connected Standard session', async t => {
  const h = await fixture(t); h.client.emit('ready');
  await assert.rejects(h.connecting, { code: 'NERDSSHELL_HOST_VERIFICATION' });
  assert.equal(h.remote.connected, false); assert.equal(h.remote.passwordAuthenticated, false); assert.deepEqual(h.pins, []);
});
for (const auth of ['password', 'key', 'agent']) test(auth + ' authentication selection is blocked until the captured host is verified', async t => {
  const h = await fixture(t, auth);
  assert.equal(h.options().authHandler([], false), false);
  await assert.rejects(h.connecting, { code: 'NERDSSHELL_HOST_VERIFICATION' });
  assert.equal(h.remote.connected, false); assert.deepEqual(h.pins, []);
});
for (const [auth, method] of [['password', 'password'], ['key', 'publickey'], ['agent', 'agent']]) test(auth + ' verified authentication preserves its supported method order', async t => {
  const h = await fixture(t, auth); h.approve(true); await turn();
  assert.equal(h.client.accepted, true);
  assert.equal(h.options().authHandler(null, null), 'none'); assert.equal(h.options().authHandler([method], false), method);
  h.client.emit('ready'); await h.connecting; assert.equal(h.remote.connected, true);
  assert.equal(h.remote.passwordAuthenticated, auth === 'password');
});
test('interactive challenges before approval cannot ask for another credential', async t => {
  const h = await fixture(t); let answers = 0;
  h.client.emit('keyboard-interactive', '', 'Synthetic instruction', '', [{ prompt: 'Synthetic challenge', echo: false }], () => answers++);
  await assert.rejects(h.connecting, { code: 'NERDSSHELL_HOST_VERIFICATION' });
  assert.equal(h.requests.length, 0); assert.equal(answers, 0); assert.deepEqual(h.pins, []);
});
test('interactive answer after transport close cannot invoke a retired library callback', async t => {
  const h = await fixture(t); h.approve(true); await turn(); h.client.emit('ready'); await h.connecting;
  let respond, submitted = 0; h.remote.ask = () => new Promise(resolve => { respond = resolve; });
  h.client.emit('keyboard-interactive', '', '', '', [{ prompt: 'Synthetic challenge', echo: false }], () => { submitted++; throw Error('Retired callback must not be called'); });
  await turn(); h.client.end(); respond('synthetic-late-response'); await turn();
  assert.equal(submitted, 0); assert.equal(h.remote.connected, false);
});
