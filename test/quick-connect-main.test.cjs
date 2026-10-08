'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { EventEmitter } = require('node:events'), { createRequire } = require('node:module');
const { profile } = require('../src/core.cjs'), { StateStore } = require('../src/storage.cjs');
const { StandardRemote } = require('../src/standard-remote.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function until(check) { for (let n = 0; n < 120; n++) { if (check()) return; await tick(); } assert.fail('Quick Connect fixture did not settle.'); }
async function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nerdsshell-quick-main-'));
  const handlers = new Map(), events = [], remotes = [], passwords = [], failures = []; let window;
  const app = new EventEmitter(); Object.assign(app, { isPackaged: false, getPath: () => directory, setPath() {}, getVersion: () => '1.1.0', commandLine: { getSwitchValue: () => directory }, requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(), quit() {}, exit: code => failures.push(code) });
  class Window extends EventEmitter {
    constructor() { super(); window = this; this.webContents = new EventEmitter(); Object.assign(this.webContents, { mainFrame: { url: 'nerdsshell://app/ui/index.html' }, setWindowOpenHandler() {}, session: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} }, send: (_channel, event) => { events.push(event); if (event.type === 'prompt' && event.kind === 'confirmation') queueMicrotask(() => invoke('promptReply', event.id, options.declineClose ? 'choice:1' : 'choice:0')); } }); }
    isDestroyed() { return false; } isFocused() { return true; } isMinimized() { return false; } flashFrame() {} loadURL() { this.webContents.emit('did-finish-load'); return Promise.resolve(); }
  }
  class FixtureRemote extends EventEmitter {
    constructor(p, settings) { super(); this.profile = p; this.options = settings; this.secrets = settings.secrets; this.connected = false; this.closing = false; this.panes = []; this.views = new Map(); this.shells = new Map(); this.disconnects = 0; this.client = new EventEmitter(); remotes.push(this); }
    async connect() {
      if (options.failConnect) throw new Error('Synthetic connection failed.');
      if (options.promptPassword) { const answer = await this.options.ask({ title: 'Synthetic password', message: 'Fixture only.', secret: true, credentialKind: 'ssh-password' }); if (answer === null) throw new Error('Sign-in cancelled.'); this.secrets.password = answer; }
      if (options.connectGate) await options.connectGate.promise;
      if (this.closing) throw new Error('Sign-in cancelled.');
      if (options.trust && !this.options.pins[this.profile.host + ':' + this.profile.port]) {
        const accepted = await this.options.trust({ host: this.profile.host, port: this.profile.port, fingerprint: 'SHA256:synthetic-only' });
        if (!accepted) { const error = new Error('Host identity cancelled.'); error.code = 'NERDSSHELL_HOST_VERIFICATION'; throw error; }
        this.options.savePin(this.profile.host + ':' + this.profile.port, 'SHA256:synthetic-only');
      }
      this.connected = true; return this.panes;
    }
    async createSession(name, persistent) {
      assert.equal(persistent, false); assert.equal(name, 'Shell');
      const key = this.profile.id + '/standard-fixture';
      const pane = { key, profileId: this.profile.id, sessionId: 'fixture', sessionToken: 'stable-fixture', sessionName: name, standard: true, terminalType: 'generic', dead: false, cols: 120, rows: 36 };
      const stream = new EventEmitter(); stream.pauses = 0; stream.resumes = 0; stream.writes = [];
      stream.pause = () => { stream.pauses++; }; stream.resume = () => { stream.resumes++; }; stream.write = (bytes, done) => { stream.writes.push(bytes.toString()); done(); return true; };
      this.shells.set(key, { pane, dead: false, stream, paused: true, serial: 0, pendingCount: 0, pendingBytes: 0, tail: Promise.resolve() }); this.panes = [pane]; this.emit('panes', this.panes);
      if (options.shellGate) await options.shellGate.promise;
      if (options.failShell) { this.closeView(key); throw new Error('Synthetic shell failed.'); }
      if (this.closing) throw new Error('Shell opening cancelled.'); return pane;
    }
    async open(key) { if (options.realStandardViews) return StandardRemote.prototype.open.call(this, key); const pane = this.pane(key); this.views.set(key, { active: true, initialized: true, pane }); return pane; }
    setOutputPaused(key, paused) { if (options.realStandardViews) return StandardRemote.prototype.setOutputPaused.call(this, key, paused); }
    pane(key) { const pane = this.panes.find(p => p.key === key); if (!pane) throw new Error('Unknown shell.'); return pane; }
    activeShellCount() { return this.shells.size; }
    isStandard() { return true; }
    closeView(key) { const record = this.shells.get(key); if (!record) return; record.dead = true; record.pane.dead = true; this.shells.delete(key); this.views.delete(key); this.panes = this.panes.filter(p => p.key !== key); this.emit('ended', key); this.emit('panes', this.panes); }
    disconnect() { this.disconnects++; this.closing = true; this.connected = false; for (const key of this.shells.keys()) this.closeView(key); this.secrets = {}; this.client.emit('close'); }
    input(key, data) { if (options.realStandardViews) return StandardRemote.prototype.input.call(this, key, data); throw new Error('Fixture received unexpected input.'); }
  }
  class FixturePasswords { constructor() {} isAvailable() { return true; } get(...args) { passwords.push(['get', ...args]); return null; } set(...args) { passwords.push(['set', ...args]); } delete(...args) { passwords.push(['delete', ...args]); } }
  const electron = { app, BrowserWindow: Window, ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, dialog: { showErrorBox: (_title, message) => failures.push(message) }, clipboard: {}, Menu: { setApplicationMenu() {} }, shell: {}, protocol: { registerSchemesAsPrivileged() {}, handle() {} }, net: {}, safeStorage: {} };
  const filename = path.resolve(__dirname, '../src/main.cjs'), actual = createRequire(filename), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\nmodule.exports={get:()=>({store,connections,quickEntries,quickViewReservations,genericOpenWaits,genericWaitTransports,pendingQuick,prompts,viewBudget,credentialVersions,output,startQuitting:()=>{quitting=true;finishGenericOpenWaits(new Error("NerdSSHell is closing."))}})};', { require: name => name === 'electron' ? electron : name === './mixed-remote.cjs' ? { MixedRemote: FixtureRemote } : name === './password-store.cjs' ? { PasswordStore: FixturePasswords } : actual(name), module, __dirname: path.dirname(filename), process, Buffer, console, setTimeout: (fn, ms, ...args) => setTimeout(fn, options.fastReloadTimeout && ms === 15000 ? 20 : ms, ...args), clearTimeout, AbortController, Response, URL });
  await until(() => window && handlers.has('nerdsshell:state')); assert.deepEqual(failures, []);
  const event = () => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  const invoke = (name, ...args) => handlers.get('nerdsshell:' + name)(event(), ...args);
  const get = module.exports.get;
  get().store.setQuickConnectDefaults({ username: options.blankUsername ? '' : 'operator', auth: 'password', port: 22, keyPath: '', historyEnabled: true });
  t.after(() => { for (const answer of get().prompts.values()) answer(null); for (const runtime of get().connections.values()) { runtime.wanted = false; clearTimeout(runtime.timer); runtime.remote?.disconnect(); } for (const key of get().output.keys()) get().output.discard(key); fs.rmSync(directory, { recursive: true, force: true }); });
  return { directory, handlers, events, remotes, passwords, get, invoke, event, window, app,
    async prompt() { await until(() => events.some(e => e.type === 'prompt' && get().prompts.has(e.id))); return events.find(e => e.type === 'prompt' && get().prompts.has(e.id)); },
    start(address = 'router.example') { const task = invoke('quickConnect', address); task.catch(() => {}); return task; },
    reply(prompt, value, remember) { return invoke('promptReply', prompt.id, value, remember); } };
}

