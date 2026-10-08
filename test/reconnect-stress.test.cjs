'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { performance } = require('node:perf_hooks');
const { createMain, loadRemote, settle } = require('./reconnect-harness.cjs');
const { diagnosticSnapshot } = require('../src/diagnostics.cjs');
const config = id => ({ id, name: 'Synthetic ' + id, host: id + '.invalid', username: 'fixture', auth: 'password', sessionMode: 'persistent' });
function injectedTransport() {
  class CommandChannel extends EventEmitter {
    constructor() { super(); this.stderr = new EventEmitter(); this.writes = 0; this.closed = 0; }
    end() { this.writes++; }
    close() { this.closed++; }
  }
  class AuthenticationClient extends EventEmitter {
    connect(options) { options.hostVerifier(Buffer.from('test-host-key'), accepted => { assert.equal(accepted, true); queueMicrotask(() => this.emit('ready')); }); }
    exec(_command, opened) { this.opened = opened; }
    end() { this.emit('close'); }
  }
  const client = new AuthenticationClient(), secrets = { password: 'fixture-password' };
  const Remote = loadRemote(), remote = new Remote(config('channel'), { clientFactory: () => client, secrets, knownHosts: '', trust: async () => true });
  remote.ensureSupport = async () => {}; remote.discover = async () => [];
  return { client, remote, secrets, channel: () => new CommandChannel() };
}
test('dropped login cancellation releases the serialized prompt and the connection attempt', async t => {
  const h = createMain({ profiles: [config('login')], behavior: peer => peer.prompt() }); t.after(h.cleanup);
  const connecting = h.connect('login'); await settle(); const retiredId = [...h.prompts.keys()][0];
  h.created[0].drop(); await connecting;
  assert.equal(h.prompts.size, 0); assert.equal(h.connections.get('login').busy, false);
  assert.ok(h.events.some(event => event.type === 'promptCancelled' && event.id === retiredId));
  assert.equal(h.deadlines.size, 1); assert.equal(h.fireRetry(), true); await settle();
  const replacementId = [...h.prompts.keys()][0]; assert.ok(replacementId); assert.notEqual(replacementId, retiredId);
  h.respond(retiredId, 'obsolete-answer'); assert.equal(h.prompts.size, 1);
  h.respond(replacementId, 'fixture-answer'); await settle();
  assert.equal(h.connections.get('login').state, 'connected'); assert.equal(h.deadlines.size, 0);
});
test('pending commands and temporary authentication listeners retire on every completion path', async t => {
  const fixture = injectedTransport(); t.after(() => fixture.remote.disconnect()); await fixture.remote.connect();
  assert.equal(fixture.client.listenerCount('ready'), 0); assert.equal(fixture.client.listenerCount('close'), 1);
  const channel = fixture.channel(), pending = fixture.remote.exec('fixture-probe'); fixture.client.opened(null, channel);
  channel.emit('data', Buffer.from('partial fixture response'));
  const rejected = assert.rejects(pending, /completion is unknown/); fixture.remote.disconnect(); await rejected;
  assert.equal(fixture.remote.pendingCommands.size, 0); assert.equal(channel.listenerCount('data'), 0); assert.equal(channel.stderr.listenerCount('data'), 0);
  assert.equal(channel.closed, 1); channel.emit('error', new Error('Late fixture channel error.'));
  assert.equal(fixture.secrets.password, 'fixture-password', 'caller-owned retry state is separate from retired provider state');
  const late = injectedTransport(); await late.remote.connect(); const task = late.remote.exec('fixture-probe', { input: 'never delivered' });
  const cancelled = assert.rejects(task, /completion is unknown/); late.remote.disconnect(); await cancelled;
  const lateChannel = late.channel(); late.client.opened(null, lateChannel); assert.equal(lateChannel.writes, 0); assert.equal(lateChannel.closed, 1);
  const success = injectedTransport(); await success.remote.connect(); const complete = success.remote.exec('fixture-probe'), completedChannel = success.channel(); success.client.opened(null, completedChannel);
  completedChannel.emit('data', Buffer.from('fixture result')); completedChannel.emit('close', 0);
  assert.equal((await complete).stdout, 'fixture result'); assert.equal(completedChannel.listenerCount('data'), 0); assert.equal(success.remote.pendingCommands.size, 0);
  success.client.exec = () => { throw Error('Fixture immediate error.'); }; await assert.rejects(success.remote.exec('fixture-probe'), /immediate error/);
  assert.equal(success.remote.pendingCommands.size, 0); success.remote.disconnect();
});
test('explicit cancellation settles sign-in even when the library never publishes ready or close', async () => {
  const client = new EventEmitter(); client.connect = () => {}; client.end = () => {};
  const Remote = loadRemote(), remote = new Remote(config('cancel'), { clientFactory: () => client, secrets: { password: 'fixture-password' } });
  const pending = remote.connect(); const rejection = assert.rejects(pending, /cancelled/);
  remote.disconnect(); await rejection;
  assert.equal(client.listenerCount('ready'), 0); assert.equal(remote.client, null); assert.equal(remote.pendingCommands.size, 0);
});
test('120 mixed lifecycle cycles leave no pending prompts, buffers or accidental Standard replacements', async t => {
  let behavior = 'success';
  const first = config('first'), second = config('second'), standard = { ...config('ordinary'), sessionMode: 'standard' };
  const h = createMain({ profiles: [first, second, standard], behavior: async peer => {
    if (behavior === 'prompt') await peer.prompt();
    if (behavior === 'auth-failure') { const error = new Error('Fixture authentication refused.'); error.level = 'client-authentication'; throw error; }
  } }); t.after(h.cleanup);
  await h.connect('second', { password: 'fixture-password' }); const sibling = h.created[0];
  const durations = []; const kinds = Array(6).fill(0);
  for (let cycle = 0; cycle < 120; cycle++) {
    const started = performance.now(), kind = cycle % 6; kinds[kind]++;
    behavior = kind >= 4 ? 'prompt' : kind === 3 ? 'auth-failure' : 'success';
    const id = kind === 2 ? 'ordinary' : 'first';
    if (kind === 3) await assert.rejects(h.connect(id), /authentication/);
    else if (kind >= 4) {
      const attempt = h.connect(id); await settle(); const promptId = [...h.prompts.keys()][0]; assert.ok(promptId);
      if (kind === 4) h.created.at(-1).drop(); else h.disconnect(id);
      await attempt; assert.equal(h.prompts.size, 0); assert.equal(h.connections.get(id).busy, false);
      h.respond(promptId, 'discarded answer');
    } else {
      await h.connect(id, { password: 'fixture-password' }); const peer = h.created.at(-1);
      for (let pane = 0; pane < 2; pane++) peer.views.set(id + '/pane' + pane, { active: true, initialized: true });
      h.output.queue(id + '/orphan-buffer', Buffer.from('fixture bytes'));
      if (kind === 0) h.disconnect(id); else peer.drop();
      assert.equal(peer.views.size, 0); assert.equal(h.output.states.size, 0);
      if (kind === 2) { assert.equal(h.connections.get(id).wanted, false); assert.equal(peer.launchCount, 1); assert.equal(h.fireRetry(), false); }
    }
    if (h.deadlines.size) { behavior = 'success'; assert.equal(h.deadlines.size, 1); assert.equal(h.fireRetry(), true); await settle(); h.disconnect(id); }
    assert.equal(sibling.connected, true); assert.equal(h.connections.get('second').remote, sibling);
    assert.equal(h.prompts.size, 0); assert.equal(h.deadlines.size, 0); assert.equal(h.connections.get(id).busy, false);
    assert.equal(h.created.filter(peer => peer.profile.sessionMode === 'persistent').reduce((sum, peer) => sum + peer.launchCount, 0), 0);
    durations.push(performance.now() - started);
  }
  const ordered = durations.toSorted((a, b) => a - b);
  t.diagnostic(JSON.stringify({ cycles: 120, kinds, connectionMs: { median: ordered[60], p95: ordered[114], max: ordered.at(-1) }, pendingPrompts: h.prompts.size, pendingBuffers: h.output.states.size, pendingTimers: h.deadlines.size, liveSyntheticProviders: h.created.filter(peer => peer.connected).length }));
});
test('a stale retry cannot reconnect a replaced runtime, and stale output cannot contaminate its sibling', async t => {
  const h = createMain({ profiles: [config('one'), config('two')] }); t.after(h.cleanup);
  await h.connect('one'); await h.connect('two'); const old = h.created[0]; old.drop();
  const runtime = h.connections.get('one'); h.connections.set('one', { ...runtime }); h.fireRetry(); await settle();
  assert.equal(h.created.length, 2); old.emit('output', 'two/pane', Buffer.from('wrong owner')); assert.equal(h.output.states.size, 0);
});
test('diagnostics expose bounded runtime and resource counts without expanding the secret allowlist', () => {
  const owner = { profile: { name: 'Fixture' }, remote: { pendingCommands: new Set([1, 2]), controls: new Map([[1, {}]]), shells: new Map(), views: new Map() } };
  Object.defineProperty(owner, 'secrets', { get() { throw Error('Diagnostics must not inspect secrets.'); } });
  const snapshot = diagnosticSnapshot(new Map([['probe', owner]]), [], { version: '1.0.3', platform: 'win32', architecture: 'x64', versions: { electron: '44.5.1', chrome: 'x'.repeat(100), node: '24.19.0', password: 'DO_NOT_READ' }, pendingPrompts: 3 });
  assert.equal(snapshot.runtime.electron, '44.5.1'); assert.equal(snapshot.runtime.chromium.length, 64); assert.equal(snapshot.pendingPrompts, 3);
  assert.equal(snapshot.connections[0].pendingCommands, 2); assert.equal(snapshot.connections[0].controlChannels, 1);
  assert.doesNotMatch(JSON.stringify(snapshot), /DO_NOT_READ/);
});

