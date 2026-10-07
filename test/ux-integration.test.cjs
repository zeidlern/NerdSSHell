'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const { cancelOnRight } = require('../src/dialog-policy.cjs');
const { StateStore } = require('../src/storage.cjs');
const { profile } = require('../src/core.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function mainFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nerdsshell-ux-integrated-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const handlers = new Map(), messages = [], notices = [], app = new EventEmitter(); let responder = () => ({ response: 1 }), attempts = 0, exits = 0, window;
  Object.assign(app, { isPackaged: true, setPath() {}, commandLine: { getSwitchValue: () => root }, requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(),
    getPath: () => root, getVersion: () => 'fixture', exit() { throw new Error('Unexpected app.exit'); },
    quit() { attempts++; const e = { prevented: false, preventDefault() { this.prevented = true; } }; app.emit('before-quit', e); if (!e.prevented) { exits++; if (window) window.destroyed = true; } } });
  class FakeWindow extends EventEmitter {
    constructor() { super(); window = this; this.destroyed = false;
      this.webContents = new EventEmitter(); this.webContents.mainFrame = { url: 'nerdsshell://app/ui/index.html' };
      this.webContents.send = (_channel, event) => notices.push(event);
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.session = { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} };
    }
    isDestroyed() { return this.destroyed; }
    isFocused() { return true; }
    isMinimized() { return false; }
    flashFrame() {}
    loadURL() { return Promise.resolve(); }
  }
  const electron = { app, BrowserWindow: FakeWindow, ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    protocol: { registerSchemesAsPrivileged() {}, handle() {} },
    dialog: { showMessageBox: async (_w, options) => { messages.push(options); return responder(options); }, showErrorBox(_title, message) { throw new Error(message); } },
    clipboard: {}, Menu: { setApplicationMenu() {} }, shell: {}, net: {} };
  const filename = path.resolve(__dirname, '../src/main.cjs'), req = createRequire(filename), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\nmodule.exports={connections,getStore:()=>store};', {
    require: name => name === 'electron' ? electron : req(name), module, __dirname: path.dirname(filename),
    process, Buffer, console, setTimeout, clearTimeout, AbortController, Response, URL
  });
  await tick();
  return { root, app, messages, notices, main: module.exports, get window() { return window; }, attempts: () => attempts, exits: () => exits,
    respond(fn) { responder = typeof fn === 'function' ? fn : () => ({ response: fn }); },
    invoke: (name, ...args) => handlers.get('nerdsshell:' + name)({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, ...args),
    close() { const event = { prevented: false, preventDefault() { this.prevented = true; } }; window.emit('close', event); if (!event.prevented) { window.destroyed = true; app.emit('window-all-closed'); } return event; }
  };
}
function runtime(id = 'fixture', shells = 1) {
  const p = profile({ id, host: 'fixture.example', username: 'tester', sessionMode: 'persistent', autoConnect: false });
  const records = new Map(Array.from({ length: shells }, (_, i) => [id + '/standard-' + i, { dead: false }]));
  let disconnected = 0;
  const remote = { connected: true, closing: false, client: {}, shells: records, activeShellCount: () => [...records.values()].filter(s => !s.dead).length,
    disconnect() { disconnected++; remote.connected = false; records.clear(); } };
  return { profile: p, remote, disconnected: () => disconnected };
}
test('actual window close keeps renderer and unsaved notes alive when native Cancel is chosen', async t => {
  const h = await mainFixture(t); await h.invoke('scratchpadDirty', true);
  const e = h.close(); assert.equal(e.prevented, true); assert.equal(h.window.destroyed, false);
  await tick(); assert.equal(h.exits(), 0); assert.equal(h.app.nerdsshellScratchpadDirty, true);
  assert.equal(h.messages[0].title, 'Discard unsaved scratchpad?');
  assert.deepEqual([...h.messages[0].buttons], ['Continue', 'Cancel']); assert.equal(h.messages[0].defaultId, 1);
  h.respond(0); h.close(); await tick(); await tick(); assert.equal(h.exits(), 1);
});
test('actual quit serializes dialogs; scratchpad Cancel preserves LOCAL and Persistent work', async t => {
  const h = await mainFixture(t), local = runtime('local-fixture', 1), persistent = runtime('mission-fixture', 0);
  h.main.connections.set('local-fixture', local); h.main.connections.set('mission-fixture', persistent);
  await h.invoke('scratchpadDirty', true); const d = deferred(); h.respond(() => d.promise);
  h.app.quit(); h.app.quit(); await tick(); assert.equal(h.messages.length, 1);
  d.resolve({ response: 1 }); await tick(); assert.equal(h.exits(), 0);
  assert.equal(local.disconnected(), 0); assert.equal(persistent.disconnected(), 0);
});
test('affirmative scratchpad discard does not bypass the separate nonpersistent closure confirmation', async t => {
  const h = await mainFixture(t), local = runtime(); h.main.connections.set('fixture', local);
  await h.invoke('scratchpadDirty', true); h.respond(options => ({ response: options.title.startsWith('Discard') ? 0 : 1 }));
  h.close(); await tick(); assert.equal(h.messages.length, 2); assert.equal(h.exits(), 0); assert.equal(local.disconnected(), 0);
  h.respond(0); h.close(); await tick(); await tick(); assert.equal(h.exits(), 1); assert.equal(local.disconnected(), 1);
});
test('new scratchpad edits during quit confirmation are retained and require another review', async t => {
  const h = await mainFixture(t), r = runtime(); h.main.connections.set('fixture', r);
  const d = deferred(); h.respond(() => d.promise); h.app.quit(); await tick();
  await h.invoke('scratchpadDirty', true); d.resolve({ response: 0 }); await tick();
  assert.equal(h.exits(), 0); assert.equal(r.disconnected(), 0);
  assert.ok(h.notices.some(e => e.type === 'notice' && /Scratchpad changed/.test(e.message)));
});
test('quit approval cannot close a replacement connection or a newly added nonpersistent shell', async t => {
  for (const replace of [true, false]) {
    const h = await mainFixture(t), r = runtime(); h.main.connections.set('fixture', r);
    const d = deferred(); h.respond(() => d.promise); h.app.quit(); await tick();
    const replacement = runtime();
    if (replace) h.main.connections.set('fixture', replacement); else r.remote.shells.set('fixture/standard-new', { dead: false });
    d.resolve({ response: 0 }); await tick();
    assert.equal(h.exits(), 0); assert.equal(r.disconnected(), 0); assert.equal(replacement.disconnected(), 0);
    assert.ok(h.notices.some(e => /changed during confirmation/.test(e.message)));
  }
});
test('disconnect consent binds runtime, transport and same-count shell identities', async t => {
  for (const change of ['runtime', 'transport', 'shell']) {
    const h = await mainFixture(t), r = runtime(), replacement = runtime(); h.main.connections.set('fixture', r);
    const d = deferred(); h.respond(() => d.promise); const request = h.invoke('disconnect', 'fixture');
    if (change === 'runtime') h.main.connections.set('fixture', replacement);
    if (change === 'transport') r.remote.client = {};
    if (change === 'shell') r.remote.shells.set('fixture/standard-0', { dead: false });
    d.resolve({ response: 0 }); await assert.rejects(request, /changed during confirmation/);
    assert.equal(r.disconnected(), 0); assert.equal(replacement.disconnected(), 0);
  }
});
test('profile delete/edit confirmation cannot overwrite a concurrently changed saved profile', async t => {
  for (const method of ['deleteProfile', 'saveProfile']) {
    const h = await mainFixture(t), r = runtime(); h.main.connections.set('fixture', r);
    const store = h.main.getStore(); store.putProfile(r.profile);
    const d = deferred(); h.respond(() => d.promise);
    const request = h.invoke(method, method === 'deleteProfile' ? 'fixture' : { ...r.profile, name: 'requested edit' });
    store.putProfile({ ...r.profile, name: 'newer edit' }); d.resolve({ response: 0 });
    await assert.rejects(request, /settings changed/); assert.equal(r.disconnected(), 0);
    assert.equal(store.data.profiles[0].name, 'newer edit');
  }
});
test('native dialog policy maps physical affirmative/Cancel IDs and fails closed on malformed responses', async () => {
  const options = { buttons: ['Cancel', 'End'], cancelId: 0, defaultId: 1 }; let seen, response;
  const wrapped = cancelOnRight({ showMessageBox: async (...args) => { seen = args.at(-1); return { response }; } });
  for (const invalid of [-1, 2, 999, '0', null, undefined, NaN, 0.5]) {
    response = invalid; assert.equal((await wrapped.showMessageBox({}, options)).response, 0);
  }
  assert.deepEqual(seen.buttons, ['End', 'Cancel']); assert.equal(seen.cancelId, 1); assert.equal(seen.defaultId, 1);
  assert.deepEqual(options.buttons, ['Cancel', 'End']);
  response = 0; assert.equal((await wrapped.showMessageBox({}, options)).response, 1);
  response = 1; assert.equal((await wrapped.showMessageBox({}, options)).response, 0);
  await assert.rejects(wrapped.showMessageBox({}, { buttons: ['End', 'Cancel'] }), /explicit Cancel/);
});
test('saved per-OS actions reload without changing profiles, pins, custom palettes or workspace', async t => {
  const h = await mainFixture(t), store = h.main.getStore();
  store.putProfile({ id: 'fixture', host: 'fixture.example', username: 'tester', auth: 'agent', autoConnect: false });
  store.data.pins = { 'fixture.example:22': 'SHA256:synthetic-pin' };
  store.setAppearance({ accent: '#113355', uiBackground: '#223344', palette: { red: '#123456' }, copyOnSelect: false });
  store.setWorkspace({ layout: 2, twoPaneOrientation: 'stacked', order: ['fixture/one'], active: 'fixture/one', splitX: 27, splitY: 69 });
  const baseline = structuredClone({ profiles: store.data.profiles, pins: store.data.pins, appearance: store.data.appearance, workspace: store.data.workspace });
  const id = await h.invoke('actionNewId');
  const config = { custom: [{ id, os: 'Windows', title: 'Synthetic preview', code: 'Write-Output fixture' }], favoritesByOS: { Windows: [id, 'system.info'], Ubuntu: ['system.disk'] } };
  const normalized = await h.invoke('actionConfigurationSave', config);
  assert.equal(normalized.custom[0].shell, 'powershell');
  const restored = new StateStore(h.root).data;
  assert.deepEqual(restored.actionConfiguration, normalized);
  for (const [key, value] of Object.entries(baseline)) assert.deepEqual(restored[key], value);
  const bytes = fs.readFileSync(store.file, 'utf8');
  await assert.rejects(h.invoke('actionConfigurationSave', { custom: [{ ...config.custom[0], code: 'bad\0command' }] }));
  assert.equal(fs.readFileSync(store.file, 'utf8'), bytes);
});
test('old settings migrate legacy favorites while retaining all prior user state', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nerdsshell-legacy-actions-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const original = new StateStore(root); original.putProfile({ id: 'fixture', host: 'fixture.example', username: 'tester', autoConnect: false });
  original.data.pins = { fixture: 'synthetic' }; original.data.workbench.favorites = ['system.disk']; delete original.data.actionConfiguration; original.save();
  const baseline = fs.readFileSync(original.file, 'utf8'), reloaded = new StateStore(root);
  assert.deepEqual(reloaded.data.profiles, original.data.profiles); assert.deepEqual(reloaded.data.pins, original.data.pins);
  assert.deepEqual(reloaded.data.actionConfiguration.favoritesByOS.Windows, ['system.disk']);
  assert.deepEqual(reloaded.data.actionConfiguration.favoritesByOS.Ubuntu, ['system.disk']);
  assert.equal(fs.readFileSync(original.file, 'utf8'), baseline, 'Load alone does not rewrite user settings');
});