test('generic profile is explicit and forces Standard; legacy server settings keep their mode', () => {
  const p = { host: '::1', username: 'operator', auth: 'password' };
  assert.equal(profile(p).terminalType, 'server'); assert.equal(profile(p).sessionMode, 'persistent');
  const generic = profile({ ...p, terminalType: 'generic', sessionMode: 'persistent' }); assert.equal(generic.sessionMode, 'standard');
  assert.throws(() => profile({ ...p, terminalType: 'injected' }), /terminal type/);
});
test('Quick preferences upgrade missing state compatibly and retain no renderer-supplied secrets', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nerdsshell-quick-store-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const before = new StateStore(dir); delete before.data.quickConnect; before.data.pins['router:22'] = 'synthetic-pin'; before.save();
  const store = new StateStore(dir); assert.equal(store.data.quickConnect.defaults.port, 22); assert.equal(store.data.pins['router:22'], 'synthetic-pin');
  assert.throws(() => store.setQuickConnectDefaults({ password: 'synthetic-only' }));
  store.rememberQuickConnect({ host: 'router', port: 22, username: 'operator' }); store.setQuickConnectDefaults({ historyEnabled: false });
  assert.equal(store.data.quickConnect.recent.length, 0); store.rememberQuickConnect({ host: 'other', port: 22, username: 'operator' }); assert.equal(store.data.quickConnect.recent.length, 0);
  const prior = store.data.quickConnect, bytes = fs.readFileSync(store.file); store.save = () => { throw new Error('Owned synthetic write failure.'); };
  assert.throws(() => store.setQuickConnectDefaults({ username: 'new' })); assert.equal(store.data.quickConnect, prior); assert.deepEqual(fs.readFileSync(store.file), bytes);
});
test('Quick Connect creates main identity, ordinary shell and reusable host pin without saving a profile', async t => {
  const h = await fixture(t, { trust: true }), task = h.start('operator@router.example:2222'), prompt = await h.prompt();
  assert.equal(prompt.kind, 'host-trust'); await h.reply(prompt, 'trust'); const result = await task;
  assert.match(result.profile.id, /^quick-[a-f0-9-]+$/); assert.equal(result.profile.temporary, true); assert.equal(result.profile.terminalType, 'generic');
  assert.equal(result.profile.sessionMode, 'standard'); assert.equal(result.profile.record, false); assert.equal(result.profile.autoConnect, false); assert.equal(result.profile.rememberPassword, false);
  assert.equal(h.remotes[0].allowDiscovery, false); assert.equal(h.get().store.data.profiles.length, 0); assert.equal(h.get().store.data.pins['router.example:2222'], 'SHA256:synthetic-only');
  assert.deepEqual(h.passwords, []); assert.equal(h.get().credentialVersions.size, 0);
  const first = h.events.findIndex(e => e.type === 'profile'), status = h.events.findIndex(e => e.type === 'status'); assert.ok(first >= 0 && first < status);
  assert.equal(h.get().store.data.quickConnect.recent[0].host, 'router.example');
  await assert.rejects(h.invoke('connect', result.profile.id), /Unknown connection/);
});
test('temporary password prompt cannot remember and no secret reaches settings or renderer events', async t => {
  const h = await fixture(t, { promptPassword: true }), task = h.start(), prompt = await h.prompt();
  assert.equal(prompt.rememberPasswordAvailable, false); await assert.rejects(h.reply(prompt, 'fixture-password', true), /cannot remember/);
  await h.reply(prompt, 'fixture-password', false); const result = await task;
  assert.equal(h.get().connections.get(result.profile.id).secrets.password, 'fixture-password'); assert.deepEqual(h.passwords, []);
  assert.equal(JSON.stringify(h.get().store.data).includes('fixture-password'), false); assert.equal(JSON.stringify(h.events).includes('fixture-password'), false);
});
test('blank username asks once before any SSH transport and cancellation removes its identity', async t => {
  const h = await fixture(t, { blankUsername: true }), task = h.start('::1'), prompt = await h.prompt(); assert.equal(h.remotes.length, 0); assert.equal(prompt.secret, false);
  await h.invoke('disconnect', prompt.profileId); await assert.rejects(task, /cancelled/); assert.equal(h.get().quickEntries.size, 0); assert.equal(h.get().pendingQuick, 0); assert.equal(h.get().viewBudget.pending.size, 0);
  const removed = h.events.findIndex(e => e.type === 'quick-removed'); assert.ok(removed >= 0); await h.reply(prompt, 'too-late'); assert.equal(h.events.slice(removed + 1).some(e => e.type === 'profile'), false);
});
test('validated username response creates no command-like address or profile entry', async t => {
  const h = await fixture(t, { blankUsername: true }), task = h.start('[2001:db8::1]:2222'), prompt = await h.prompt(); await h.reply(prompt, 'operator');
  const result = await task; assert.equal(result.profile.host, '2001:db8::1'); assert.equal(result.profile.username, 'operator'); assert.equal(result.profile.port, 2222); assert.equal(h.get().store.data.profiles.length, 0);
});
test('four pending attempts and the global terminal cap are reserved before SSH', async t => {
  const gate = deferred(), h = await fixture(t, { connectGate: gate }), tasks = Array.from({ length: 4 }, (_, n) => h.start('router' + n));
  assert.equal(h.get().pendingQuick, 4); assert.equal(h.get().viewBudget.pending.size, 4); await assert.rejects(h.start('fifth'), /limit four/); assert.equal(h.remotes.length, 4);
  for (const id of [...h.get().quickEntries.keys()]) await h.invoke('disconnect', id); gate.resolve(); await Promise.allSettled(tasks); assert.equal(h.get().viewBudget.pending.size, 0); assert.equal(h.get().pendingQuick, 0);
  h.get().connections.set('budget-fixture', { profile: { id: 'budget-fixture' }, remote: { connected: true, views: new Map(Array.from({ length: 64 }, (_, n) => ['v' + n, { active: true }])), shells: new Map(), disconnect() {} } });
  await assert.rejects(h.start('blocked'), /limit 64/); assert.equal(h.remotes.length, 4); assert.equal(h.get().quickEntries.size, 0);
});
test('failed transport and failed shell both release every ephemeral registry and reservation', async t => {
  for (const options of [{ failConnect: true }, { failShell: true }]) { const h = await fixture(t, options); await assert.rejects(h.start(), /failed/); assert.equal(h.get().quickEntries.size, 0); assert.equal(h.get().connections.size, 0); assert.equal(h.get().credentialVersions.size, 0); assert.equal(h.get().viewBudget.pending.size, 0); assert.equal(h.get().store.data.quickConnect.recent.length, 0); }
});
test('renderer loss cancels pending work and cannot publish a late revived profile', async t => {
  const gate = deferred(), h = await fixture(t, { connectGate: gate }), task = h.start(); h.window.webContents.emit('did-start-loading');
  const removed = h.events.findIndex(e => e.type === 'quick-removed'); gate.resolve(); await assert.rejects(task, /cancelled/); assert.equal(h.get().quickEntries.size, 0); assert.equal(h.get().connections.size, 0); assert.equal(h.events.slice(removed + 1).some(e => e.type === 'profile'), false);
});
test('closing the last temporary shell confirms consequences then releases its transport and metadata', async t => {
  const h = await fixture(t), { profile: p, pane } = await h.start(); await h.invoke('open', pane.key); assert.equal(await h.invoke('close', pane.key), true);
  assert.ok(h.events.some(e => e.kind === 'confirmation' && /standard SSH/.test(e.title))); assert.equal(h.get().connections.size, 0); assert.equal(h.get().quickEntries.size, 0); assert.equal(h.remotes[0].secrets.password, undefined); assert.equal(h.remotes[0].listenerCount('output'), 0);
  assert.ok(h.events.some(e => e.type === 'quick-removed' && e.profileId === p.id));
});
test('refusing last-shell closure keeps the temporary transport and live shell', async t => {
  const h = await fixture(t, { declineClose: true }), result = await h.start(); await h.invoke('open', result.pane.key); assert.equal(await h.invoke('close', result.pane.key), false); assert.equal(h.remotes[0].connected, true); assert.equal(h.get().quickEntries.size, 1);
});
test('natural shell exit retains only read-only display metadata until its final tab closes', async t => {
  const h = await fixture(t, { promptPassword: true }), task = h.start(), prompt = await h.prompt(); await h.reply(prompt, 'fixture-password', false); const result = await task;
  h.remotes[0].closeView(result.pane.key); await tick(); assert.equal(h.get().connections.size, 0); const state = await h.invoke('state'), retained = state.profiles.find(p => p.id === result.profile.id);
  assert.equal(retained.quickPanes[0].dead, true); assert.equal(retained.quickState.state, 'disconnected'); assert.equal('keyPath' in retained, false); assert.equal(h.remotes[0].secrets.password, undefined); assert.equal(h.remotes[0].eventNames().length, 0);
  await assert.rejects(h.invoke('input', result.pane.key, 'do not replay'), /disconnected/); await assert.rejects(h.invoke('connect', result.profile.id), /Unknown connection/);
  await h.invoke('close', result.pane.key); assert.equal(h.get().quickEntries.size, 0);
});
test('transport loss releases credentials without reconnection and can remove ended metadata directly', async t => {
  const h = await fixture(t), result = await h.start(); h.remotes[0].emit('disconnected', new Error('Synthetic network loss.')); await tick();
  assert.equal(h.get().connections.size, 0); assert.equal(h.get().quickEntries.size, 1); assert.equal(h.remotes.length, 1); await h.invoke('disconnect', result.profile.id); assert.equal(h.get().quickEntries.size, 0); assert.deepEqual(h.passwords, []);
});
test('temporary IDs and dead temporary keys never enter persisted workspace', async t => {
  const h = await fixture(t), result = await h.start(); h.get().store.putProfile({ id: 'saved', host: 'saved.example', username: 'operator', auth: 'agent' });
  await h.invoke('workspace', { layout: 2, order: [result.pane.key, 'saved/$1'], slots: [result.pane.key, 'saved/$1'], active: result.pane.key });
  assert.deepEqual(h.get().store.data.workspace.order, ['saved/$1']); assert.deepEqual(h.get().store.data.workspace.slots, [null, 'saved/$1']); assert.equal(h.get().store.data.workspace.active, '');
  await h.invoke('close', result.pane.key); await h.invoke('workspace', { order: [result.pane.key] }); assert.equal(h.get().store.data.workspace.order.length, 0);
});
test('same-ID promotion preserves the live shell, generic endpoint and output events without saving its secret', async t => {
  const h = await fixture(t, { promptPassword: true }), task = h.start(), prompt = await h.prompt(); await h.reply(prompt, 'fixture-password', false); const result = await task, remote = h.remotes[0], disconnects = remote.disconnects;
  await h.invoke('open', result.pane.key); const saved = await h.invoke('quickConnectSave', result.profile.id, 'Core switch');
  assert.equal(saved.id, result.profile.id); assert.equal(saved.terminalType, 'generic'); assert.equal(saved.sessionMode, 'standard'); assert.equal(saved.rememberPassword, false); assert.equal(h.get().quickEntries.size, 0); assert.equal(remote.disconnects, disconnects); assert.equal(remote.views.has(result.pane.key), true); assert.equal(h.get().store.data.profiles[0].id, saved.id); assert.deepEqual(h.passwords, []);
  remote.emit('output', result.pane.key, Buffer.from('continued output')); h.get().output.flush(result.pane.key); assert.ok(h.events.some(e => e.type === 'output' && e.key === result.pane.key));
  assert.equal(JSON.stringify(h.get().store.data).includes('fixture-password'), false);
});
test('failed Save connection preserves temporary status and the authenticated shell atomically', async t => {
  const h = await fixture(t), result = await h.start(), remote = h.remotes[0], prior = fs.readFileSync(h.get().store.file); const save = h.get().store.save;
  h.get().store.save = () => { throw new Error('Synthetic atomic Save failure.'); }; await assert.rejects(h.invoke('quickConnectSave', result.profile.id, 'Save fails'), /Save failure/);
  h.get().store.save = save; assert.equal(h.get().store.data.profiles.length, 0); assert.equal(h.get().quickEntries.size, 1); assert.equal(remote.connected, true); assert.deepEqual(fs.readFileSync(h.get().store.file), prior);
});
test('promotion rejects pending authentication, expired temporary IDs and malformed names', async t => {
  const gate = deferred(), h = await fixture(t, { connectGate: gate }), task = h.start(); const id = [...h.get().quickEntries.keys()][0]; await assert.rejects(h.invoke('quickConnectSave', id, 'too soon'), /Only a connected/);
  gate.resolve(); const result = await task; await assert.rejects(h.invoke('quickConnectSave', id, 'bad\nname'), /connection name/); h.remotes[0].closeView(result.pane.key); await tick(); await assert.rejects(h.invoke('quickConnectSave', id, 'too late'), /Only a connected/);
});
test('new Quick IPC rejects foreign windows, subframes and navigated application frames', async t => {
  const h = await fixture(t); for (const name of ['quickConnect', 'quickConnectDefaults', 'quickConnectClearHistory', 'quickConnectSave']) {
    const handler = h.handlers.get('nerdsshell:' + name); for (const event of [{ sender: {}, senderFrame: h.window.webContents.mainFrame }, { sender: h.window.webContents, senderFrame: { url: 'nerdsshell://app/ui/index.html' } }, { sender: h.window.webContents, senderFrame: h.window.webContents.mainFrame }]) { const old = h.window.webContents.mainFrame.url; if (event.senderFrame === h.window.webContents.mainFrame && event.sender === h.window.webContents) h.window.webContents.mainFrame.url = 'https://untrusted.invalid/'; await assert.rejects(handler(event), /Untrusted/); h.window.webContents.mainFrame.url = old; }
  } assert.equal(h.remotes.length, 0); assert.equal(h.get().quickEntries.size, 0);
});

