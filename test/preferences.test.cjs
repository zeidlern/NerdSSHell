'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { StateStore } = require('../src/storage.cjs');
const { notifications, sessionDefaults, preferences } = require('../src/preferences.cjs');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nerdsshell-preferences-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return new StateStore(directory);
}

test('legacy data gains notification/default preferences without losing connections, trust or actions', t => {
  const store = fixture(t);
  store.putProfile({ id: 'fixture', name: 'Test host', host: 'example.test', username: 'tester', scrollback: 234567,
    archiveMB: 128, autoConnect: false, startup: 'restore', record: false });
  store.data.pins = { 'example.test:22': 'SHA256:fixture' };
  store.data.workspace = { ...store.data.workspace, layout: 4, order: ['fixture/session/pane'], active: 'fixture/session/pane' };
  store.data.actionConfiguration.favoritesByOS = { ...store.data.actionConfiguration.favoritesByOS, Windows: ['system.info'] };
  const prior = structuredClone(store.data);
  delete store.data.notifications; delete store.data.sessionDefaults;
  store.save();
  const originalFile = fs.readFileSync(store.file);
  const restored = new StateStore(store.directory);
  assert.deepEqual(restored.data.profiles, prior.profiles);
  assert.deepEqual(restored.data.pins, prior.pins);
  assert.deepEqual(restored.data.workspace, prior.workspace);
  assert.deepEqual(restored.data.actionConfiguration, prior.actionConfiguration);
  assert.deepEqual(restored.data.notifications, { enabled: true, audio: true, desktop: true, visual: true });
  assert.deepEqual(fs.readFileSync(store.file), originalFile, 'loading old settings must not rewrite the existing file');
});

test('one Preferences Save validates all sections and persists one coherent transaction', t => {
  const store = fixture(t), priorProfiles = store.data.profiles, priorPins = store.data.pins;
  const save = store.save.bind(store); let writes = 0;
  store.save = () => { writes++; save(); };
  const result = store.setPreferences({ appearance: { ...store.data.appearance, accent: '#112233', copyOnSelect: false },
    notifications: { enabled: true, audio: false, desktop: false, visual: true },
    sessionDefaults: { scrollback: 150000, archiveMB: 256, record: false, autoConnect: false, startup: 'none' },
    actionConfiguration: store.data.actionConfiguration });
  assert.equal(writes, 1);
  assert.equal(store.data.profiles, priorProfiles); assert.equal(store.data.pins, priorPins);
  const restored = new StateStore(store.directory);
  for (const key of Object.keys(result)) assert.deepEqual(restored.data[key], result[key]);
  assert.equal(restored.data.appearance.copyOnSelect, false);
});

test('a bad Preferences section cannot partially save appearance or alter existing data', t => {
  const store = fixture(t); store.save();
  const prior = store.data, bytes = fs.readFileSync(store.file);
  assert.throws(() => store.setPreferences({ appearance: { accent: '#123456' }, notifications: { audio: 'false' } }), /on or off/);
  assert.equal(store.data, prior); assert.deepEqual(fs.readFileSync(store.file), bytes);
  assert.throws(() => store.setPreferences({ profiles: [] }), /Unknown preferences/);
  assert.equal(store.data, prior);
});

test('failed persistent Save restores the in-memory preferences as well as the existing primary file', t => {
  const store = fixture(t); store.save(); const prior = store.data, bytes = fs.readFileSync(store.file);
  store.save = () => { throw new Error('Simulated disk full'); };
  assert.throws(() => store.setPreferences({ notifications: { audio: false } }), /disk full/);
  assert.equal(store.data, prior); assert.deepEqual(fs.readFileSync(store.file), bytes);
});

test('notifications and new-connection defaults reject malformed or unbounded settings', () => {
  for (const value of [null, [], false, 'enabled']) assert.throws(() => notifications(value));
  for (const key of ['enabled', 'audio', 'desktop', 'visual']) assert.throws(() => notifications({ [key]: 1 }));
  for (const value of [999, 500001, NaN, '100000']) assert.throws(() => sessionDefaults({ scrollback: value }));
  for (const value of [15, 4097, Infinity]) assert.throws(() => sessionDefaults({ archiveMB: value }));
  assert.throws(() => sessionDefaults({ startup: 'start arbitrary tasks' }));
  assert.throws(() => preferences({ actionConfiguration: { custom: 'not an array' } }));
  assert.equal(sessionDefaults().record, false);
});
