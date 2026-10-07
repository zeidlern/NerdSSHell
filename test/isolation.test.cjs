'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Remote } = require('../src/remote.cjs');
const { paneKey, fingerprint } = require('../src/core.cjs');

const token = '11111111-2222-4333-8444-555555555555';
const replacementToken = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve };
}

class FakeStream extends EventEmitter {
  constructor(marker) {
    super(); this.marker = marker; this.commands = []; this.sequence = 0;
    setImmediate(() => this.respond('', 0));
  }
  respond(body = '', sequence = ++this.sequence) {
    const data = `%begin ${sequence} ${sequence} 0\n${body ? body + '\n' : ''}%end ${sequence} ${sequence} 0\n`;
    this.emit('data', Buffer.from(data));
  }
  write(command) {
    this.commands.push(command.trim());
    let body = '';
    if (command.startsWith('display-message')) body = '80|24|0|0|0|0|0|0|0|0|0|1';
    if (command.startsWith('capture-pane')) body = this.marker;
    queueMicrotask(() => this.respond(body)); return true;
  }
  destroy() { this.destroyed = true; this.emit('close'); }
  output(text) { this.emit('data', Buffer.from(`%output %1 ${text}\n`)); }
}
class FakeClient extends EventEmitter {
  constructor(key, marker) { super(); this.key = key; this.marker = marker; this.streams = []; }
  connect(options) {
    options.hostVerifier(this.key, accepted => {
      if (!accepted) { this.emit('error', new Error('Host denied')); return; }
      queueMicrotask(() => this.emit('ready'));
    });
  }
  exec(command, done) {
    assert.match(command, / -C attach-session /);
    const stream = new FakeStream(this.marker); this.streams.push(stream); done(null, stream);
  }
  end() { this.emit('close'); }
}
function endpoint(id, keyBytes, marker) {
  const key = Buffer.from(keyBytes), client = new FakeClient(key, marker);
  const remote = new Remote({ id, name: id, host: `${id}.example`, username: 'test', auth: 'password' }, {
    secrets: { password: 'synthetic-only' }, knownHosts: '',
    trust: async details => { assert.equal(details.fingerprint, fingerprint(key)); return true; },
    savePin: async () => {}, clientFactory: () => client
  });
  const pane = { profileId: id, key: paneKey(id, token, '%1'), sessionId: '$0', sessionToken: token,
    sessionName: marker, paneId: '%1', windowId: '@1', windowPanes: 1, dead: false };
  remote.ensureSupport = async () => {};
  remote.discover = async () => { remote.panes = [pane]; return [pane]; };
  remote.checked = async command => command.includes('show-options') ? token : '';
  return { remote, client, pane };
}

test('two verified synthetic endpoints keep overlapping remote IDs, output and input isolated through view switches', async t => {
  const a = endpoint('hostA', 'distinct-host-key-A', 'ALPHA_ONLY');
  const b = endpoint('hostB', 'distinct-host-key-B', 'BETA_ONLY');
  t.after(() => { a.remote.disconnect(); b.remote.disconnect(); });
  const snapshots = new Map(), outputs = new Map();
  for (const { remote } of [a, b]) {
    remote.on('snapshot', (key, value) => snapshots.set(key, Buffer.from(value.data, 'base64').toString()));
    remote.on('output', (key, bytes) => outputs.set(key, (outputs.get(key) || '') + bytes.toString()));
    await remote.connect();
  }
  assert.notEqual(fingerprint(a.client.key), fingerprint(b.client.key));
  assert.notEqual(a.pane.key, b.pane.key);
  await Promise.all([a.remote.open(a.pane.key), b.remote.open(b.pane.key)]);
  assert.match(snapshots.get(a.pane.key), /ALPHA_ONLY/);
  assert.match(snapshots.get(b.pane.key), /BETA_ONLY/);
  for (let i = 0; i < 6; i++) {
    a.client.streams.at(-1).output('ALPHA_' + i);
    b.client.streams.at(-1).output('BETA_' + i);
    await Promise.all([a.remote.resize(a.pane.key, 80 + i, 24), b.remote.resize(b.pane.key, 90 + i, 24)]);
  }
  assert.match(outputs.get(a.pane.key), /ALPHA_0.*ALPHA_5/);
  assert.doesNotMatch(outputs.get(a.pane.key), /BETA/);
  assert.match(outputs.get(b.pane.key), /BETA_0.*BETA_5/);
  assert.doesNotMatch(outputs.get(b.pane.key), /ALPHA/);
  await Promise.all([a.remote.input(a.pane.key, 'a'), b.remote.input(b.pane.key, 'b')]);
  assert.ok(a.client.streams.at(-1).commands.some(c => c.includes('send-keys') && c.endsWith('61')));
  assert.ok(b.client.streams.at(-1).commands.some(c => c.includes('send-keys') && c.endsWith('62')));
  a.remote.closeView(a.pane.key); b.remote.closeView(b.pane.key);
  assert.equal(a.remote.views.size, 0); assert.equal(b.remote.views.size, 0);
});