test('pending network failure reports its original error and releases its reserved identity', async t => {
  const gate = deferred(), h = await fixture(t, { connectGate: gate }), task = h.start();
  h.remotes[0].emit('disconnected', new Error('Synthetic refused connection.')); gate.resolve();
  await assert.rejects(task, /refused connection/); assert.equal(h.get().connections.size, 0); assert.equal(h.get().quickEntries.size, 0); assert.equal(h.get().viewBudget.pending.size, 0);
});
test('approved host pins are reused by the next temporary connection without a new profile', async t => {
  const h = await fixture(t, { trust: true }), first = h.start(), prompt = await h.prompt(); await h.reply(prompt, 'trust'); const initial = await first;
  await h.invoke('close', initial.pane.key); const count = h.events.filter(e => e.kind === 'host-trust').length;
  const second = await h.start(); assert.equal(h.events.filter(e => e.kind === 'host-trust').length, count); assert.notEqual(second.profile.id, initial.profile.id); assert.equal(h.get().store.data.profiles.length, 0);
});


test('retained temporary pane metadata caps extra-shell creation before an SSH channel opens', async t => {
  const h = await fixture(t), result = await h.start(), entry = h.get().quickEntries.get(result.profile.id);
  for (let n = 0; n < 63; n++) entry.panes.set(result.profile.id + '/standard-ended-' + n, { ...result.pane, key: result.profile.id + '/standard-ended-' + n, dead: true });
  const created = h.remotes[0].shells.size;
  await assert.rejects(h.invoke('create', result.profile.id, 'Extra shell', false), /including ended transcripts/);
  assert.equal(h.remotes[0].shells.size, created); assert.equal(h.get().quickViewReservations.size, 0);
  await assert.rejects(h.start('another'), /including ended transcripts/); assert.equal(h.remotes.length, 1);
});


