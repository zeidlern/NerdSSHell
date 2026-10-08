'use strict';
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { Server, Client, utils } = require('ssh2');
const { fingerprint } = require('../src/core.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) { for (let tries = 0; tries < 400; tries++) { if (check()) return; await delay(5); } throw Error('Fixture deadline: ' + label); }
async function exerciseLoopback({ Remote, StandardRemote, cycles = 100 }) {
  const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
  const trustedFingerprint = fingerprint(utils.parseKey(privateKey).getPublicSSH());
  const peers = new Set(), channels = new Set(); let shellCount = 0, controlCount = 0, forbiddenLaunches = 0, currentPeer;
  const stableId = 'f9c0a833-6eb5-4dc0-836d-b4e5a8d61036', identity = stableId + '|' + stableId;
  const paneRows = [0, 1].map(index => ['$0', 'fixture', '@0', '0', 'Shell', '%' + index, String(index), '80', '24', '0', identity, '2', 'sh'].join('\t')).join('\n');
  const track = (stream, peer) => { channels.add(stream); stream.on('error', () => {}); stream.on('close', () => channels.delete(stream)); peer.once('close', () => channels.delete(stream)); stream.resume(); return stream; };
  const server = new Server({ hostKeys: [privateKey] }, peer => {
    peers.add(peer); currentPeer = peer; peer._sock.setNoDelay(true); peer.on('error', () => {}); peer.on('close', () => peers.delete(peer));
    peer.on('authentication', request => { if (request.method === 'password' && request.password === 'loopback-fixture') request.accept(); else request.reject(['password']); });
    peer.on('session', accept => {
      const session = accept(); session.on('pty', acceptPty => acceptPty());
      session.on('shell', acceptShell => { shellCount++; const stream = track(acceptShell(), peer); stream.on('data', bytes => stream.write(bytes)); stream.on('end', () => stream.end()); });
      session.on('exec', (acceptExec, _reject, request) => {
        const stream = track(acceptExec(), peer), command = request.command;
        if (/new-session|new-window|kill-session|kill-pane|apt-get/.test(command)) forbiddenLaunches++;
        if (command === 'fixture-pending-response') { stream.write('synthetic unfinished response'); return; }
        if (command.includes(' -C attach-session ')) {
          controlCount++; let lineBuffer = '', sequence = 1;
          const reply = body => { stream.write('%begin ' + sequence + ' ' + sequence + ' 0\n' + (body ? body + '\n' : '') + '%end ' + sequence + ' ' + sequence++ + ' 0\n'); };
          reply('');
          stream.on('data', bytes => {
            lineBuffer += bytes.toString(); const lines = lineBuffer.split('\n'); lineBuffer = lines.pop();
            for (const line of lines) {
              if (/new-session|kill-session/.test(line)) forbiddenLaunches++;
              const pane = line.includes("'%1'") ? '1' : '0';
              if (line.startsWith('display-message')) reply('80|24|0|0|0|0|0|0|0|0|0|1');
              else if (line.startsWith('capture-pane')) reply('PANE_' + pane);
              else { reply(''); if (line.startsWith('send-keys')) stream.write('%output %' + pane + ' CURRENT_' + pane + '\n'); }
            }
          });
          return;
        }
        let answer = '';
        if (command.includes('tmux -V')) answer = 'tmux 3.4';
        else if (command.includes('list-panes')) answer = paneRows;
        else if (command.includes('display-message')) answer = identity;
        stream.write(answer + '\n'); stream.exit(0); stream.end();
      });
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const latencies = [], cases = { standardClose: 0, standardDrop: 0, rejectedAuthentication: 0, pendingCommand: 0, persistentAttach: 0 };
  let maxReadyCloseListeners = 0, pendingImmediatelyAfterDisconnect = 0, remainingPendingCommands = 0, maxLiveChannels = 0, maxClosedCommandDataListeners = 0;
  global.gc?.(); const startMemory = process.memoryUsage(), memorySamples = [];
  try {
    for (let cycle = 0; cycle < cycles; cycle++) {
      const kind = cycle % 5, started = performance.now(); let client, clientClosed = false;
      const Provider = kind === 4 ? Remote : StandardRemote;
      const remote = new Provider({ id: 'loopback', name: 'Disposable loopback', host: '127.0.0.1', port: server.address().port, username: 'fixture', auth: 'password' }, {
        knownHosts: '', pins: { ['127.0.0.1:' + server.address().port]: trustedFingerprint }, secrets: { password: kind === 2 ? 'rejected-fixture' : 'loopback-fixture' },
        clientFactory: () => {
          client = new Client(); client.once('close', () => { clientClosed = true; });
          const originalExec = client.exec.bind(client);
          client.exec = (...args) => {
            const callback = args.pop(), command = args[0];
            return originalExec(...args, (error, channel) => {
              callback(error, channel);
              if (!error && !command.includes(' -C attach-session ')) channel.once('close', () => {
                maxClosedCommandDataListeners = Math.max(maxClosedCommandDataListeners, channel.listenerCount('data') + channel.stderr.listenerCount('data'));
              });
            });
          };
          return client;
        }
      });
      try {
        if (kind === 2) { cases.rejectedAuthentication++; await assert.rejects(remote.connect(), /authentication/i); remote.disconnect(); }
        else {
          await remote.connect(); maxReadyCloseListeners = Math.max(maxReadyCloseListeners, client.listenerCount('close') - 1); latencies.push(performance.now() - started);
          if (kind <= 1) {
            cases[kind === 0 ? 'standardClose' : 'standardDrop']++;
            const panes = [await remote.create('First fixture'), await remote.create('Second fixture')], received = new Map();
            remote.on('output', (key, data) => received.set(key, (received.get(key) || '') + data.toString()));
            await Promise.all(panes.map(pane => remote.open(pane.key)));
            await Promise.all(panes.map((pane, index) => remote.input(pane.key, 'VIEW_' + index)));
            await until(() => panes.every((pane, index) => received.get(pane.key) === 'VIEW_' + index), 'two Standard outputs');
            maxLiveChannels = Math.max(maxLiveChannels, channels.size);
            if (kind === 0) { panes.forEach(pane => remote.closeView(pane.key)); remote.disconnect(); }
            else { const lost = new Promise(resolve => remote.once('disconnected', resolve)); currentPeer._sock.destroy(); await lost; remote.disconnect(); }
            assert.equal(remote.activeShellCount(), 0);
          } else if (kind === 3) {
            cases.pendingCommand++; let finished = false;
            const command = remote.exec('fixture-pending-response').then(() => { finished = true; }, () => { finished = true; });
            await until(() => channels.size === 1, 'pending command channel');
            // Hold this fixture peer briefly so the cleanup result is observable
            // before ssh2 can publish channel/socket closure. No global changes.
            currentPeer._sock.pause(); remote.disconnect(); await delay(10);
            if (!finished) pendingImmediatelyAfterDisconnect++;
            currentPeer._sock.resume(); await command;
            assert.equal(remote.pendingCommands?.size || 0, 0);
          } else {
            cases.persistentAttach++; assert.equal(remote.panes.length, 2);
            const panes = [...remote.panes], snapshots = new Set(), output = new Map();
            remote.on('snapshot', (key, snapshot) => { assert.match(Buffer.from(snapshot.data, 'base64').toString(), /PANE_[01]/); snapshots.add(key); });
            remote.on('output', (key, bytes) => output.set(key, (output.get(key) || '') + bytes.toString()));
            await Promise.all(panes.map(pane => remote.open(pane.key))); assert.equal(snapshots.size, 2); assert.equal(remote.controls.size, 1);
            await Promise.all(panes.map(pane => remote.input(pane.key, 'fixture input')));
            await until(() => panes.every((pane, index) => output.get(pane.key) === 'CURRENT_' + index), 'two persistent outputs');
            for (const pane of panes) remote.closeView(pane.key);
            await remote.discover(); assert.deepEqual(remote.panes.map(pane => pane.sessionToken), [stableId, stableId]); remote.disconnect();
          }
          if (remote.pendingCommands) remainingPendingCommands += remote.pendingCommands.size;
        }
      } finally { remote.disconnect(); }
      await until(() => peers.size === 0 && channels.size === 0 && clientClosed, 'transport/channel cleanup at cycle ' + cycle);
      if ((cycle + 1) % 20 === 0) { global.gc?.(); const measured = process.memoryUsage(); memorySamples.push({ cycle: cycle + 1, heapUsed: measured.heapUsed, rss: measured.rss }); }
    }
    global.gc?.(); const endMemory = process.memoryUsage(), sorted = latencies.toSorted((a, b) => a - b);
    return { cycles, cases, latencyMs: { median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor(sorted.length * .95)], max: sorted.at(-1) },
      resources: { liveSockets: peers.size, liveChannels: channels.size, maxLiveChannels, maxReadyCloseListeners, pendingImmediatelyAfterDisconnect, remainingPendingCommands, maxClosedCommandDataListeners },
      acceptedShells: shellCount, persistentControlAttachments: controlCount, forbiddenJobLaunches: forbiddenLaunches,
      memoryBytes: { gcAvailable: !!global.gc, heapDelta: endMemory.heapUsed - startMemory.heapUsed, rssDelta: endMemory.rss - startMemory.rss, heapAfterWarmupDelta: endMemory.heapUsed - memorySamples[0].heapUsed, samples: memorySamples, note: 'Sequential fixture runs share library/crypto caches; heap/RSS deltas do not prove a leak or a renderer-performance improvement.' },
      runtime: { node: process.versions.node, electron: process.versions.electron || null, platform: process.platform, architecture: process.arch },
      scope: 'Real verified loopback SSH; Standard PTYs echo synthetic bytes. Persistent tmux protocol is modeled, not an operating-system tmux job. Memory measures this Node fixture, not renderer scrollback.' };
  } finally { for (const peer of peers) peer._sock.destroy(); await new Promise(resolve => server.close(resolve)); }
}
module.exports = { exerciseLoopback };