test('an old capture cannot replace a reopened view', async () => {
  const { remote, pane } = endpoint('hostA', 'key-A', 'ALPHA');
  remote.connected = true; remote.panes = [pane];
  const captures = [];
  const control = { closed: false, detach() {}, request(command, complete) {
    if (command.startsWith('display-message')) return Promise.resolve([Buffer.from('80|24|0|0|0|0|0|0|0|0|0|1')]);
    const job = deferred(); captures.push({ complete, job }); return job.promise;
  }};
  remote.controls.set(pane.sessionId, control); remote.control = async () => control;
  const snapshots = []; remote.on('snapshot', (_key, value) => snapshots.push(Buffer.from(value.data, 'base64').toString()));
  remote.views.set(pane.key, { pane, active: true, initialized: true, snapshotSerial: 0 });
  const old = remote.snapshot(pane.key); await tick(); assert.equal(captures.length, 1);
  remote.closeView(pane.key); remote.controls.set(pane.sessionId, control);
  remote.views.set(pane.key, { pane, active: true, initialized: false, snapshotSerial: 0 });
  const current = remote.snapshot(pane.key); await tick(); assert.equal(captures.length, 2);
  captures[1].complete([Buffer.from('NEW_VIEW')]); captures[1].job.resolve([]); await current;
  captures[0].complete([Buffer.from('OLD_VIEW')]); captures[0].job.resolve([]); await old;
  assert.deepEqual(snapshots, ['NEW_VIEW']);
  remote.disconnect();
});

test('overlapping snapshots of one view keep only the newest capture', async () => {
  const { remote, pane } = endpoint('hostA', 'key-A', 'ALPHA');
  remote.connected = true; remote.panes = [pane];
  const captures = [];
  const control = { detach() {}, request(command, complete) {
    if (command.startsWith('display-message')) return Promise.resolve([Buffer.from('80|24|0|0|0|0|0|0|0|0|0|1')]);
    const job = deferred(); captures.push({ complete, job }); return job.promise;
  }};
  remote.controls.set(pane.sessionId, control); remote.control = async () => control;
  remote.views.set(pane.key, { pane, active: true, initialized: true, snapshotSerial: 0 });
  const received = []; remote.on('snapshot', (_key, value) => received.push(Buffer.from(value.data, 'base64').toString()));
  const first = remote.snapshot(pane.key); await tick(); assert.equal(captures.length, 1);
  const second = remote.snapshot(pane.key); await tick(); assert.equal(captures.length, 2);
  captures[1].complete([Buffer.from('LATEST')]); captures[1].job.resolve([]); await second;
  captures[0].complete([Buffer.from('STALE')]); captures[0].job.resolve([]); await first;
  assert.deepEqual(received, ['LATEST']);
  remote.disconnect();
});