test('active generic renderer reload preserves its shell, resets only view identity and rejects queued input', async t => {
  const h = await fixture(t, { realStandardViews: true }), result = await h.start(), remote = h.remotes[0];
  await h.invoke('open', result.pane.key); const record = remote.shells.get(result.pane.key), originalView = remote.views.get(result.pane.key), oldSnapshots = h.events.filter(e => e.type === 'snapshot').length;
  remote.emit('output', result.pane.key, Buffer.from('old page data')); h.get().output.flush(result.pane.key); const oldState = h.get().output.states.get(result.pane.key);
  const gate = deferred(); record.tail = gate.promise; const staleInput = h.invoke('input', result.pane.key, 'never replay'); staleInput.catch(() => {});
  h.window.webContents.emit('did-start-loading'); assert.equal(remote.connected, true); assert.equal(remote.disconnects, 0); assert.equal(remote.shells.get(result.pane.key), record); assert.equal(record.paused, true); assert.equal(record.stream.pauses, 1);
  assert.notEqual(remote.views.get(result.pane.key), originalView); assert.equal(remote.views.get(result.pane.key).initialized, false); assert.equal(h.get().output.states.has(result.pane.key), false);
  const duringLoad = h.invoke('open', result.pane.key); let opened = false; duringLoad.then(() => { opened = true; }); await tick(); assert.equal(opened, false); assert.equal(h.events.filter(e => e.type === 'snapshot').length, oldSnapshots); gate.resolve(); await assert.rejects(staleInput, /Queued input was discarded/); assert.deepEqual(record.stream.writes, []);
  h.window.webContents.emit('did-finish-load'); const state = await h.invoke('state'), current = state.profiles.find(p => p.id === result.profile.id); assert.equal(current.quickState.state, 'connected'); assert.equal(current.quickPanes[0].key, result.pane.key);
  await duringLoad; assert.equal(h.events.filter(e => e.type === 'snapshot').length, oldSnapshots + 1); assert.equal(h.events.filter(e => e.type === 'snapshot').at(-1).data, ''); assert.equal(record.paused, false); assert.equal(remote.shells.get(result.pane.key), record); assert.equal(h.remotes.length, 1);
  remote.emit('output', result.pane.key, Buffer.from('fresh page data')); h.get().output.flush(result.pane.key); const fresh = h.get().output.states.get(result.pane.key); assert.notEqual(fresh.epoch, oldState.epoch); await h.invoke('ack', result.pane.key, oldState.epoch, oldState.sequence); assert.equal(fresh.inflight, true);
  const view = remote.views.get(result.pane.key), snapshots = h.events.filter(e => e.type === 'snapshot').length; await h.invoke('open', result.pane.key); assert.equal(remote.views.get(result.pane.key), view); assert.equal(h.events.filter(e => e.type === 'snapshot').length, snapshots);
  await h.invoke('input', result.pane.key, 'fresh input'); assert.deepEqual(record.stream.writes, ['fresh input']); assert.equal(h.get().quickEntries.size, 1); assert.equal(h.get().quickViewReservations.size, 0); assert.equal(h.get().viewBudget.pending.size, 0);
});
test('saved generic promotion exposes runtime-only reload metadata without persisting live panes', async t => {
  const h = await fixture(t, { realStandardViews: true }), result = await h.start(), remote = h.remotes[0]; await h.invoke('open', result.pane.key);
  const saved = await h.invoke('quickConnectSave', result.profile.id, 'Promoted router'), record = remote.shells.get(result.pane.key); h.window.webContents.emit('did-start-loading');
  assert.equal(record.paused, true); assert.equal(h.get().quickEntries.size, 0); h.window.webContents.emit('did-finish-load'); const state = await h.invoke('state'), published = state.profiles.find(p => p.id === saved.id);
  assert.equal(published.temporary, undefined); assert.equal(published.quickState.state, 'connected'); assert.equal(published.quickPanes[0].key, result.pane.key); assert.equal('quickPanes' in h.get().store.data.profiles[0], false); assert.equal('quickState' in JSON.parse(fs.readFileSync(h.get().store.file)).profiles[0], false);
  await h.invoke('open', result.pane.key); assert.equal(record.paused, false); assert.equal(remote.shells.get(result.pane.key), record); assert.equal(h.remotes.length, 1); assert.equal(remote.disconnects, 0);
});


