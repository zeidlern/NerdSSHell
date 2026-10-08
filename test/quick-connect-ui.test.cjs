'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../ui/quick-connect.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../ui/index.html'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
class Node {
  constructor(tag = 'div') {
    Object.assign(this, { tagName: tag.toUpperCase(), children: [], events: {}, attributes: {}, value: '', hidden: false, checked: false, disabled: false, textContent: '', classes: new Set() });
    this.classList = { contains: name => this.classes.has(name), toggle: (name, value) => { const enable = value ?? !this.classes.has(name); enable ? this.classes.add(name) : this.classes.delete(name); return enable; } };
  }
  set innerHTML(_value) { throw Error('Quick Connect content must be inert text'); }
  setAttribute(name, value) { this.attributes[name] = value; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(name, fn) { (this.events[name] ||= []).push(fn); }
  querySelectorAll() { return this.controls || []; }
  focus() { this.focused = true; }
  select() { this.selected = true; }
  showModal() { this.open = true; }
  close() { this.open = false; this.emit('close'); }
  click() { this.onclick?.(); return this.emit('click'); }
  emit(name, event = {}) { for (const fn of this.events[name] || []) fn({ preventDefault() {}, stopImmediatePropagation() {}, ...event }); }
}
function fixture() {
  const nodes = new Map(), calls = { requests: [], opens: [], defaults: [], clears: 0, disconnects: [], saves: [], closes: [], entries: 0, renders: 0 };
  const $ = id => { if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id); };
  $('quickSettingsForm').controls = ['quickUsername', 'quickPort', 'quickAuth', 'quickKeyPath', 'quickHistoryEnabled', 'quickChooseKey', 'quickClearHistory', 'quickSettingsSave', 'quickSettingsCancel'].map($);
  $('sidebarToggle').onclick = () => $('connectionSidebar').classList.toggle('collapsed');
  const document = { getElementById: $, createElement: tag => new Node(tag), events: {}, querySelector: () => [...nodes.values()].some(node => node.open) ? {} : null,
    addEventListener(name, fn) { (this.events[name] ||= []).push(fn); } };
  const profiles = new Map(), panes = new Map(), views = new Map();
  const api = {
    onEvent(fn) { this.event = fn; },
    quickConnect: async address => {
      calls.requests.push(address);
      const profile = { id: 'quick-fixture', name: 'operator@router.example', host: 'router.example', port: 22, username: 'operator', auth: 'password', sessionMode: 'standard', terminalType: 'generic', temporary: true };
      const pane = { key: profile.id + '/shell', profileId: profile.id, standard: true, dead: false };
      api.event({ type: 'profile', profile }); return { profile, pane };
    },
    quickConnectDefaults: async value => { calls.defaults.push(structuredClone(value)); return { defaults: value, recent: [] }; },
    quickConnectClearHistory: async () => { calls.clears++; return { defaults: { username: 'operator', port: 22, auth: 'password', keyPath: '', historyEnabled: true }, recent: [] }; },
    disconnect: async id => { calls.disconnects.push(id); api.event({ type: 'quick-removed', profileId: id }); },
    quickConnectSave: async (id, name) => { calls.saves.push([id, name]); const saved = { ...profiles.get(id), name, temporary: false }; api.event({ type: 'profile', profile: saved }); return saved; },
    chooseKey: async () => '',
  };
  const context = vm.createContext({ window: { nerdsshell: api }, $, document, profiles, panes, views, selectedProfile: '', statuses: new Map(),
    maxOpenViews: 64, pendingViewSlots: 0, newSessionTarget: null, promptId: null, promptProfileId: null,
    openPane: async key => { calls.opens.push(key); views.set(key, { pane: panes.get(key) }); },
    renderConnections: () => { calls.renders++; }, renderTabs() {}, syncFiles() {}, render() {},
    entry: async () => { calls.entries++; return 'Core router'; },
    closeView: async key => { calls.closes.push(key); views.delete(key); },
    element: (_tag, _class, text) => Object.assign(new Node(), { textContent: text }),
    button: (text, action) => Object.assign(new Node(), { textContent: text, action }), connected: () => true,
    label: pane => pane.sessionName || pane.key, sessionRow: pane => Object.assign(new Node(), { textContent: pane.key }),
    run: value => value, api, structuredClone,
  });
  vm.runInContext(app.slice(app.indexOf('function requireViewCapacity('), app.indexOf('\nconst activeTransfers')), context);
  vm.runInContext(source, context);
  vm.runInContext(app.slice(app.indexOf('api.onEvent(event => {'), app.indexOf("$('connectionForm').addEventListener")), context);
  const quick = context.window.NerdSSHellQuick;
  return { context, $, calls, api, document, quick, profiles, panes, views, initialize: value => quick.initialize(value || { defaults: { username: 'operator', port: 22, auth: 'password', keyPath: '', historyEnabled: true }, recent: [] }) };
}
function submit(f, address) { f.$('quickAddress').value = address; f.$('quickConnectForm').emit('submit'); }

