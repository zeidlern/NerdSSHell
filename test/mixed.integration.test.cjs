'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os');
const { randomUUID } = require('node:crypto');
const { Client } = require('ssh2');
const { MixedRemote } = require('../src/mixed-remote.cjs');
const { shellQuote: q } = require('../src/core.cjs');
const enabled = !!process.env.NERDSSHELL_TEST_KEY;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await delay(100); }
  throw new Error(message);
}
function setup(t, suffix) {
  const host = process.env.NERDSSHELL_TEST_HOST || '127.0.0.1';
  assert.equal(host, '127.0.0.1', 'Mixed integration tests may only use the disposable loopback SSH fixture.');
  assert.equal(process.platform, 'linux', 'The integration fixture must be disposable Linux OpenSSH.');
  const socket = `nerdsshell-mixed-${process.pid}-${randomUUID().slice(0, 8)}-${suffix}`;
  assert.match(socket, /^nerdsshell-mixed-\d+-[a-f0-9]{8}-[a-z]+$/);
  const root = `/tmp/${socket}`, paths = new Set(), remotes = new Set(); let clients = 0;
  const settings = { id: `mixed-${suffix}`, name: 'Disposable mixed fixture', host, port: Number(process.env.NERDSSHELL_TEST_PORT || 22222),
    username: process.env.NERDSSHELL_TEST_USER || os.userInfo().username, auth: 'key', keyPath: process.env.NERDSSHELL_TEST_KEY, socket, sessionMode: 'persistent', scrollback: 1000 };
  const publicKey = fs.readFileSync(process.env.NERDSSHELL_TEST_HOST_KEY + '.pub', 'utf8').trim().split(/\s+/);
  const knownHosts = `[${host}]:${settings.port} ${publicKey[0]} ${publicKey[1]}\n`;
  function remote() {
    const r = new MixedRemote(settings, { knownHosts, clientFactory: () => { clients++; return new Client(); },
      ask: async () => { throw new Error('Fixture must never request passwords, sudo, or installation.'); },
      trust: async () => { throw new Error('Fixture host key must be verified through its generated known_hosts entry.'); } });
    remotes.add(r); return r;
  }
  function proof(name) { assert.match(name, /^[a-z-]+$/); const value = `${root}-${name}`; paths.add(value); return value; }
  t.after(async () => {
    let cleanup = [...remotes].find(r => r.connected && !r.closing);
    try {
      if (!cleanup) { cleanup = remote(); await cleanup.connect(); }
      // Only this unpredictable socket and explicitly enumerated files belong
      // to this test. Never kill default/global tmux or remove a directory tree.
      await cleanup.exec(`${cleanup.prefix} kill-server 2>/dev/null; rm -f -- ${[...paths].map(q).join(' ')}`);
    } finally { for (const r of remotes) r.disconnect(); }
  });
  return { remote, proof, clients: () => clients };
}
async function fileText(r, file) { return r.checked(`cat ${q(file)} 2>/dev/null || true`); }
async function shellPid(r, pane) { return (await r.checked(`${r.prefix} display-message -p -t ${q(pane.paneId)} ${q('#{pane_pid}')}`)).trim(); }

test('real mixed SSH: one authenticated transport, independent Persistent/Standard consoles and provider-bound tasks', { skip: !enabled, timeout: 90000 }, async t => {
  const h = setup(t, 'providers'), r = h.remote(); await r.connect(); assert.deepEqual(r.panes, []);
  const persistent = await r.createSession('Persistent fixture', true), standard = await r.createSession('Standard fixture', false);
  await r.open(persistent.key); await r.open(standard.key);
  assert.equal(h.clients(), 1); assert.equal(r.standard.client, r.client);
  const persistentChannel = r.controls.get(persistent.sessionId).stream, standardChannel = r.shells.get(standard.key).stream;
  assert.notEqual(persistentChannel, standardChannel); assert.equal(r.activeShellCount(), 1);
  assert.equal(r.isStandard(persistent.key), false); assert.equal(r.isStandard(standard.key), true);
  const pBase = h.proof('persistent-base'), sBase = h.proof('standard-base'), pTask = h.proof('persistent-task'), sTask = h.proof('standard-task');
  await r.input(persistent.key, `printf 'P_BASE\\n' >> ${q(pBase)}; sleep 120\r`);
  await r.input(standard.key, `printf 'S_BASE\\n' >> ${q(sBase)}; sleep 120\r`);
  await until(async () => (await fileText(r, pBase)).trim() === 'P_BASE' && (await fileText(r, sBase)).trim() === 'S_BASE', 'Original fixture shells did not start their own harmless jobs.');
  const pid = await shellPid(r, persistent), pView = r.views.get(persistent.key), sView = r.views.get(standard.key);
  // Explicit provider choice must win even if the saved legacy profile default
  // disagrees; these jobs must open new consoles and never input into a base view.
  r.profile.sessionMode = 'standard';
  const persistentTask = await r.createTaskFor('Persistent reviewed task', `printf 'P_TASK\\n' >> ${q(pTask)}`, true);
  r.profile.sessionMode = 'persistent';
  const standardTask = await r.createTaskFor('Standard reviewed task', `printf 'S_TASK\\n' >> ${q(sTask)}`, false);
  await r.open(persistentTask.key); await r.open(standardTask.key);
  await until(async () => (await fileText(r, pTask)).trim() === 'P_TASK' && (await fileText(r, sTask)).trim() === 'S_TASK', 'Explicit-provider tasks did not execute their own reviewed scripts.');
  assert.equal(r.isStandard(persistentTask.key), false); assert.equal(r.isStandard(standardTask.key), true);
  assert.equal(h.clients(), 1, 'All four consoles must reuse one authenticated transport.');
  assert.equal(r.views.get(persistent.key), pView); assert.equal(r.views.get(standard.key), sView);
  assert.equal(await shellPid(r, persistent), pid); assert.equal(r.shells.get(standard.key).stream, standardChannel);
  assert.equal(await fileText(r, pBase), 'P_BASE\n'); assert.equal(await fileText(r, sBase), 'S_BASE\n');
  assert.equal(r.activeShellCount(), 2); assert.equal(r.panes.filter(p => !p.standard).length, 2);
  await r.endSession(standardTask.key);
  assert.equal(r.activeShellCount(), 1); assert.equal(r.views.get(persistent.key), pView); assert.equal(r.views.get(standard.key), sView);
  await r.endSession(persistentTask.key);
  assert.equal(r.activeShellCount(), 1); assert.equal(r.views.get(standard.key), sView); assert.equal(await shellPid(r, persistent), pid);
});