test('generic opening before did-finish-load waits once, joins duplicates and cleans every wait resource', async t => {
  const h = await fixture(t, { realStandardViews: true }), result = await h.start(), remote = h.remotes[0]; await h.invoke('open', result.pane.key);
  const shell = remote.shells.get(result.pane.key), before = { close: remote.client.listenerCount('close'), disconnected: remote.listenerCount('disconnected'), ended: remote.listenerCount('ended') };
  h.window.webContents.emit('did-start-loading'); const snapshots = h.events.filter(e => e.type === 'snapshot').length;
  const first = h.invoke('open', result.pane.key), second = h.invoke('open', result.pane.key); let resolved = 0; first.then(() => { resolved++; }); second.then(() => { resolved++; });
  await tick(); assert.equal(resolved, 0); assert.equal(h.events.filter(e => e.type === 'snapshot').length, snapshots); assert.equal(h.get().genericOpenWaits.size, 1); assert.equal(h.get().genericWaitTransports.size, 1);
  h.window.webContents.emit('did-finish-load'); await Promise.all([first, second]); assert.equal(resolved, 2); assert.equal(h.events.filter(e => e.type === 'snapshot').length, snapshots + 1); assert.equal(remote.shells.get(result.pane.key), shell); assert.equal(remote.disconnects, 0); assert.equal(h.remotes.length, 1);
  assert.equal(h.get().genericOpenWaits.size, 0); assert.equal(h.get().genericWaitTransports.size, 0); assert.equal(remote.client.listenerCount('close'), before.close); assert.equal(remote.listenerCount('disconnected'), before.disconnected); assert.equal(remote.listenerCount('ended'), before.ended);
});
test('pending generic opening has a bounded timeout and later finished-load cannot revive it', async t => {
  const h = await fixture(t, { realStandardViews: true, fastReloadTimeout: true }), result = await h.start(); await h.invoke('open', result.pane.key); h.window.webContents.emit('did-start-loading');
  const pending = h.invoke('open', result.pane.key); await assert.rejects(pending, /too long to reload/); const snapshots = h.events.filter(e => e.type === 'snapshot').length; h.window.webContents.emit('did-finish-load'); await tick(); assert.equal(h.events.filter(e => e.type === 'snapshot').length, snapshots); assert.equal(h.get().genericOpenWaits.size, 0); assert.equal(h.get().genericWaitTransports.size, 0); assert.equal(h.remotes[0].connected, true);
});
test('later navigation, renderer exit and destruction invalidate a pending generic open', async t => {
  for (const event of ['did-start-loading', 'render-process-gone', 'destroyed']) {
    const h = await fixture(t, { realStandardViews: true }), result = await h.start(); await h.invoke('open', result.pane.key); h.window.webContents.emit('did-start-loading'); const pending = h.invoke('open', result.pane.key); pending.catch(() => {}); const snapshots = h.events.filter(e => e.type === 'snapshot').length;
    h.window.webContents.emit(event); await assert.rejects(pending, /navigation|process exited|destroyed/); h.window.webContents.emit('did-finish-load'); await tick(); assert.equal(h.events.filter(e => e.type === 'snapshot').length, snapshots); assert.equal(h.get().genericOpenWaits.size, 0); assert.equal(h.get().genericWaitTransports.size, 0); assert.equal(h.remotes[0].connected, true);
  }
});
test('pending generic open binds its runtime, client, shell, view and current main frame', async t => {
  for (const kind of ['client-close', 'shell-end', 'runtime', 'client', 'shell', 'view', 'frame', 'url', 'quitting']) {
    const h = await fixture(t, { realStandardViews: true }), result = await h.start(), remote = h.remotes[0]; await h.invoke('open', result.pane.key); h.window.webContents.emit('did-start-loading'); const pending = h.invoke('open', result.pane.key); pending.catch(() => {}); const snapshots = h.events.filter(e => e.type === 'snapshot').length;
    if (kind === 'client-close') remote.client.emit('close');
    else if (kind === 'shell-end') remote.closeView(result.pane.key);
    else if (kind === 'runtime') h.get().connections.set(result.profile.id, { ...h.get().connections.get(result.profile.id) });
    else if (kind === 'client') remote.client = new EventEmitter();
    else if (kind === 'shell') remote.shells.set(result.pane.key, { ...remote.shells.get(result.pane.key) });
    else if (kind === 'view') remote.views.set(result.pane.key, { ...remote.views.get(result.pane.key) });
    else if (kind === 'frame') h.window.webContents.mainFrame = { url: 'nerdsshell://app/ui/index.html' };
    else if (kind === 'url') h.window.webContents.mainFrame.url = 'https://untrusted.invalid/';
    else if (kind === 'quitting') h.get().startQuitting();
    h.window.webContents.emit('did-finish-load'); await assert.rejects(pending, /closed|ended|changed|disconnected|view changed|closing/); await tick(); assert.equal(h.events.filter(e => e.type === 'snapshot').length, snapshots); assert.equal(h.get().genericOpenWaits.size, 0); assert.equal(h.get().genericWaitTransports.size, 0);
  }
});