test('Quick Connect starts disabled until main state initializes and opens a direct temporary shell', async () => {
  const f = fixture(); assert.equal(f.$('quickConnect').disabled, true); submit(f, 'router.example'); await tick(); assert.equal(f.calls.requests.length, 0);
  f.initialize(); submit(f, '  router.example  '); await tick();
  assert.deepEqual(f.calls.requests, ['  router.example  ']); assert.deepEqual(f.calls.opens, ['quick-fixture/shell']);
  assert.equal(f.context.selectedProfile, 'quick-fixture'); assert.equal(f.$('quickAddress').value, ''); assert.equal(f.$('quickConnect').disabled, false);
  assert.equal(f.context.pendingViewSlots, 0); assert.equal(f.profiles.get('quick-fixture').temporary, true);
});

test('blank input gives a local error without allocating or connecting', async () => {
  const f = fixture(); f.initialize(); submit(f, '   '); await tick();
  assert.deepEqual(f.calls.requests, []); assert.equal(f.$('quickAddress').focused, true); assert.equal(f.$('quickStatus').classList.contains('error'), true);
});

test('pending submissions capture the address once, reject double Enter and retain their view reservation', async () => {
  const f = fixture(); f.initialize(); const wait = deferred();
  f.api.quickConnect = address => { f.calls.requests.push(address); return wait.promise; };
  submit(f, 'first.example'); submit(f, 'second.example'); await tick();
  assert.deepEqual(f.calls.requests, ['first.example']); assert.equal(f.context.pendingViewSlots, 1); assert.equal(f.$('quickSettings').disabled, true);
  wait.reject(Error('Canceled fixture')); await tick();
  assert.equal(f.context.pendingViewSlots, 0); assert.equal(f.$('quickConnect').disabled, false); assert.equal(f.$('quickAddress').value, 'second.example');
});

test('full retained-tab budget prevents any main quick connection request', async () => {
  const f = fixture(); f.initialize(); for (let i = 0; i < 64; i++) f.views.set('existing/' + i, {});
  submit(f, 'router.example'); await tick(); assert.deepEqual(f.calls.requests, []); assert.match(f.$('quickStatus').textContent, /64 open terminal/);
});

test('main validation errors stay beside the address and retain it for correction', async () => {
  const f = fixture(); f.initialize(); f.api.quickConnect = async () => { throw Error("Error invoking remote method 'nerdsshell:quickConnect': Error: Invalid address"); };
  submit(f, 'bad fixture'); await tick(); assert.equal(f.$('quickStatus').textContent, 'Invalid address'); assert.equal(f.$('quickAddress').value, 'bad fixture');
});

test('cancel uses the captured temporary ID and a delayed successful result cannot recreate it', async () => {
  const f = fixture(); f.initialize(); const wait = deferred();
  const profile = { id: 'quick-canceled', host: 'router.example', temporary: true }, pane = { key: 'quick-canceled/shell', profileId: profile.id };
  f.api.quickConnect = () => { f.api.event({ type: 'profile', profile }); return wait.promise; };
  submit(f, 'router.example'); await tick(); assert.equal(f.$('quickCancel').hidden, false);
  f.$('quickCancel').emit('click'); await tick(); wait.resolve({ profile, pane }); await tick();
  assert.deepEqual(f.calls.disconnects, ['quick-canceled']); assert.deepEqual(f.calls.opens, []); assert.equal(f.profiles.has(profile.id), false); assert.equal(f.panes.has(pane.key), false);
});