test('a replaced control channel cannot deliver output or detach its replacement', async t => {
  const { remote, client, pane } = endpoint('hostA', 'key-A', 'ALPHA');
  t.after(() => remote.disconnect());
  await remote.connect();
  const output = []; remote.on('output', (key, bytes) => output.push([key, bytes.toString()]));
  await remote.open(pane.key);
  const old = remote.controls.get(pane.sessionId);
  remote.closeView(pane.key);
  await remote.open(pane.key);
  const current = remote.controls.get(pane.sessionId);
  assert.notEqual(current, old); assert.equal(remote.views.get(pane.key).initialized, true);
  old.emit('output', '%1', Buffer.from('STALE_OUTPUT'));
  old.emit('closed'); old.emit('notification', '%sessions-changed');
  assert.deepEqual(output, []);
  assert.equal(remote.controls.get(pane.sessionId), current);
  assert.equal(remote.views.get(pane.key).initialized, true);
  client.streams.at(-1).output('CURRENT_OUTPUT');
  assert.deepEqual(output, [[pane.key, 'CURRENT_OUTPUT']]);
});

test('a closed view cannot send input after control attachment resolves', async () => {
  const { remote, pane } = endpoint('hostA', 'key-A', 'ALPHA');
  remote.connected = true; remote.panes = [pane];
  const wait = deferred(), commands = [];
  const control = { request: async command => { commands.push(command); }, detach() {} };
  remote.control = async () => wait.promise; remote.controls.set(pane.sessionId, control);
  remote.views.set(pane.key, { pane, active: true, initialized: true });
  const input = remote.input(pane.key, 'NEVER_SENT');
  remote.closeView(pane.key);
  remote.views.set(pane.key, { pane, active: true, initialized: true });
  remote.controls.set(pane.sessionId, control); wait.resolve(control);
  await assert.rejects(input, /View changed/);
  assert.deepEqual(commands, []);
  remote.disconnect();
});

test('a sign-in answer arriving after disconnect is neither used nor retained', async () => {
  const answer = deferred(), client = new FakeClient(Buffer.from('key'), 'MARKER');
  const remote = new Remote({ id: 'lateAuth', name: 'lateAuth', host: 'auth.example', username: 'test', auth: 'password' }, {
    ask: () => answer.promise, clientFactory: () => client, knownHosts: ''
  });
  const connecting = remote.connect();
  remote.disconnect(); answer.resolve('synthetic-late-password');
  await assert.rejects(connecting, /cancelled/i);
  assert.deepEqual(remote.secrets, {});
  assert.equal(client.streams.length, 0);
});

test('a trust answer arriving after disconnect cannot save a host pin', async () => {
  const answer = deferred(); let saved = 0;
  const remote = new Remote({ id: 'lateTrust', name: 'lateTrust', host: 'trust.example', username: 'test', auth: 'password' }, {
    knownHosts: '', trust: () => answer.promise, savePin: () => { saved++; }
  });
  const verification = remote.verifyHost(Buffer.from('synthetic-key'));
  remote.disconnect(); answer.resolve(true);
  assert.equal(await verification, false);
  assert.equal(saved, 0);
  assert.deepEqual(remote.pins, {});
});

test('a late SSH ready event cannot reconnect an explicitly disconnected Remote', async () => {
  class LateReadyClient extends EventEmitter {
    connect(options) { options.hostVerifier(Buffer.from('host-key'), accepted => { assert.equal(accepted, true); }); }
    end() {}
  }
  const client = new LateReadyClient();
  const remote = new Remote({ id: 'lateReady', name: 'lateReady', host: 'ready.example', username: 'test', auth: 'password' }, {
    secrets: { password: 'synthetic-only' }, knownHosts: '', trust: async () => true,
    clientFactory: () => client
  });
  const connecting = remote.connect(); await tick();
  remote.disconnect(); client.emit('ready');
  await assert.rejects(connecting, /cancelled/i);
  assert.equal(remote.connected, false);
  assert.equal(remote.client, null);
});

test('rename refuses a changed remote session identity', async () => {
  const { remote, pane } = endpoint('hostA', 'key-A', 'ALPHA');
  remote.panes = [pane]; let command;
  remote.checked = async value => { command = value; return 'BETTERSSH_IDENTITY_CHANGED'; };
  await assert.rejects(remote.rename(pane.key, 'New name'), /identity changed.*not renamed/i);
  assert.match(command, /if-shell -F/);
  assert.match(command, new RegExp(token));
  assert.doesNotMatch(command, /kill-session/);
});

