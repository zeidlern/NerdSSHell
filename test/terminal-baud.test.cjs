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

const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { profile, terminalBaud, TERMINAL_BAUD_RATES } = require('../src/core.cjs');
const { StateStore } = require('../src/storage.cjs');
const { MixedRemote } = require('../src/mixed-remote.cjs');
const { installSessionActions } = require('../src/session-actions.cjs');
const base = { id: 'baud-profile', host: 'fixture.invalid', username: 'fixture', auth: 'agent' };

test('legacy profiles retain default terminal behavior and saved baud rates survive round trips', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nerdsshell-baud-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify({ version: 1, profiles: [base], pins: {} }));
  const legacy = new StateStore(directory); assert.equal(legacy.data.profiles[0].terminalBaud, 0);
  const saved = legacy.putProfile({ ...base, terminalBaud: '115200', password: 'synthetic-never-persisted' });
  assert.equal(saved.terminalBaud, 115200); assert.equal(new StateStore(directory).data.profiles[0].terminalBaud, 115200);
  assert.ok(!fs.readFileSync(path.join(directory, 'settings.json'), 'utf8').includes('synthetic-never-persisted'));
  legacy.putProfile({ ...base, terminalBaud: 0 }); assert.equal(new StateStore(directory).data.profiles[0].terminalBaud, 0);
});

test('terminal baud accepts only supported integer rates; zero means omission rather than hangup', () => {
  for (const rate of TERMINAL_BAUD_RATES) { assert.equal(terminalBaud(rate), rate); assert.equal(profile({ ...base, terminalBaud: String(rate) }).terminalBaud, rate); }
  for (const invalid of [null, true, false, {}, [], [9600], '', '0'.repeat(10000), ' 9600 ', '1e4', '9600; whoami', -1, 1.5, 1, NaN, Infinity, 2 ** 32, 921600]) {
    assert.throws(() => terminalBaud(invalid), /terminal baud/);
    assert.throws(() => profile({ ...base, terminalBaud: invalid }), /terminal baud/);
  }
});

test('saved and per-window rates reach both actual SSH wire fields without changing existing PTYs', { timeout: 10000 }, async t => {
  const h = await wireFixture(t, { terminalBaud: 9600 });
  const first = await h.remote.create('Connection setting'), second = await h.remote.create('Window override', undefined, 115200), normal = await h.remote.create('Server default', undefined, 0);
  assert.deepEqual(h.requests.map(r => r.modes), [{ 128: 9600, 129: 9600 }, { 128: 115200, 129: 115200 }, {}]);
  assert.deepEqual([first.terminalBaud, second.terminalBaud, normal.terminalBaud], [9600, 115200, 0]);
  assert.deepEqual(h.requests[2].bytes, Buffer.from([0]), 'Server default never sends speed 0/B0.');
  await h.remote.open(first.key); await h.remote.resize(first.key, 99, 30);
  assert.equal(h.requests.length, 3); assert.deepEqual(h.commands, []);
  await assert.rejects(h.remote.create('Bad rate', undefined, '9600; stty 0'), /terminal baud/);
  assert.equal(h.requests.length, 3); assert.equal(h.remote.activeShellCount(), 3, 'Invalid options allocate neither channels nor records.');
});

test('Standard task PTYs inherit the profile setting, and mixed Standard creation preserves an override', { timeout: 10000 }, async t => {
  const h = await wireFixture(t, { terminalBaud: 57600 });
  await h.remote.createTask('Task', 'printf synthetic-fixture');
  assert.deepEqual(h.requests[0].modes, { 128: 57600, 129: 57600 });
  assert.equal(h.commands.length, 1); assert.ok(!h.commands[0].includes('stty'));
  const mixed = new MixedRemote(base); mixed.standard = h.remote;
  await mixed.createSession('Mixed Standard', false, 19200);
  assert.deepEqual(h.requests[1].modes, { 128: 19200, 129: 19200 });
  await mixed.createTaskFor('Mixed task', 'printf synthetic-fixture', false);
  assert.deepEqual(h.requests[2].modes, { 128: 57600, 129: 57600 });
  let enabled = 0; mixed.enablePersistence = () => { enabled++; throw Error('Should not enable tmux.'); };
  await assert.rejects(mixed.createSession('Persistent', true, 9600), /only.*Standard/);
  assert.equal(enabled, 0); assert.equal(h.requests.length, 3);
});

