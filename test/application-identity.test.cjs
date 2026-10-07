'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { UUID } = require('builder-util-runtime');
const { selectUserDataDirectory } = require('../src/application-identity.cjs');
const { StateStore } = require('../src/storage.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nerdsshell-identity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('upgrade opens the original profiles and trust pins without changing saved bytes or archives', t => {
  const root = fixture(t), legacy = path.join(root, 'betterssh');
  const previous = new StateStore(legacy);
  previous.putProfile({ id: 'synthetic', name: 'Synthetic', host: '127.0.0.1', username: 'fixture', auth: 'agent', autoConnect: false });
  previous.data.pins['127.0.0.1:22'] = 'SHA256:synthetic';
  previous.save();
  const archive = path.join(legacy, 'synthetic-archive.txt');
  fs.writeFileSync(archive, 'Synthetic old recording\n');
  const original = fs.readFileSync(previous.file), recorded = fs.readFileSync(archive);
  const choice = selectUserDataDirectory({ appDataDirectory: root });
  const current = new StateStore(choice.directory);
  assert.equal(choice.source, 'legacy');
  assert.equal(current.data.profiles[0].id, 'synthetic');
  assert.equal(current.data.pins['127.0.0.1:22'], 'SHA256:synthetic');
  assert.deepEqual(fs.readFileSync(previous.file), original);
  assert.deepEqual(fs.readFileSync(archive), recorded);
  assert.equal(fs.existsSync(path.join(root, 'nerdsshell')), false);
});

test('fresh install uses current storage and selection itself never creates directories', t => {
  const root = fixture(t);
  const choice = selectUserDataDirectory({ appDataDirectory: root });
  assert.equal(choice.source, 'new');
  assert.equal(choice.directory, path.join(root, 'nerdsshell'));
  assert.deepEqual(fs.readdirSync(root), []);
  const saved = new StateStore(choice.directory);
  saved.data.pins.synthetic = 'synthetic-current';
  saved.save();
  const next = selectUserDataDirectory({ appDataDirectory: root });
  assert.equal(next.source, 'current');
  assert.equal(new StateStore(next.directory).data.pins.synthetic, 'synthetic-current');
});

test('two populated data directories keep legacy selection and report conflict without merging', t => {
  const root = fixture(t);
  for (const directory of ['betterssh', 'nerdsshell']) {
    fs.mkdirSync(path.join(root, directory));
    fs.writeFileSync(path.join(root, directory, 'marker'), directory);
  }
  const choice = selectUserDataDirectory({ appDataDirectory: root });
  assert.equal(choice.directory, path.join(root, 'betterssh'));
  assert.equal(choice.otherDirectoryPresent, true);
  for (const directory of ['betterssh', 'nerdsshell']) assert.equal(fs.readFileSync(path.join(root, directory, 'marker'), 'utf8'), directory);
});

test('unreadable legacy storage blocks startup instead of hiding saved data in an empty profile', t => {
  const root = fixture(t);
  const fileSystem = { lstatSync(directory) {
    assert.equal(directory, path.join(root, 'betterssh'));
    throw Object.assign(new Error('Synthetic access denial'), { code: 'EACCES' });
  } };
  assert.throws(() => selectUserDataDirectory({ appDataDirectory: root, fileSystem }), error => error.cause?.code === 'EACCES');
  assert.deepEqual(fs.readdirSync(root), []);
});

test('existing file or redirected data path blocks automatic storage selection', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'betterssh'), 'do not overwrite');
  assert.throws(() => selectUserDataDirectory({ appDataDirectory: root }), /ordinary directory/);
  assert.equal(fs.readFileSync(path.join(root, 'betterssh'), 'utf8'), 'do not overwrite');
  const fileSystem = { lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => true }) };
  assert.throws(() => selectUserDataDirectory({ appDataDirectory: root, fileSystem }), /ordinary directory/);
});

test('invalid current storage also blocks selection when legacy storage exists', t => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, 'betterssh'));
  fs.writeFileSync(path.join(root, 'nerdsshell'), 'unrelated file');
  assert.throws(() => selectUserDataDirectory({ appDataDirectory: root }), /ordinary directory/);
  assert.equal(fs.readFileSync(path.join(root, 'nerdsshell'), 'utf8'), 'unrelated file');
});