test('real mixed SSH: final Persistent removal preserves Standard; transport loss never replaces Standard and reconnect only discovers surviving Persistent work', { skip: !enabled, timeout: 90000 }, async t => {
  const h = setup(t, 'lifecycle'); let r = h.remote(); await r.connect();
  const persistent = await r.createSession('Only persistent fixture', true), standard = await r.createSession('Surviving standard fixture', false);
  await r.open(persistent.key); await r.open(standard.key);
  const sView = r.views.get(standard.key), sChannel = r.shells.get(standard.key).stream, events = [];
  r.on('ended', key => events.push(['ended', key])); r.on('panes', panes => events.push(['panes', panes.map(p => p.key)]));
  await r.endSession(persistent.key); await r.discover();
  assert.deepEqual(r.panes.map(p => p.key), [standard.key]); assert.equal(r.views.has(persistent.key), false); assert.equal(r.controls.size, 0);
  assert.equal(r.views.get(standard.key), sView); assert.equal(sView.active, true); assert.equal(sView.initialized, true);
  assert.equal(r.shells.get(standard.key).stream, sChannel); assert.equal(r.activeShellCount(), 1);
  assert.ok(events.some(([type, key]) => type === 'ended' && key === persistent.key));
  assert.ok(events.some(([type, keys]) => type === 'panes' && keys.length === 1 && keys[0] === standard.key));
  const sProof = h.proof('standard-after-final'), proof = h.proof('persistent-launch');
  await r.input(standard.key, `printf 'STANDARD_STILL_LIVE\\n' > ${q(sProof)}\r`);
  await until(async () => (await fileText(r, sProof)).trim() === 'STANDARD_STILL_LIVE', 'Standard stopped responding after final Persistent session ended.');
  const survivor = await r.createSession('Reconnect persistent fixture', true); await r.open(survivor.key);
  await r.input(survivor.key, `printf 'ONE_LAUNCH\\n' >> ${q(proof)}; sleep 120\r`);
  await until(async () => (await fileText(r, proof)).trim() === 'ONE_LAUNCH', 'Persistent survivor job did not begin.');
  const pid = await shellPid(r, survivor), lost = [];
  r.on('ended', key => { if (key === standard.key) lost.push('standard-ended'); }); r.on('disconnected', () => lost.push('transport-lost'));
  r.client.destroy();
  await until(() => !r.connected && r.activeShellCount() === 0, 'Owned SSH transport loss did not end its Standard shell.');
  assert.equal(r.shells.has(standard.key), false); assert.equal(r.views.has(standard.key), false);
  assert.ok(lost.includes('standard-ended')); assert.ok(lost.includes('transport-lost'));
  assert.ok(lost.indexOf('standard-ended') < lost.indexOf('transport-lost'), 'Standard must be marked ended before publishing connection loss.');
  r.disconnect(); r = h.remote(); await r.connect(); await r.discover();
  assert.equal(h.clients(), 2); assert.deepEqual(r.panes.map(p => p.key), [survivor.key]); assert.equal(r.activeShellCount(), 0);
  assert.equal(await shellPid(r, survivor), pid); await r.open(survivor.key);
  assert.equal(await fileText(r, proof), 'ONE_LAUNCH\n', 'Reconnect/open/discovery must not run the persistent job again.');
  await assert.rejects(r.open(standard.key), /ended/); await assert.rejects(r.input(standard.key, 'SHOULD_NOT_REPLAY\r'), /not connected/i);
  await r.discover(); assert.equal(r.activeShellCount(), 0); assert.deepEqual(r.panes.map(p => p.key), [survivor.key]);
});
