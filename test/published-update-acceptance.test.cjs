'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs'), path = require('node:path'), { randomBytes } = require('node:crypto');
const asar = require('@electron/asar');
const { hostedEnvironment, FROM, TO, controllerProtocol, isCandidateControllerEntry, updaterFromArchive } = require('../scripts/Published-Update-Smoke.cjs');
const permitted = {
  GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_REPOSITORY: 'zeidlern/NerdSSHell',
  RUNNER_TEMP: os.tmpdir(), GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_ACTOR: 'zeidlern', GITHUB_REF: 'refs/heads/main'
};
test('real consumer installer fixture refuses workstations, self-hosted runners, forks and unreviewed dispatch', () => {
  assert.doesNotThrow(() => hostedEnvironment(permitted, 'win32'));
  assert.throws(() => hostedEnvironment(permitted, 'linux'));
  for (const replacement of [
    { GITHUB_ACTIONS: undefined }, { GITHUB_ACTIONS: 'false' }, { RUNNER_ENVIRONMENT: 'self-hosted' },
    { GITHUB_REPOSITORY: 'other/NerdSSHell' }, { RUNNER_TEMP: undefined }, { RUNNER_TEMP: 'relative' },
    { GITHUB_EVENT_NAME: 'push' }, { GITHUB_ACTOR: 'other' }, { GITHUB_REF: 'refs/heads/feature' }
  ]) assert.throws(() => hostedEnvironment({ ...permitted, ...replacement }, 'win32'));
  const internal = { ...permitted, GITHUB_EVENT_NAME: 'pull_request', NERDSSHELL_ACCEPTANCE_HEAD_REPOSITORY: 'zeidlern/NerdSSHell' };
  assert.doesNotThrow(() => hostedEnvironment(internal, 'win32'));
  assert.throws(() => hostedEnvironment({ ...internal, NERDSSHELL_ACCEPTANCE_HEAD_REPOSITORY: 'other/NerdSSHell' }, 'win32'));
});
test('published consumer acceptance binds original immutable installers rather than newly rebuilt bytes', () => {
  assert.deepEqual(FROM, { version: '1.2.1', sha256: '446b31fab8a00bca32b68d2e4ca9d257392e60b21eb03e16fc7105fc91269e24' });
  assert.deepEqual(TO, { version: '1.2.2', sha256: '8376baa0339283db4400098c8b68f0d6ce8dfbab2bdb576d1a3a19c85b07b74c' });
});
function protocolFixture(t) {
  const temporary = fs.realpathSync.native(os.tmpdir()), directory = fs.mkdtempSync(path.join(temporary, 'nerdsshell-candidate-controller-'));
  const owner = fs.lstatSync(directory, { bigint: true }), nonce = randomBytes(32).toString('hex');
  t.after(() => { const actual = fs.realpathSync.native(directory), current = fs.lstatSync(directory, { bigint: true }); assert.equal(path.dirname(actual).toLowerCase(), temporary.toLowerCase()); assert.equal(current.dev, owner.dev); assert.equal(current.ino, owner.ino); fs.rmSync(actual, { recursive: true, force: true }); });
  return { directory, nonce, producer: controllerProtocol(directory, nonce), consumer: controllerProtocol(directory, nonce) };
}
test('SDK controller dispatch binds its actual argv entry file instead of Electron require.main', () => {
  const filename = path.resolve('scripts/Published-Update-Smoke.cjs'), argv = ['electron', filename, '--candidate-controller'];
  assert.equal(isCandidateControllerEntry('44.5.1', argv, filename), true);
  assert.equal(isCandidateControllerEntry(undefined, argv, filename), false);
  assert.equal(isCandidateControllerEntry('44.5.1', ['electron', path.resolve('other.cjs'), '--candidate-controller'], filename), false);
  assert.equal(isCandidateControllerEntry('44.5.1', ['electron', filename, '--different'], filename), false);
});
test('owned file protocol rejects wrong nonces, unknown commands and consent replay', t => {
  const value = protocolFixture(t); assert.throws(() => value.producer.sendCommand('INSTALL'));
  value.producer.sendCommand('GO'); assert.equal(value.consumer.takeCommand(), 'GO'); assert.equal(value.consumer.takeCommand(), null);
  assert.throws(() => value.producer.sendCommand('GO'), /EEXIST/);
  const hostile = protocolFixture(t); controllerProtocol(hostile.directory, randomBytes(32).toString('hex')).sendCommand('GO');
  assert.throws(() => hostile.consumer.takeCommand(), /nonce/);
});
test('cancellation has priority over unconsumed GO and responses require their nonce', t => {
  const value = protocolFixture(t); value.producer.sendCommand('GO'); value.producer.sendCommand('CANCEL');
  assert.equal(value.consumer.takeCommand(), 'CANCEL');
  value.consumer.publish({ type: 'CANCEL' }); assert.equal(value.producer.response().type, 'CANCEL');
  value.consumer.publish({ type: 'DONE' }); assert.equal(value.producer.response().sequence, 2);
  const hostile = protocolFixture(t); controllerProtocol(hostile.directory, randomBytes(32).toString('hex')).publish({ type: 'READY' });
  assert.throws(() => hostile.producer.response(), /nonce/);
});
test('oversized or hardlinked controller command files cannot release a helper', t => {
  const oversized = protocolFixture(t); fs.writeFileSync(path.join(oversized.directory, 'controller-go'), 'x'.repeat(129));
  assert.throws(() => oversized.consumer.takeCommand(), /marker/);
  const linked = protocolFixture(t); linked.producer.sendCommand('GO'); fs.linkSync(path.join(linked.directory, 'controller-go'), path.join(linked.directory, 'unowned-alias'));
  assert.throws(() => linked.consumer.takeCommand(), /marker/);
});
test('incomplete pending commands are invisible and partial final commands refuse consent', t => {
  const value = protocolFixture(t), pending = path.join(value.directory, 'controller-go-pending-fixture');
  fs.writeFileSync(pending, ''); assert.equal(value.consumer.takeCommand(), null);
  fs.writeFileSync(pending, 'GO ' + value.nonce.slice(0, 8)); assert.equal(value.consumer.takeCommand(), null);
  const final = path.join(value.directory, 'controller-go');
  fs.writeFileSync(final, ''); assert.throws(() => value.consumer.takeCommand(), /nonce/);
  fs.writeFileSync(final, 'GO ' + value.nonce.slice(0, 8)); assert.throws(() => value.consumer.takeCommand(), /nonce/);
});
test('atomic response replacement between stat and open retries a bounded current snapshot', t => {
  const value = protocolFixture(t); value.consumer.publish({ type: 'READY' }); let replaced = false;
  const reader = controllerProtocol(value.directory, value.nonce, { fileSystem: { ...fs, openSync(file, ...args) {
    if (!replaced && path.basename(file) === 'controller-response.json') { replaced = true; value.consumer.publish({ type: 'GO' }); }
    return fs.openSync(file, ...args);
  } } });
  assert.equal(reader.response().type, 'GO'); assert.equal(replaced, true);
});
test('immutable command replacement still fails even with identical nonce bytes', t => {
  const value = protocolFixture(t); value.producer.sendCommand('GO'); let replaced = false;
  const reader = controllerProtocol(value.directory, value.nonce, { fileSystem: { ...fs, openSync(file, ...args) {
    if (!replaced && path.basename(file) === 'controller-go') { replaced = true; fs.renameSync(file, path.join(value.directory, 'original-command')); fs.writeFileSync(file, 'GO ' + value.nonce + '\n'); }
    return fs.openSync(file, ...args);
  } } });
  assert.throws(() => reader.takeCommand(), /identity changed/);
});
test('updater module reads the replacement ASAR layout after a real same-path upgrade', async t => {
  const value = protocolFixture(t), input = path.join(value.directory, 'input'), archive = path.join(value.directory, 'app.asar');
  fs.mkdirSync(path.join(input, 'src'), { recursive: true });
  fs.writeFileSync(path.join(input, 'src', 'release-updater.cjs'), 'module.exports={snapshotVersion:"1.2.1"};');
  await asar.createPackage(input, archive); assert.equal(updaterFromArchive(archive).snapshotVersion, '1.2.1');
  fs.writeFileSync(path.join(input, 'a-new-prefix.txt'), 'NEW ARCHIVE LAYOUT\n'.repeat(500));
  fs.writeFileSync(path.join(input, 'src', 'release-updater.cjs'), 'module.exports={snapshotVersion:"1.2.2",newLayout:true};');
  const replacement = path.join(value.directory, 'replacement.asar'); await asar.createPackage(input, replacement); fs.renameSync(replacement, archive);
  const replaced = updaterFromArchive(archive); assert.equal(replaced.snapshotVersion, '1.2.2'); assert.equal(replaced.newLayout, true); asar.uncache(archive);
});