test('a new navigation between finished-load and its open microtask prevents reopening a stale view', async t => {
  const h = await fixture(t, { realStandardViews: true }), result = await h.start(); await h.invoke('open', result.pane.key); h.window.webContents.emit('did-start-loading');
  const pending = h.invoke('open', result.pane.key); pending.catch(() => {}); const snapshots = h.events.filter(e => e.type === 'snapshot').length;
  h.window.webContents.emit('did-finish-load'); h.window.webContents.emit('did-start-loading'); await assert.rejects(pending, /view changed|loading again/); assert.equal(h.events.filter(e => e.type === 'snapshot').length, snapshots); assert.equal(h.get().genericOpenWaits.size, 0); assert.equal(h.get().genericWaitTransports.size, 0);
});

test('300 sequential temporary lifecycles return main registries and credentials to baseline', async t => {
  const h = await fixture(t); for (let n = 0; n < 300; n++) { const result = await h.start('router' + n); await h.invoke('close', result.pane.key); await tick(); assert.equal(h.get().connections.size, 0); assert.equal(h.get().quickEntries.size, 0); assert.equal(h.get().viewBudget.pending.size, 0); assert.equal(h.get().prompts.size, 0); assert.equal(h.get().credentialVersions.size, 0); }
  assert.equal(h.get().store.data.quickConnect.recent.length, 50); assert.equal(h.get().store.data.profiles.length, 0); assert.equal(h.get().pendingQuick, 0); assert.deepEqual(h.passwords, []);
});