test('unsolicited or late temporary profile events cannot resurrect a finished connection', async () => {
  const f = fixture(); f.initialize(); f.api.event({ type: 'profile', profile: { id: 'stale', temporary: true } }); assert.equal(f.profiles.has('stale'), false);
  submit(f, 'router.example'); await tick(); f.api.event({ type: 'quick-removed', profileId: 'quick-fixture' });
  f.api.event({ type: 'profile', profile: { id: 'quick-fixture', temporary: true } }); assert.equal(f.profiles.has('quick-fixture'), false);
});

test('Ctrl+Alt+Q expands and focuses/selects the address but respects active modal dialogs', () => {
  const f = fixture(); f.initialize(); f.$('connectionSidebar').classList.toggle('collapsed', true);
  let prevented = 0, stopped = 0;
  const event = { ctrlKey: true, altKey: true, key: 'Q', preventDefault: () => prevented++, stopImmediatePropagation: () => stopped++ };
  for (const fn of f.document.events.keydown) fn(event);
  assert.equal(f.$('connectionSidebar').classList.contains('collapsed'), false); assert.equal(f.$('quickAddress').focused, true); assert.equal(f.$('quickAddress').selected, true);
  assert.equal(prevented, 1); assert.equal(stopped, 1);
  f.$('quickAddress').focused = false; f.$('quickSettingsDialog').showModal();
  for (const fn of f.document.events.keydown) fn(event); assert.equal(f.$('quickAddress').focused, false);
  vm.runInContext(app.slice(app.indexOf('function isAppShortcut('), app.indexOf('api.onEvent(event => {')), f.context);
  assert.equal(f.context.isAppShortcut(event), true, 'xterm reserves this accelerator for the app');
});

test('recent successful destinations format account, IPv6 and port as inert native autocomplete values', () => {
  const f = fixture(); f.initialize({ defaults: { historyEnabled: true }, recent: [{ username: 'netops', host: 'router.example', port: 22 }, { username: 'ops', host: '2001:db8::1', port: 2222 }] });
  assert.deepEqual(f.$('quickRecent').children.map(n => n.value), ['netops@router.example', 'ops@[2001:db8::1]:2222']);
  f.quick.update({ defaults: { historyEnabled: false }, recent: [{ username: 'ops', host: 'hidden.example', port: 22 }] });
  assert.equal(f.$('quickRecent').children.length, 0);
});

test('settings save only nonsecret defaults, discard an irrelevant key path and never submit an endpoint', async () => {
  const f = fixture(); f.initialize(); f.$('quickSettings').emit('click');
  f.$('quickUsername').value = ' netops '; f.$('quickPort').value = '2222'; f.$('quickAuth').value = 'password'; f.$('quickKeyPath').value = 'C:\\old-key'; f.$('quickHistoryEnabled').checked = false;
  f.$('quickSettingsForm').emit('submit'); await tick();
  assert.deepEqual(f.calls.defaults, [{ username: 'netops', port: 2222, auth: 'password', keyPath: '', historyEnabled: false }]);
  assert.equal(f.$('quickSettingsDialog').open, false); assert.deepEqual(f.calls.requests, []);
});

test('canceling settings preserves defaults and history clear invokes only the bounded history operation', async () => {
  const f = fixture(); f.initialize({ defaults: { username: 'original', historyEnabled: true }, recent: [{ username: 'ops', host: 'router.example', port: 22 }] });
  f.$('quickSettings').emit('click'); f.$('quickUsername').value = 'changed'; f.$('quickSettingsCancel').emit('click'); f.$('quickSettings').emit('click');
  assert.equal(f.$('quickUsername').value, 'original'); assert.deepEqual(f.calls.defaults, []);
  f.$('quickClearHistory').emit('click'); await tick(); assert.equal(f.calls.clears, 1); assert.equal(f.$('quickRecent').children.length, 0);
});

