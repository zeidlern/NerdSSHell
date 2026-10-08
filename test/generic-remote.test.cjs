'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { MixedRemote } = require('../src/mixed-remote.cjs');
function fixture(t, terminalType = 'generic') {
  const r = new MixedRemote({ id: 'appliance', host: 'router.invalid', username: 'fixture', terminalType, auth: 'password' });
  const client = new EventEmitter(), calls = [];
  client.end = () => client.emit('close');
  client.exec = (...args) => { calls.push(['exec', args[0]]); throw Error('No appliance exec is allowed.'); };
  client.shell = (geometry, callback) => {
    calls.push(['shell', geometry]); const stream = new PassThrough(); stream.stderr = new PassThrough();
    stream.close = () => { stream.stderr.end(); stream.emit('close'); };
    stream.setWindow = () => {}; callback(null, stream);
  };
  r.connected = true; r.client = client;
  t.after(() => r.disconnect());
  return { r, calls, client };
}
test('generic discovery cannot be enabled by allowDiscovery or persistenceReady flags', async t => {
  const { r, calls } = fixture(t); await r.ensureSupport(); r.allowDiscovery = true; r.persistenceReady = true;
  assert.deepEqual(await r.discover(), []); assert.deepEqual(calls, []);
  assert.equal(r.profile.sessionMode, 'standard');
});
test('generic provider refuses every automated task, probe and persistence entry point before the wire', async t => {
  const { r, calls } = fixture(t); await r.ensureSupport();
  for (const operation of [() => r.exec('uname -a'), () => r.checked('uname -a'), () => r.enablePersistence(),
    () => r.createSession('Persistent', true), () => r.create('Automatic', 'printf startup'),
    () => r.createTask('Task', 'printf task'), () => r.createTaskFor('Task', 'printf task', false),
    () => r.createTaskFor('Task', 'printf task', true)]) await assert.rejects(operation(), /network-device/i);
  assert.deepEqual(calls, []); assert.equal(r.pendingCommands.size, 0); assert.equal(r.supportTask, null);
});
test('generic default session creation opens only an ordinary PTY and preserves it through discovery', async t => {
  const { r, calls } = fixture(t); await r.ensureSupport();
  const pane = await r.createSession('Router'); await r.open(pane.key);
  assert.equal(pane.standard, true); assert.equal(calls.length, 1); assert.equal(calls[0][0], 'shell');
  assert.equal(calls[0][1].term, 'xterm-256color'); assert.deepEqual(await r.discover(), [pane]);
  r.closeView(pane.key); assert.equal(r.shells.size, 0); assert.equal(r.views.size, 0); assert.equal(r.controls.size, 0);
  await assert.rejects(r.input(pane.key, 'discarded'), /not connected/i);
});
test('ordinary server discovery still performs its bounded tmux support probe', async t => {
  const { r, calls } = fixture(t, 'server'); await r.ensureSupport();
  r.exec = async (command, options) => { calls.push(['probe', command, options]); return { code: 1, stdout: '', stderr: '' }; };
  await r.discover(); assert.equal(calls.length, 1); assert.match(calls[0][1], /tmux -V/);
  assert.deepEqual(calls[0][2], { timeout: 10000, maxBytes: 1024 });
});

test('direct Standard provider refuses command launch and exec even outside Mixed dispatch', async t => {
  const { r, calls } = fixture(t); await r.ensureSupport();
  await assert.rejects(r.standard.create('Startup', 'printf forbidden'), /network-device/i);
  await assert.rejects(r.standard.createTask('Task', 'printf forbidden'), /network-device/i);
  await assert.rejects(r.standard.exec('uname -a'), /network-device/i);
  await assert.rejects(r.standard.checked('uname -a'), /network-device/i);
  assert.deepEqual(calls, []);
  const pane = await r.standard.create('Plain'); assert.equal(pane.terminalType, 'generic'); assert.equal(calls[0][0], 'shell');
});