test('source fixture override stays isolated and packaged launches ignore it', t => {
  const root = fixture(t), override = path.join(root, 'isolated-fixture');
  const source = selectUserDataDirectory({ appDataDirectory: root, testDataDirectory: override, isPackaged: false });
  assert.equal(source.directory, override);
  assert.equal(source.source, 'test');
  const packaged = selectUserDataDirectory({ appDataDirectory: root, testDataDirectory: override, isPackaged: true });
  assert.equal(packaged.directory, path.join(root, 'nerdsshell'));
  assert.deepEqual(fs.readdirSync(root), []);
  assert.throws(() => selectUserDataDirectory({ appDataDirectory: root, testDataDirectory: 'relative-fixture', isPackaged: false }), /absolute/);
  assert.throws(() => selectUserDataDirectory({ appDataDirectory: '' }), /absolute/);
});

test('packaged explicit profile override takes priority without inspecting or changing either default', t => {
  const root = fixture(t), override = path.join(root, 'explicit-profile');
  fs.mkdirSync(override);
  for (const directory of ['betterssh', 'nerdsshell']) {
    fs.mkdirSync(path.join(root, directory));
    fs.writeFileSync(path.join(root, directory, 'marker'), directory);
  }
  const inspected = [];
  const fileSystem = { lstatSync(directory) { inspected.push(directory); return fs.lstatSync(directory); } };
  const choice = selectUserDataDirectory({ appDataDirectory: root, userDataOverride: override,
    testDataDirectory: path.join(root, 'ignored-test-env'), isPackaged: true, fileSystem });
  assert.equal(choice.directory, override);
  assert.equal(choice.source, 'override');
  assert.deepEqual(inspected, [override]);
  const state = new StateStore(choice.directory);
  state.data.pins.synthetic = 'explicit-profile-only';
  state.save();
  for (const directory of ['betterssh', 'nerdsshell']) {
    assert.deepEqual(fs.readdirSync(path.join(root, directory)), ['marker']);
    assert.equal(fs.readFileSync(path.join(root, directory, 'marker'), 'utf8'), directory);
  }
  assert.equal(fs.existsSync(path.join(root, 'ignored-test-env')), false);
});

test('invalid explicit profile fails instead of falling back to legacy data', t => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, 'betterssh'));
  fs.writeFileSync(path.join(root, 'betterssh', 'marker'), 'preserve legacy');
  assert.throws(() => selectUserDataDirectory({ appDataDirectory: root, userDataOverride: 'relative-profile', isPackaged: true }), /absolute/);
  const ordinaryFile = path.join(root, 'ordinary-file');
  fs.writeFileSync(ordinaryFile, 'preserve file');
  assert.throws(() => selectUserDataDirectory({ appDataDirectory: root, userDataOverride: ordinaryFile, isPackaged: true }), /ordinary directory/);
  const target = path.join(root, 'redirect-target'), redirected = path.join(root, 'redirected-profile');
  fs.mkdirSync(target);
  fs.symlinkSync(target, redirected, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => selectUserDataDirectory({ appDataDirectory: root, userDataOverride: redirected, isPackaged: true }), /ordinary directory/);
  assert.equal(fs.readFileSync(path.join(root, 'betterssh', 'marker'), 'utf8'), 'preserve legacy');
  assert.equal(fs.readFileSync(ordinaryFile, 'utf8'), 'preserve file');
  assert.deepEqual(fs.readdirSync(target), []);
});

test('inaccessible explicit profile never probes a default data directory', t => {
  const root = fixture(t), override = path.join(root, 'unreadable-profile');
  const fileSystem = { lstatSync(directory) {
    assert.equal(directory, override);
    throw Object.assign(new Error('Synthetic access denial'), { code: 'EACCES' });
  } };
  assert.throws(() => selectUserDataDirectory({ appDataDirectory: root, userDataOverride: override, isPackaged: true, fileSystem }), error => error.cause?.code === 'EACCES');
  assert.deepEqual(fs.readdirSync(root), []);
});

test('renamed app retains the installer GUID derived by the original locked NSIS builder', () => {
  const metadata = require('../package.json');
  const builder = fs.readFileSync(require.resolve('app-builder-lib/out/targets/nsis/NsisTarget.js'), 'utf8');
  // Obtain the namespace from the installed builder rather than duplicating its
  // algorithm/namespace; a dependency change must be reviewed for compatibility.
  const namespace = /ELECTRON_BUILDER_NS_UUID = .*?UUID.parse\("([^"]+)"\)/.exec(builder);
  assert.ok(namespace, 'Locked NSIS builder namespace is unavailable');
  const oldGuid = UUID.v5('cc.zeidler.betterssh', UUID.parse(namespace[1]));
  assert.equal(metadata.build.nsis.guid, oldGuid, 'Upgrade/uninstall registry identity changed');
  assert.notEqual(UUID.v5(metadata.build.appId, UUID.parse(namespace[1])), oldGuid, 'App ID rename must not implicitly derive a new installer identity');
  assert.equal(metadata.build.nsis.deleteAppDataOnUninstall, false, 'Uninstall must preserve saved settings');
});