test('reused tmux session ID never reuses the previous token control channel', async t => {
  const { remote, client, pane } = endpoint('hostA', 'key-A', 'ALPHA');
  t.after(() => remote.disconnect());
  await remote.connect(); await remote.open(pane.key);
  const old = remote.controls.get(pane.sessionId);
  const replacement = { ...pane, sessionToken: replacementToken, key: paneKey(pane.profileId, replacementToken, pane.paneId), sessionName: 'REPLACEMENT' };
  remote.panes = [replacement];
  remote.checked = async command => command.includes('show-options') ? replacementToken : '';
  const output = []; remote.on('output', (key, bytes) => output.push([key, bytes.toString()]));
  await remote.open(replacement.key);
  const current = remote.controls.get(pane.sessionId);
  assert.notEqual(current, old);
  assert.equal(current.sessionToken, replacementToken);
  assert.equal(old.closed, true);
  assert.equal(remote.views.get(replacement.key).initialized, true);
  old.emit('output', pane.paneId, Buffer.from('OLD_SESSION'));
  client.streams.at(-1).output('NEW_SESSION');
  assert.deepEqual(output, [[replacement.key, 'NEW_SESSION']]);
  await remote.input(replacement.key, 'n');
  assert.ok(client.streams.at(-1).commands.some(c => c.includes('send-keys') && c.endsWith('6e')));
});

test('an old in-flight attachment cannot claim a reused session ID', async t => {
  const { remote, client, pane } = endpoint('hostA', 'key-A', 'ALPHA');
  t.after(() => remote.disconnect());
  remote.connected = true; remote.client = client;
  const replacement = { ...pane, sessionToken: replacementToken, key: paneKey(pane.profileId, replacementToken, pane.paneId) };
  remote.views.set(pane.key, { pane, active: true, initialized: false });
  remote.views.set(replacement.key, { pane: replacement, active: true, initialized: false });
  const oldIdentity = deferred(); let reads = 0;
  remote.checked = command => command.includes('show-options')
    ? (++reads === 1 ? oldIdentity.promise : Promise.resolve(replacementToken)) : Promise.resolve('');
  const old = remote.control(pane);
  const newer = remote.control(replacement);
  oldIdentity.resolve(token);
  await assert.rejects(old, /changed while attaching/i);
  const current = await newer;
  assert.equal(remote.controls.get(pane.sessionId), current);
  assert.equal(current.sessionToken, replacementToken);
  assert.equal(client.streams.length, 1, 'only the replacement session was attached');
});

test('post-attach token mismatch closes the channel before exposing it', async t => {
  const { remote, client, pane } = endpoint('hostA', 'key-A', 'ALPHA');
  t.after(() => remote.disconnect());
  remote.connected = true; remote.client = client;
  remote.views.set(pane.key, { pane, active: true, initialized: false });
  let reads = 0;
  remote.checked = async command => command.includes('show-options') ? (++reads === 1 ? token : replacementToken) : '';
  await assert.rejects(remote.control(pane), /identity changed during attachment/i);
  assert.equal(client.streams.length, 1);
  assert.equal(remote.controls.has(pane.sessionId), false);
  assert.equal(client.streams[0].destroyed, true);
});

test('two opens for the same token share an unverified attachment without closing it', async t => {
  const { remote, client, pane } = endpoint('hostA', 'key-A', 'ALPHA');
  t.after(() => remote.disconnect());
  remote.connected = true; remote.client = client;
  remote.views.set(pane.key, { pane, active: true, initialized: false });
  const reachedPostcheck = deferred(), finishPostcheck = deferred(); let reads = 0;
  remote.checked = async command => {
    if (!command.includes('show-options')) return '';
    if (++reads === 1) return token;
    reachedPostcheck.resolve(); return finishPostcheck.promise;
  };
  const first = remote.control(pane);
  await reachedPostcheck.promise;
  const second = remote.control(pane);
  finishPostcheck.resolve(token);
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b);
  assert.equal(client.streams.length, 1);
  assert.equal(client.streams[0].destroyed, undefined);
});