test('settings validation failure keeps the dialog editable and suppresses duplicate save requests', async () => {
  const f = fixture(); f.initialize(); f.$('quickSettings').emit('click'); const wait = deferred(); let saves = 0;
  f.api.quickConnectDefaults = () => { saves++; return wait.promise; };
  f.$('quickSettingsForm').emit('submit'); f.$('quickSettingsForm').emit('submit'); assert.equal(saves, 1);
  wait.reject(Error('Invalid port')); await tick(); assert.equal(f.$('quickSettingsDialog').open, true); assert.equal(f.$('quickSettingsError').textContent, 'Invalid port'); assert.equal(f.$('quickSettingsSave').disabled, false);
});

test('a delayed private-key picker cannot populate a closed and reopened defaults dialog', async () => {
  const f = fixture(); f.initialize(); f.$('quickSettings').emit('click'); f.$('quickAuth').value = 'key';
  const wait = deferred(); f.api.chooseKey = () => wait.promise; f.$('quickChooseKey').emit('click');
  f.$('quickSettingsDialog').close(); f.$('quickSettings').emit('click'); f.$('quickAuth').value = 'key'; wait.resolve('C:\\fixture-key'); await tick();
  assert.equal(f.$('quickKeyPath').value, '');
});

test('Save connection promotes the same identity and pane without launching another shell', async () => {
  const f = fixture(); f.initialize(); submit(f, 'router.example'); await tick();
  const pane = f.panes.get('quick-fixture/shell'), view = f.views.get(pane.key);
  await f.quick.saveConnection('quick-fixture');
  assert.deepEqual(f.calls.saves, [['quick-fixture', 'Core router']]); assert.equal(f.profiles.get('quick-fixture').temporary, false);
  assert.equal(f.panes.get(pane.key), pane); assert.equal(f.views.get(pane.key), view); assert.equal(f.calls.opens.length, 1);
});

test('a connection removed during naming cannot be saved and duplicate Save does not open two prompts', async () => {
  const f = fixture(); f.initialize(); submit(f, 'router.example'); await tick(); const wait = deferred();
  f.context.entry = () => { f.calls.entries++; return wait.promise; };
  const save = f.quick.saveConnection('quick-fixture'); await f.quick.saveConnection('quick-fixture'); assert.equal(f.calls.entries, 1);
  f.api.event({ type: 'quick-removed', profileId: 'quick-fixture' }); wait.resolve('Fixture'); await save; assert.deepEqual(f.calls.saves, []);
});

test('Close transcript routes retained views through existing safe close and releases metadata only after closure', async () => {
  const f = fixture(); f.initialize(); submit(f, 'router.example'); await tick();
  f.context.closeView = async key => { f.calls.closes.push(key); }; await f.quick.closeConnection('quick-fixture');
  assert.deepEqual(f.calls.disconnects, [], 'Refused Standard close preserves the original transport');
  f.context.closeView = async key => { f.calls.closes.push(key); f.views.delete(key); }; await f.quick.closeConnection('quick-fixture');
  assert.deepEqual(f.calls.disconnects, ['quick-fixture']); assert.equal(f.profiles.has('quick-fixture'), false);
});

test('temporary sidebar offers Save/Disconnect rather than full profile editing, reconnect or remembered passwords', () => {
  const f = fixture(); f.profiles.set('temporary', { id: 'temporary', name: '<router>', host: 'router.example', port: 22, username: 'netops', temporary: true, auth: 'password' });
  f.context.statuses.set('temporary', { state: 'connected' });
  vm.runInContext(app.slice(app.indexOf('function renderConnections('), app.indexOf('function renderTabs(')), f.context); f.context.renderConnections();
  const flatten = nodes => nodes.flatMap(n => [n, ...flatten(n.children)]);
  const labels = flatten(f.$('connections').children).map(n => n.textContent);
  assert.ok(labels.includes('Quick connections')); assert.ok(labels.includes('Save connection')); assert.ok(labels.includes('Disconnect'));
  assert.equal(labels.includes('⋯'), false); assert.equal(labels.includes('Forget password'), false); assert.equal(labels.includes('+ New'), false);
  f.context.statuses.set('temporary', { state: 'disconnected' }); f.context.renderConnections();
  const ended = flatten(f.$('connections').children).map(n => n.textContent); assert.ok(ended.includes('Close transcript')); assert.equal(ended.includes('Connect'), false);
});