test('create IPC rejects malformed, Persistent and local overrides before reserving or launching work', () => {
  const handlers = new Map(), created = [], reserved = [], remote = { profile: { local: false }, createSession: (...args) => created.push(args), create: (...args) => created.push(args) };
  installSessionActions({ handle: (name, handler) => handlers.set(name, handler), runtime: () => ({ remote }), withViewSlot: (...args) => { reserved.push(args); return args[2](); } });
  const create = handlers.get('create');
  create('fixture', 'Standard', false, 9600); assert.deepEqual(created, [['Standard', false, 9600]]); assert.equal(reserved.length, 1);
  for (const invalid of ['9600; sleep', null, true, [], 9601]) assert.throws(() => create('fixture', 'Invalid', false, invalid), /terminal baud/);
  assert.throws(() => create('fixture', 'Persistent', true, 9600), /only.*Standard/);
  remote.profile.local = true; assert.throws(() => create('fixture', 'Local', false, 9600), /only.*Standard/);
  assert.equal(created.length, 1); assert.equal(reserved.length, 1);
  create('fixture', 'Local'); assert.deepEqual(created[1], ['Local']);
});

function newWindowUI() {
  const source = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8'), nodes = new Map(), calls = [], panes = new Map();
  const $ = id => { if (!nodes.has(id)) nodes.set(id, { value: '', checked: false, hidden: false, disabled: false, options: [{ textContent: '' }], showModal() { this.open = true; }, close() { this.open = false; }, focus() {}, select() {} }); return nodes.get(id); };
  const context = vm.createContext({ $, profiles: new Map([['remote', { name: 'Remote', terminalBaud: 9600 }], ['local', { local: true }]]), panes, active: null, selectedProfile: '', connected: () => true,
    api: { create: async (...args) => { calls.push(args); return { key: 'created/' + calls.length }; } }, requireViewCapacity() {}, withViewCapacity: callback => callback(() => {}), openPane: async () => {}, message() {} });
  vm.runInContext(source.slice(source.indexOf('let newSessionResolve'), source.indexOf('async function performSessionAction')), context);
  return { $, context, calls };
}
test('new window UI allows independent Standard rates and omits hidden Persistent/local overrides', async () => {
  const h = newWindowUI();
  let pending = h.context.newSession('remote');
  assert.equal(h.$('newSessionBaud').disabled, true); assert.match(h.$('newSessionBaud').options[0].textContent, /9600/);
  h.$('newSessionPersistent').checked = false; h.context.updateNewSessionBaud();
  assert.equal(h.$('newSessionBaud').disabled, false); h.$('newSessionBaud').value = '115200'; h.context.finishNewSession(true); await pending;
  assert.deepEqual(h.calls[0], ['remote', h.calls[0][1], false, 115200]);
  pending = h.context.newSession('remote'); h.$('newSessionPersistent').checked = false; h.$('newSessionBaud').value = '0'; h.context.finishNewSession(true); await pending;
  assert.equal(h.calls[1][3], 0);
  pending = h.context.newSession('remote'); h.$('newSessionBaud').value = '115200'; h.context.finishNewSession(true); await pending;
  assert.equal(h.calls[2][3], undefined);
  pending = h.context.newSession('local'); assert.equal(h.$('newSessionBaudField').hidden, true);
  h.$('newSessionPersistent').checked = false; h.$('newSessionBaud').value = '115200'; h.context.finishNewSession(true); await pending;
  assert.equal(h.calls[3][3], undefined);
  pending = h.context.newSession('remote'); h.context.finishNewSession(false); await pending; assert.equal(h.calls.length, 4);
});

test('connection and window UI enumerate validated rates and describe scope and new-PTY guidance', () => {
  const html = fs.readFileSync(path.join(__dirname, '../ui/index.html'), 'utf8');
  for (const selector of ['name="terminalBaud"', 'id="newSessionBaud"']) {
    const select = html.slice(html.indexOf('<select '+selector), html.indexOf('</select>', html.indexOf('<select '+selector)));
    const choices = [...select.matchAll(/<option value="(\d+)"/g)].map(match => Number(match[1]));
    assert.deepEqual(choices, TERMINAL_BAUD_RATES);
  }
  assert.match(html, /does not change SSH bandwidth.*physical serial port/);
  assert.match(html, /Create a new Standard window or reconnect/);
  assert.match(html, /Persistent tmux panes manage their own terminal settings/);
});
