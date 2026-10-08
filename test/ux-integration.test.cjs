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
async function mainFixture(t, timerHooks = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nerdsshell-ux-integrated-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const handlers = new Map(), messages = [], notices = [], app = new EventEmitter(); let responder = () => ({ response: 1 }), attempts = 0, exits = 0, window;
  Object.assign(app, { isPackaged: true, setPath() {}, commandLine: { getSwitchValue: () => root }, requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(),
    getPath: () => root, getVersion: () => 'fixture', exit() { throw new Error('Unexpected app.exit'); },
    quit() { attempts++; const e = { prevented: false, preventDefault() { this.prevented = true; } }; app.emit('before-quit', e); if (!e.prevented) { exits++; if (window) window.destroyed = true; } } });
  class FakeWindow extends EventEmitter {
    constructor() { super(); window = this; this.destroyed = false;
      this.webContents = new EventEmitter(); this.webContents.mainFrame = { url: 'nerdsshell://app/ui/index.html' };
      this.webContents.send = (_channel, event) => {
        notices.push(event);
        if (event.type === 'prompt' && event.kind === 'confirmation') {
          messages.push(event);
          Promise.resolve(responder(event)).then(result => handlers.get('nerdsshell:promptReply')({ sender: this.webContents, senderFrame: this.webContents.mainFrame }, event.id, Number.isInteger(result?.response) ? 'choice:' + result.response : null, false));
        }
      };
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
    dialog: { showMessageBox: async () => { throw Error('App-owned confirmation unexpectedly used a native message box'); }, showErrorBox(_title, message) { throw new Error(message); } },
    clipboard: {}, Menu: { setApplicationMenu() {} }, shell: {}, net: {} };
  const filename = path.resolve(__dirname, '../src/main.cjs'), req = createRequire(filename), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\nmodule.exports={connections,prompts,ask,confirm,getStore:()=>store};', {
    require: name => name === 'electron' ? electron : req(name), module, __dirname: path.dirname(filename),
    process, Buffer, console, setTimeout: timerHooks.setTimeout || setTimeout, clearTimeout: timerHooks.clearTimeout || clearTimeout, AbortController, Response, URL
  });
  await tick();
  t.after(() => { for (const answer of module.exports.prompts.values()) answer(null); });
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
test('actual window close keeps renderer and unsaved notes alive when Cancel is chosen', async t => {
  const h = await mainFixture(t); await h.invoke('scratchpadDirty', true);
  const e = h.close(); assert.equal(e.prevented, true); assert.equal(h.window.destroyed, false);
  await tick(); assert.equal(h.exits(), 0); assert.equal(h.app.nerdsshellScratchpadDirty, true);
  assert.equal(h.messages[0].title, 'Discard unsaved scratchpad?');
  assert.deepEqual([...h.messages[0].buttons], ['Continue', 'Cancel']); assert.equal(h.messages[0].defaultId, 1);
  h.respond(0); h.close(); await tick(); await tick(); assert.equal(h.exits(), 1);
});
test('actual quit serializes themed confirmations; scratchpad Cancel preserves LOCAL and Persistent work', async t => {
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


test('shared confirmation policy preserves every logical button ID and delegates OS file/error controls', async () => {
  let nativeBoxes = 0, opens = 0, errors = 0, seen;
  const native = { showMessageBox() { nativeBoxes++; }, showOpenDialog() { assert.equal(this, native); opens++; return 'picker'; }, showErrorBox() { assert.equal(this, native); errors++; } };
  const policy = cancelOnRight(native, async (_window, options) => { seen = options; return { response: 1 }; });
  const original = { buttons: ['Yes', 'Cancel', 'No'], cancelId: 1, defaultId: 0 };
  assert.equal((await policy.showMessageBox({}, original)).response, 2);
  assert.deepEqual(seen.buttons, ['Yes', 'No', 'Cancel']); assert.equal(seen.defaultId, 2); assert.equal(seen.cancelId, 2);
  assert.deepEqual(original.buttons, ['Yes', 'Cancel', 'No']); assert.equal(nativeBoxes, 0);
  assert.equal(policy.showOpenDialog(), 'picker'); policy.showErrorBox('Synthetic', 'Synthetic'); assert.equal(opens, 1); assert.equal(errors, 1);
});

test('server-support confirmation shares the credential queue without recursively enqueueing behind itself', async t => {
  const h = await mainFixture(t), hold = deferred(); h.respond(() => hold.promise);
  const approval = h.main.ask({ title: 'Synthetic server support', message: 'Explicit support approval', confirm: true }); await tick();
  const prompt = h.notices.find(e => e.type === 'prompt'); assert.equal(prompt.kind, 'confirmation');
  assert.deepEqual([...prompt.buttons], ['Continue', 'Cancel']); assert.equal(prompt.defaultId, 1);
  hold.resolve({ response: 0 }); assert.equal(await approval, true); assert.equal(h.main.prompts.size, 0);
});

test('queued app confirmations reject malformed replies and never leak into native message boxes', async t => {
  const h = await mainFixture(t), hold = deferred(); h.respond(() => hold.promise);
  const first = h.main.confirm('First', 'Synthetic'), second = h.main.confirm('Second', 'Synthetic'); await tick();
  assert.equal(h.messages.length, 1); const one = h.notices.find(e => e.type === 'prompt');
  await h.invoke('promptReply', one.id, 'choice:7', false); assert.equal(await first, false); await tick();
  assert.equal(h.messages.length, 2); const two = h.notices.filter(e => e.type === 'prompt').at(-1);
  await h.invoke('promptReply', one.id, 'choice:0', false); assert.equal(h.main.prompts.size, 1);
  await h.invoke('promptReply', two.id, 'choice:0', false); assert.equal(await second, true); assert.equal(h.main.prompts.size, 0);
});

test('dialog queue saturation fails explicitly and all canceled slots become reusable', async t => {
  const h = await mainFixture(t), hold = deferred(); h.respond(() => hold.promise);
  const tasks = Array.from({ length: 64 }, (_, index) => h.main.confirm('Synthetic ' + index, 'No operation'));
  for (const task of tasks) task.catch(() => {});
  await assert.rejects(h.main.confirm('Overflow', 'No operation'), /Too many dialogs/);
  for (let index = 0; index < tasks.length; index++) { await tick(); const id = [...h.main.prompts.keys()][0]; assert.ok(id); await h.invoke('promptReply', id, null); assert.equal(await tasks[index], false); }
  const after = h.main.confirm('After cancellation', 'No operation'); await tick();
  await h.invoke('promptReply', [...h.main.prompts.keys()][0], 'choice:0'); assert.equal(await after, true); assert.equal(h.main.prompts.size, 0);
});


test('a failed renderer send cancels the confirmation and leaves the queue reusable', async t => {
  const h = await mainFixture(t), send = h.window.webContents.send;
  h.window.webContents.send = () => { throw Error('Synthetic destroyed sender'); };
  assert.equal(await h.main.confirm('Synthetic', 'No operation'), false); assert.equal(h.main.prompts.size, 0);
  h.window.webContents.send = send; h.respond(0);
  assert.equal(await h.main.confirm('Recovered', 'No operation'), true); assert.equal(h.main.prompts.size, 0);
});

test('renderer reload cancels active and queued confirmations without accepting late replies', async t => {
  const h = await mainFixture(t), hold = deferred(); h.respond(() => hold.promise);
  h.window.webContents.emit('did-finish-load');
  const first = h.main.confirm('First', 'No operation'), queued = h.main.confirm('Queued', 'No operation'); await tick();
  const old = [...h.main.prompts.keys()][0]; h.window.webContents.emit('did-start-loading');
  assert.equal(await first, false); assert.equal(await queued, false); assert.equal(h.main.prompts.size, 0);
  await h.invoke('promptReply', old, 'choice:0');
  assert.equal(await h.main.confirm('While reloading', 'No operation'), false); assert.equal(h.messages.length, 1);
  h.window.webContents.emit('did-finish-load'); h.respond(0);
  assert.equal(await h.main.confirm('New renderer', 'No operation'), true); assert.equal(h.main.prompts.size, 0);
});

test('destroying the renderer cancels owned approvals and cannot leave an invisible queued prompt', async t => {
  const h = await mainFixture(t), hold = deferred(); h.respond(() => hold.promise);
  const active = h.main.confirm('Active', 'No operation'), queued = h.main.confirm('Queued', 'No operation'); await tick();
  h.window.webContents.isDestroyed = () => true; h.window.webContents.emit('destroyed');
  assert.equal(await active, false); assert.equal(await queued, false); assert.equal(h.main.prompts.size, 0);
  assert.equal(await h.main.confirm('Destroyed frame', 'No operation'), false); assert.equal(h.main.prompts.size, 0);
});


test('renderer loss preserves authenticated Standard shells and Persistent work, and quit fails closed without a usable presenter', async t => {
  const h = await mainFixture(t), standard = runtime('standard-owned', 1), persistent = runtime('persistent-owned', 0);
  h.main.connections.set('standard-owned', standard); h.main.connections.set('persistent-owned', persistent);
  h.window.webContents.emit('render-process-gone');
  assert.equal(standard.disconnected(), 0); assert.equal(persistent.disconnected(), 0);
  assert.equal(standard.remote.connected, true); assert.equal(standard.remote.shells.size, 1); assert.equal(persistent.remote.connected, true);
  h.app.quit(); await tick(); await tick();
  assert.equal(h.exits(), 0); assert.equal(standard.disconnected(), 0); assert.equal(persistent.disconnected(), 0); assert.equal(h.messages.length, 0);
});


test('approval expiration still resolves safely when the renderer cancellation send fails', async t => {
  const callbacks = [], h = await mainFixture(t, { setTimeout(callback, ms) { assert.equal(ms, 180000); callbacks.push(callback); return callback; }, clearTimeout() {} });
  const hold = deferred(); h.respond(() => hold.promise);
  const decision = h.main.confirm('Expiration', 'No operation'); await tick();
  assert.equal(h.main.prompts.size, 1); h.window.webContents.send = () => { throw Error('Synthetic dead renderer'); };
  callbacks.shift()(); assert.equal(await decision, false); assert.equal(h.main.prompts.size, 0);
});