test('saved generic editing retains network-device type and new windows cannot enable persistence', async () => {
  const f = fixture(); const form = f.$('connectionForm'); form.elements = {};
  for (const name of ['id', 'name', 'terminalType', 'sessionMode', 'auth']) form.elements[name] = new Node('input');
  form.elements.auth.value = 'password'; form.reset = () => {};
  f.context.sessionDefaults = {}; f.context.updateAuthenticationFields = () => {}; f.context.updateSessionMode = () => {};
  vm.runInContext(app.slice(app.indexOf('function editConnection('), app.indexOf('function updateAuthenticationFields(')), f.context);
  f.context.editConnection({ id: 'saved', name: 'Router', terminalType: 'generic', sessionMode: 'standard' });
  assert.equal(form.elements.terminalType.value, 'generic'); assert.equal(f.$('connectionTypeHint').hidden, false);
  f.$('connectionDialog').close(); f.profiles.set('saved', { id: 'saved', name: 'Router', terminalType: 'generic' });
  f.$('newSessionBaud').options = [new Node()]; f.context.newSessionResolve = null;
  vm.runInContext(app.slice(app.indexOf('function chooseNewSession('), app.indexOf('async function newSession(')), f.context);
  const choice = f.context.chooseNewSession('saved'); assert.equal(f.$('newSessionPersistence').hidden, true); assert.equal(f.$('newSessionPersistent').checked, false);
  f.$('newSessionPersistent').checked = true; f.context.finishNewSession(true); assert.equal((await choice).persistent, false);
});

