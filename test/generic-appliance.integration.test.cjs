'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { Server, Client, utils } = require('ssh2');
const { MixedRemote } = require('../src/mixed-remote.cjs');
const { fingerprint } = require('../src/core.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (predicate()) return; await delay(5); }
  throw Error('Disposable appliance fixture deadline: ' + label);
}
async function appliance(t) {
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs1' });
  const hostKey = utils.parseKey(key).getPublicSSH(), peers = new Set(), channels = new Set();
  const metrics = { execRequests: 0, subsystemRequests: 0, automaticInputBytes: 0, acceptedShells: 0, acceptedPtys: 0, authChallenges: 0 };
  let scenario = 'normal', explicitInput = false, currentPeer;
  const server = new Server({ hostKeys: [key] }, peer => {
    const ownScenario = scenario; currentPeer = peer; peers.add(peer); peer._sock.setNoDelay(true);
    peer.on('error', () => {}); peer.on('close', () => peers.delete(peer));
    peer.on('authentication', request => {
      if (ownScenario === 'passwordFailure') { request.reject(['password']); return; }
      if (['interactive', 'cancelInteractive'].includes(ownScenario)) {
        if (request.method !== 'keyboard-interactive') { request.reject(['keyboard-interactive']); return; }
        metrics.authChallenges++;
        request.prompt([{ prompt: 'Synthetic fixture code: ', echo: false }], answers => {
          if (ownScenario === 'interactive' && answers[0] === 'fixture-code') request.accept(); else request.reject(['keyboard-interactive']);
        });
        return;
      }
      if (request.method === 'password' && request.password === 'fixture-password') request.accept(); else request.reject(['password']);
    });
    peer.on('ready', () => peer.on('session', acceptSession => {
      const session = acceptSession();
      session.on('pty', (acceptPty, _reject, info) => { assert.equal(info.term, 'xterm-256color'); metrics.acceptedPtys++; acceptPty(); });
      session.on('window-change', acceptWindow => acceptWindow?.());
      session.on('exec', (_accept, reject) => { metrics.execRequests++; reject(); });
      session.on('subsystem', (_accept, reject) => { metrics.subsystemRequests++; reject(); });
      session.on('shell', (acceptShell, reject) => {
        if (ownScenario === 'shellFailure') { reject(); return; }
        const stream = acceptShell(); metrics.acceptedShells++; channels.add(stream);
        stream.on('error', () => {}); stream.on('close', () => channels.delete(stream)); peer.once('close', () => channels.delete(stream));
        stream.write('SYNTHETIC_ROUTER_READY> ');
        stream.on('data', bytes => { if (!explicitInput) metrics.automaticInputBytes += bytes.length; stream.write(bytes); });
        stream.on('end', () => stream.end());
      });
    }));
  });
  server.on('error', () => {});
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port, target = '127.0.0.1:' + port;
  const knownHosts = `[127.0.0.1]:${port} ssh-rsa ${hostKey.toString('base64')}\n`;
  t.after(async () => { for (const peer of peers) peer._sock.destroy(); await new Promise(resolve => server.close(resolve)); });
  return { metrics, peers, channels, target, hostKey, knownHosts, port, scenario(value) { scenario = value; explicitInput = false; },
    allowInput() { explicitInput = true; }, drop() { currentPeer._sock.destroy(); } };
}
function remoteFor(h, options = {}) {
  let client, closed = false, prompts = 0, trustPrompts = 0;
  const remote = new MixedRemote({ id: 'appliance', name: 'Disposable network device', host: '127.0.0.1', port: h.port,
    username: 'fixture', auth: 'password', terminalType: 'generic', sessionMode: 'persistent' }, {
    secrets: { password: 'fixture-password' }, knownHosts: options.knownHosts ?? h.knownHosts, pins: options.pins || {},
    ask: async () => { prompts++; return options.cancel ? null : 'fixture-code'; },
    trust: async () => { trustPrompts++; return options.trust === true; }, savePin: async () => {},
    clientFactory: () => { client = new Client(); client.once('close', () => { closed = true; }); return client; }
  });
  return { remote, client: () => client, closed: () => closed, prompts: () => prompts, trustPrompts: () => trustPrompts };
}
function cleanProvider(remote) {
  assert.equal(remote.connected, false); assert.equal(remote.client, null); assert.deepEqual(remote.secrets, {});
  assert.equal(remote.standard.connected, false); assert.equal(remote.standard.client, null); assert.deepEqual(remote.standard.secrets, {});
  for (const map of [remote.controls, remote.opening, remote.views, remote.shells, remote.pendingCommands]) assert.equal(map.size, 0);
  assert.equal(remote.cancelSignIn, null); assert.equal(remote.supportTask, null);
}
test('300 appliance-like SSH cycles reject probes and restore transport, shell, prompt and secret baselines', { timeout: 180000 }, async t => {
  const h = await appliance(t), cases = { normal: 0, passwordFailure: 0, interactive: 0, cancelInteractive: 0, transportLoss: 0, shellFailure: 0 };
  const kinds = Object.keys(cases), latency = [];
  let maxLiveSockets = 0, maxLiveChannels = 0, maxCloseListeners = 0, maxErrorListeners = 0, prompts = 0;
  for (let cycle = 0; cycle < 300; cycle++) {
    const kind = kinds[cycle % kinds.length], started = performance.now(); h.scenario(kind); cases[kind]++;
    const f = remoteFor(h, { cancel: kind === 'cancelInteractive' }), r = f.remote;
    try {
      // Explicitly attempted discovery flags may never enable appliance commands.
      r.allowDiscovery = true;
      if (['passwordFailure', 'cancelInteractive'].includes(kind)) {
        await assert.rejects(r.connect(), /authentication|sign-in|closed/i);
      } else {
        await r.connect(); assert.deepEqual(r.panes, []); assert.equal(f.trustPrompts(), 0);
        assert.equal(f.client().listenerCount('ready'), 0, 'settled login readiness listeners must retire');
        maxCloseListeners = Math.max(maxCloseListeners, f.client().listenerCount('close'));
        maxErrorListeners = Math.max(maxErrorListeners, f.client().listenerCount('error'));
        assert.ok(f.client().listenerCount('close') <= 3, 'fixed close listeners cannot accumulate');
        assert.ok(f.client().listenerCount('error') <= 1, 'temporary failed-login listeners retire');
        if (kind === 'shellFailure') await assert.rejects(r.createSession('Refused shell'), /request|shell|failure/i);
        else {
          const pane = await r.createSession('Fixture router'), output = [];
          r.on('output', (_key, bytes) => output.push(bytes.toString())); await r.open(pane.key);
          await until(() => output.join('').includes('SYNTHETIC_ROUTER_READY> '), 'router readiness');
          assert.equal(h.metrics.automaticInputBytes, 0); assert.equal(h.metrics.execRequests, 0); assert.equal(h.metrics.subsystemRequests, 0);
          assert.equal(pane.terminalType, 'generic'); assert.deepEqual(await r.discover(), [pane]);
          maxLiveSockets = Math.max(maxLiveSockets, h.peers.size); maxLiveChannels = Math.max(maxLiveChannels, h.channels.size);
          h.allowInput(); await r.input(pane.key, 'show version\r');
          await until(() => output.join('').includes('show version\r'), 'intentional keyboard input');
          if (kind === 'transportLoss') {
            const disconnected = new Promise(resolve => r.once('disconnected', resolve)); h.drop(); await disconnected;
            assert.equal(r.activeShellCount(), 0); await assert.rejects(r.input(pane.key, 'MUST_NOT_REPLAY'), /not connected/i);
            await assert.rejects(r.open(pane.key), /ended/i);
          } else r.closeView(pane.key);
        }
        latency.push(performance.now() - started);
      }
      prompts += f.prompts();
    } finally { r.disconnect(); }
    cleanProvider(r);
    assert.equal(f.client().listenerCount('ready'), 0);
    await until(() => h.peers.size === 0 && h.channels.size === 0 && f.closed(), 'resource retirement at cycle ' + cycle);
  }
  assert.equal(h.metrics.execRequests, 0); assert.equal(h.metrics.subsystemRequests, 0); assert.equal(h.metrics.automaticInputBytes, 0);
  assert.equal(h.metrics.acceptedShells, 150); assert.equal(h.metrics.acceptedPtys, 200); assert.equal(h.metrics.authChallenges, 100);
  assert.equal(prompts, 100); assert.equal(h.peers.size, 0); assert.equal(h.channels.size, 0);
  const sorted = latency.toSorted((a, b) => a - b);
  t.diagnostic(JSON.stringify({ cycles: 300, cases, ...h.metrics, prompts,
    latencyMs: { median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor(sorted.length * .95)], max: sorted.at(-1) },
    resources: { liveSockets: h.peers.size, liveChannels: h.channels.size, maxLiveSockets, maxLiveChannels, maxCloseListeners, maxErrorListeners,
      retainedProviderMaps: 0, retainedSecrets: 0, pendingTasks: 0, pendingPrompts: 0, settledReadyListeners: 0 },
    runtime: { node: process.versions.node, platform: process.platform, architecture: process.arch },
    scope: 'Real verified ssh2 loopback transport and ordinary PTY channels; synthetic appliance protocol. No operating-system device, production credentials, renderer-memory or vendor interoperability claim.' }));
});
test('generic verified login preserves known_hosts, approved pins, changed-key and revoked-key blocking', { timeout: 20000 }, async t => {
  const h = await appliance(t);
  const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
  const wrong = utils.parseKey(otherKey).getPublicSSH(), changed = `[127.0.0.1]:${h.port} ssh-rsa ${wrong.toString('base64')}\n`;
  for (const c of [
    { label: 'known host', options: {}, accepted: true },
    { label: 'approved pin', options: { knownHosts: '', pins: { [h.target]: fingerprint(h.hostKey) } }, accepted: true },
    { label: 'unknown refusal', options: { knownHosts: '' }, accepted: false, prompt: 1 },
    { label: 'changed known host', options: { knownHosts: changed }, accepted: false },
    { label: 'changed local pin', options: { pins: { [h.target]: fingerprint(wrong) } }, accepted: false },
    { label: 'revoked known host', options: { knownHosts: '@revoked ' + h.knownHosts }, accepted: false }
  ]) {
    h.scenario('normal'); const f = remoteFor(h, c.options), r = f.remote;
    try {
      if (c.accepted) { await r.connect(); assert.equal(r.connected, true); }
      else await assert.rejects(r.connect(), /blocked|verification|cancelled|revoked|changed|known_hosts/i, c.label);
      assert.equal(f.trustPrompts(), c.prompt || 0, c.label);
    } finally { r.disconnect(); }
    cleanProvider(r); await until(() => h.peers.size === 0 && h.channels.size === 0 && f.closed(), c.label + ' retirement');
  }
  assert.equal(h.metrics.execRequests, 0); assert.equal(h.metrics.acceptedShells, 0); assert.equal(h.metrics.subsystemRequests, 0);
});