test('100 verified loopback reconnect cycles close sockets/channels and preserve independent terminal ownership', { timeout: 120000 }, async t => {
  const { exerciseLoopback } = require('./reconnect-loopback.cjs');
  const report = await exerciseLoopback({ Remote: require('../src/remote.cjs').Remote, StandardRemote: require('../src/standard-remote.cjs').StandardRemote });
  assert.equal(report.cycles, 100); assert.equal(report.resources.liveSockets, 0); assert.equal(report.resources.liveChannels, 0);
  assert.equal(report.resources.pendingImmediatelyAfterDisconnect, 0); assert.equal(report.resources.maxClosedCommandDataListeners, 0); assert.equal(report.forbiddenJobLaunches, 0);
  assert.equal(report.acceptedShells, 80); assert.equal(report.persistentControlAttachments, 20);
  t.diagnostic(JSON.stringify(report));
});

test('Mixed provider releases the closed child transport without letting a stale close affect its replacement', async () => {
  const { MixedRemote } = require('../src/mixed-remote.cjs');
  const remote = new MixedRemote(config('mixed'));
  const first = new EventEmitter(), second = new EventEmitter(); let finished = 0;
  remote.client = first; await remote.ensureSupport();
  remote.client = second; await remote.ensureSupport();
  remote.shells.set('fixture-shell', {}); remote.standard.finishShell = () => { finished++; remote.shells.clear(); };
  first.emit('close'); assert.equal(remote.standard.client, second); assert.equal(remote.standard.connected, true); assert.equal(finished, 0);
  const order = []; second.on('close', () => { order.push('connection'); assert.equal(remote.standard.client, null); });
  remote.standard.finishShell = () => { order.push('shell'); remote.shells.clear(); };
  second.emit('close'); assert.deepEqual(order, ['shell', 'connection']); assert.equal(remote.standard.connected, false); assert.equal(remote.standard.client, null);
});