test('static Quick Connect resources are local, above connections and expose only the named operations', () => {
  assert.ok(html.indexOf('id="quickConnectArea"') < html.indexOf('id="connections"'));
  assert.match(html, /list="quickRecent"/); assert.match(html, /src="quick-connect.js"/); assert.match(html, /href="quick-connect.css"/);
  assert.equal(/name="password"|id="quickPassword"/.test(html.slice(html.indexOf('id="quickSettingsDialog"'), html.indexOf('id="connectionDialog"'))), false);
  const preload = fs.readFileSync(path.join(__dirname, '../src/preload.cjs'), 'utf8');
  for (const name of ['quickConnect', 'quickConnectDefaults', 'quickConnectClearHistory', 'quickConnectSave']) assert.ok(preload.includes("'" + name + "'"));
  assert.match(fs.readFileSync(path.join(__dirname, '../ui/quick-connect.css'), 'utf8'), /#connectionSidebar\.collapsed #quickConnectArea\{display:none\}/);
});

test('recent default-port destinations retain their exact port when Quick login defaults change', () => {
  const f = fixture(); f.initialize({ defaults: { port: 2222 }, recent: [{ username: 'ops', host: 'router.example', port: 22 }, { username: 'ops', host: '2001:db8::2', port: 2222 }] });
  assert.deepEqual(f.$('quickRecent').children.map(n => n.value), ['ops@router.example:22', 'ops@[2001:db8::2]']);
});

test('a late Save result cannot overwrite a newer saved profile event', async () => {
  const f = fixture(); f.initialize(); submit(f, 'router.example'); await tick(); const wait = deferred();
  f.api.quickConnectSave = () => wait.promise;
  const save = f.quick.saveConnection('quick-fixture'); await tick();
  const newer = { ...f.profiles.get('quick-fixture'), temporary: false, name: 'Newer edit' }; f.api.event({ type: 'profile', profile: newer });
  wait.resolve({ ...newer, name: 'Older promotion' }); await save;
  assert.equal(f.profiles.get('quick-fixture').name, 'Newer edit');
});

test('generic tab and session labels show the exact account and endpoint while server names stay unchanged', () => {
  const f = fixture(); f.profiles.set('router', { terminalType: 'generic', host: '2001:db8::1', username: 'netops', port: 2222 });
  vm.runInContext(app.slice(app.indexOf('function label('), app.indexOf('function connected(')), f.context);
  assert.equal(f.context.label({ profileId: 'router', sessionName: 'Shell' }), 'netops@[2001:db8::1]:2222');
  assert.equal(f.context.label({ profileId: 'router', sessionName: 'Interface check' }), 'netops@[2001:db8::1]:2222 / Interface check');
  assert.equal(f.context.label({ profileId: 'server', sessionName: 'My job' }), 'My job');
});

test('temporary disconnect retains an ended read-only transcript that can be selected without reconnect', async () => {
  const f = fixture(); f.initialize(); submit(f, 'router.example'); await tick();
  const key = 'quick-fixture/shell', view = f.views.get(key);
  Object.assign(view, { generation: 0, ready: true, state: new Node(), filesAttached: true });
  f.api.event({ type: 'status', profileId: 'quick-fixture', state: 'disconnected', detail: 'Disconnected fixture' });
  assert.equal(view.pane.dead, true); assert.equal(view.ready, false); assert.equal(f.panes.get(key).dead, true);
  assert.equal(f.profiles.has('quick-fixture'), true); assert.equal(f.views.get(key), view);
});

test('renderer reload restores the same temporary and saved generic live panes without connecting or creating shells', async () => {
  const profiles = new Map(), panes = new Map(), statuses = new Map(), opened = [], connected = [];
  const context = vm.createContext({ profiles, panes, statuses, desiredActive: '', order: [], savedSlots: [], slots: [], active: '', render() {}, connected: id => statuses.get(id)?.state === 'connected',
    openPane: async key => opened.push(key), connectProfile: async id => connected.push(id), message: text => { throw Error(text); } });
  vm.runInContext(app.slice(app.indexOf('function hasGenericRuntime('), app.indexOf("window.addEventListener('beforeunload'")), context);
  const temporaryPane = { key: 'quick-live/original-shell', profileId: 'quick-live', dead: false };
  const savedPane = { key: 'saved-live/original-shell', profileId: 'saved-live', dead: false };
  const savedDead = { key: 'saved-live/ended-shell', profileId: 'saved-live', dead: true };
  context.initializeProfiles([
    { id: 'quick-live', terminalType: 'generic', temporary: true, quickState: { state: 'connected' }, quickPanes: [temporaryPane] },
    { id: 'saved-live', terminalType: 'generic', autoConnect: true, quickState: { state: 'connected' }, quickPanes: [savedPane, savedDead] },
    { id: 'quick-ended', terminalType: 'generic', temporary: true, quickState: { state: 'disconnected' }, quickPanes: [{ key: 'quick-ended/shell', profileId: 'quick-ended', dead: true }] },
  ]);
  await context.restoreConnectionViews();
  assert.deepEqual(opened, [temporaryPane.key, savedPane.key]); assert.deepEqual(connected, []);
  assert.equal(panes.get(temporaryPane.key), temporaryPane); assert.equal(panes.get(savedPane.key), savedPane);
  assert.equal(statuses.get('saved-live').state, 'connected');
});

test('runtime reload skips stale or foreign panes and preserves normal saved server and local startup flows', async () => {
  const profiles = new Map(), panes = new Map(), statuses = new Map(), opened = [], connected = [];
  const context = vm.createContext({ profiles, panes, statuses, desiredActive: '', order: [], savedSlots: [], slots: [], active: '', render() {}, connected: id => statuses.get(id)?.state === 'connected',
    openPane: async key => opened.push(key), connectProfile: async id => connected.push(id), message: text => { throw Error(text); } });
  vm.runInContext(app.slice(app.indexOf('function hasGenericRuntime('), app.indexOf("window.addEventListener('beforeunload'")), context);
  const stale = { key: 'saved-live/stale-shell', profileId: 'saved-live', dead: false };
  context.initializeProfiles([
    { id: 'saved-live', terminalType: 'generic', quickState: { state: 'connected' }, quickPanes: [stale, { key: 'other/foreign', profileId: 'other', dead: false }] },
    { id: 'server', terminalType: 'server', autoConnect: true },
    { id: 'local:cmd', local: true, autoConnect: true },
    { id: 'generic-cold', terminalType: 'generic', autoConnect: true },
    { id: 'manual', terminalType: 'server', autoConnect: false },
  ]);
  panes.set(stale.key, { ...stale, dead: true });
  await context.restoreConnectionViews();
  assert.deepEqual(opened, []); assert.deepEqual(connected, ['server', 'local:cmd', 'generic-cold']);
});

test('two live saved generic panes restore the saved active destination and layout without a replacement shell', async () => {
  const profiles = new Map(), panes = new Map(), statuses = new Map(), opened = [], connected = [];
  const first = { key: 'saved-first/original-shell', profileId: 'saved-first', dead: false };
  const second = { key: 'saved-second/original-shell', profileId: 'saved-second', dead: false };
  let renders = 0;
  const context = vm.createContext({ profiles, panes, statuses, desiredActive: second.key, order: [], savedSlots: [first.key, second.key], slots: [], active: '',
    connected: id => statuses.get(id)?.state === 'connected',
    openPane: async key => { opened.push(key); context.order.push(key); if (!context.active) context.active = key; },
    connectProfile: async id => connected.push(id), render: () => { renders++; }, message: text => { throw Error(text); } });
  vm.runInContext(app.slice(app.indexOf('function hasGenericRuntime('), app.indexOf("window.addEventListener('beforeunload'")), context);
  context.initializeProfiles([
    { id: first.profileId, terminalType: 'generic', autoConnect: true, quickState: { state: 'connected' }, quickPanes: [first] },
    { id: second.profileId, terminalType: 'generic', autoConnect: true, quickState: { state: 'connected' }, quickPanes: [second] },
  ]);
  await context.restoreConnectionViews();
  assert.deepEqual(opened, [first.key, second.key]); assert.deepEqual(connected, []);
  assert.equal(context.active, second.key); assert.equal(context.desiredActive, '');
  assert.deepEqual(Array.from(context.slots), [first.key, second.key]); assert.equal(renders, 1);
});

test('address paste rejects multiline inventory and control characters before native text-input normalization', () => {
  const f = fixture(); f.initialize(); f.$('quickAddress').value = 'keep-this.example';
  for (const text of ['router-one\nrouter-two', 'router-one\r\nrouter-two', 'router-one\rrouter-two', 'router.example\t', 'router.example\0', 'router.example\x7f']) {
    let prevented = 0;
    f.$('quickAddress').emit('paste', { clipboardData: { getData: format => { assert.equal(format, 'text/plain'); return text; } }, preventDefault: () => { prevented++; } });
    assert.equal(prevented, 1, 'Rejected control input must never reach the native insertion step');
    assert.equal(f.$('quickAddress').value, 'keep-this.example'); assert.equal(f.$('quickStatus').classList.contains('error'), true);
    assert.match(f.$('quickStatus').textContent, /one IP address.*line breaks/);
  }
  assert.deepEqual(f.calls.requests, []);
});

test('ordinary single-destination paste retains native text editing and raw address submission', async () => {
  const f = fixture(); f.initialize(); let prevented = 0;
  f.$('quickAddress').emit('paste', { clipboardData: { getData: () => '  router.example  ' }, preventDefault: () => { prevented++; } });
  assert.equal(prevented, 0, 'The normal text input handles insertion, selection and undo');
  f.$('quickAddress').value = '  router.example  '; f.$('quickConnectForm').emit('submit'); await tick();
  assert.deepEqual(f.calls.requests, ['  router.example  ']); assert.equal(f.calls.opens.length, 1);
});

test('submission preserves a raw tab or control suffix for authoritative main validation', async () => {
  const f = fixture(); f.initialize();
  f.api.quickConnect = async value => { f.calls.requests.push(value); throw Error('Enter one destination without control characters.'); };
  submit(f, 'router.example\t'); await tick();
  assert.deepEqual(f.calls.requests, ['router.example\t']); assert.match(f.$('quickStatus').textContent, /control characters/);
  assert.equal(f.$('quickAddress').value, 'router.example\t');
});
