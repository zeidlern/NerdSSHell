'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const appearanceModule = require('../ui/appearance.js');
const source = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../ui/index.html'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
class Node {
  constructor(tag = 'div') {
    Object.assign(this, { tagName: tag.toUpperCase(), children: [], events: {}, attributes: {}, dataset: {}, value: '', checked: false, disabled: false, hidden: false, textContent: '', style: { setProperty() {} }, classes: new Set() });
    this.classList = { toggle: (name, value) => { const enable = value ?? !this.classes.has(name); enable ? this.classes.add(name) : this.classes.delete(name); return enable; }, remove: name => this.classes.delete(name) };
  }
  set innerHTML(_value) { throw new Error('Settings and session labels must render as inert text'); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(name, fn) { (this.events[name] ||= []).push(fn); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  querySelectorAll() { return []; }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; queueMicrotask(() => { for (const fn of this.events.close || []) fn(); }); }
  reportValidity() { this.reported = true; return this.valid !== false; }
  checkValidity() { return this.valid !== false; }
}
function fixture() {
  const nodes = new Map(), calls = { begin: 0, cancel: 0, commit: 0, saves: [], blocked: [], samples: 0 };
  const $ = id => { if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id); };
  const nav = [...html.matchAll(/<button[^>]*data-preference-section="([^"]+)"[^>]*>/g)].map(match => { const n = $('preferenceTab-' + match[1]); n.dataset.preferenceSection = match[1]; return n; });
  const form = $('preferencesForm'); form.elements = {};
  for (const key of [...Object.keys(appearanceModule.baseColors), ...appearanceModule.colorKeys.map(key => 'palette-' + key)]) form.elements[key] = Object.assign(new Node('input'), { type: 'color' });
  for (const key of ['copyOnSelect', 'notificationEnabled', 'notificationAudio', 'notificationDesktop', 'notificationVisual', 'autoConnect', 'record']) form.elements[key] = Object.assign(new Node('input'), { type: 'checkbox' });
  for (const key of ['scrollback', 'archiveMB', 'startup']) form.elements[key] = Object.assign(new Node('input'), { type: key === 'startup' ? 'select' : 'number' });
  $('indexedColor').value = '196';
  const configuration = { custom: [], favoritesByOS: { Windows: ['system.info'] } };
  const api = { savePreferences: async request => { const copy = structuredClone(request); calls.saves.push(copy); return copy; } };
  const panesUI = { async beginConfiguration() { calls.begin++; }, blockConfiguration(value) { calls.blocked.push(value); },
    stageConfiguration() { return structuredClone(configuration); }, commitConfiguration() { calls.commit++; }, cancelConfiguration() { calls.cancel++; } };
  const styles = new Map(), root = { style: { setProperty: (key, value) => styles.set(key, value) } };
  const views = new Map([['test/session', { terminal: { options: {} }, attentionTracker: { sample() { calls.samples++; } } }]]);
  const context = vm.createContext({ ...appearanceModule, $, api, appearance: appearanceModule.appearance(), preferencePalette: appearanceModule.presetPalette(),
    notifications: { enabled: true, audio: true, desktop: true, visual: true }, sessionDefaults: { scrollback: 100000, archiveMB: 256, record: false, startup: 'all', autoConnect: true },
    preferenceSection: 'copy', preferenceGeneration: 0, preferenceSaving: false, preferenceLoaded: false, views,
    BetterSSHAppearance: appearanceModule, window: { BetterSSHPanes: panesUI },
    document: { documentElement: root, querySelectorAll: selector => selector === '[data-preference-section]' ? nav : [], createElement: tag => new Node(tag) },
    renderAttentionIndicators() {}, run: value => value, structuredClone, queueMicrotask });
  // Exercise the actual dialog controller, preview code, and close handler.
  vm.runInContext(source.slice(source.indexOf('function luminance('), source.indexOf('function element(')), context);
  vm.runInContext(source.slice(source.indexOf('function appearanceFields('), source.indexOf('function isAppShortcut(')), context);
  vm.runInContext(source.slice(source.indexOf("$('cancelPreferences').onclick"), source.indexOf("$('help').onclick")), context);
  return { context, $, form, calls, nav, configuration, api, panesUI, styles };
}

test('Preferences navigates real categories without replacing unsaved fields or reloading configuration', async () => {
  const f = fixture(); await f.context.openPreferences('copy');
  assert.equal(f.$('preferencesDialog').open, true); assert.equal(f.calls.begin, 1);
  f.form.elements.copyOnSelect.checked = false;
  f.form.elements.notificationAudio.checked = false;
  for (const category of ['terminal', 'system', 'actions', 'favorites', 'notifications', 'sessions']) {
    await f.context.openPreferences(category);
    assert.equal(f.nav.filter(n => n.attributes['aria-selected'] === 'true').length, 1);
    assert.equal(f.nav.find(n => n.attributes['aria-selected'] === 'true').dataset.preferenceSection, category);
    assert.equal(f.$('preferences-' + category).hidden, false);
    assert.equal(f.form.elements.copyOnSelect.checked, false);
    assert.equal(f.form.elements.notificationAudio.checked, false);
  }
  assert.equal(f.calls.begin, 1); assert.equal(f.calls.saves.length, 0);
  assert.equal(f.context.appearance.copyOnSelect, true); assert.equal(f.context.notifications.audio, true);
});

test('Cancel discards every staged category and restores theme-sensitive branding', async () => {
  const f = fixture(); await f.context.openPreferences('system');
  f.form.elements.uiBackground.value = '#ffffff'; f.form.elements.text.value = '#000000'; f.form.elements.copyOnSelect.checked = false;
  f.form.elements.notificationEnabled.checked = false; f.configuration.custom.push({ id: 'synthetic', code: 'not executed' });
  f.context.previewAppearance();
  assert.equal(f.styles.get('--bg'), '#ffffff'); assert.equal(f.$('brandIcon').src, 'branding/app-light-64.png');
  f.context.closePreferences(); await tick();
  assert.equal(f.$('preferencesDialog').open, false); assert.equal(f.calls.saves.length, 0); assert.ok(f.calls.cancel >= 1);
  assert.equal(f.context.appearance.copyOnSelect, true); assert.equal(f.context.notifications.enabled, true);
  assert.equal(f.styles.get('--bg'), '#242328'); assert.equal(f.$('brandIcon').src, 'branding/app-dark-64.png');
});

test('Save sends one settings transaction and applies the returned canonical values to open sessions', async () => {
  const f = fixture(); await f.context.openPreferences('notifications');
  f.form.elements.copyOnSelect.checked = false; f.form.elements.notificationAudio.checked = false;
  f.form.elements.scrollback.value = '22000'; f.form.elements.archiveMB.value = '128'; f.form.elements.startup.value = 'restore';
  f.configuration.favoritesByOS.Windows = ['system.disk'];
  await f.context.savePreferences(); await tick();
  assert.equal(f.calls.saves.length, 1);
  const saved = f.calls.saves[0];
  assert.equal(saved.appearance.copyOnSelect, false); assert.equal(saved.notifications.audio, false);
  assert.equal(saved.sessionDefaults.scrollback, 22000); assert.equal(saved.sessionDefaults.startup, 'restore');
  assert.deepEqual(saved.actionConfiguration.favoritesByOS.Windows, ['system.disk']);
  assert.equal(f.context.appearance.copyOnSelect, false); assert.equal(f.context.notifications.audio, false);
  assert.equal(f.context.sessionDefaults.scrollback, 22000); assert.equal(f.calls.samples, 1); assert.equal(f.calls.commit, 1);
  assert.equal(f.$('preferencesDialog').open, false);
});

test('Failed settings persistence keeps all drafts open for correction and leaves live settings untouched', async () => {
  const f = fixture(); await f.context.openPreferences('copy');
  f.form.elements.copyOnSelect.checked = false; f.form.elements.uiBackground.value = '#ffffff'; f.context.previewAppearance();
  f.api.savePreferences = async () => { throw new Error('Disk unavailable'); };
  await f.context.savePreferences();
  assert.equal(f.$('preferencesDialog').open, true); assert.equal(f.context.appearance.copyOnSelect, true);
  assert.equal(f.form.elements.copyOnSelect.checked, false); assert.equal(f.form.elements.uiBackground.value, '#ffffff');
  assert.equal(f.$('preferencesStatus').textContent, 'Disk unavailable'); assert.equal(f.calls.commit, 0);
  assert.equal(f.$('savePreferences').disabled, false); assert.equal(f.$('cancelPreferences').disabled, false);
});

test('Save serializes writes and cannot be cancelled halfway through committing settings', async () => {
  const f = fixture(); await f.context.openPreferences(); const disk = deferred(); let writes = 0;
  f.api.savePreferences = async request => { writes++; await disk.promise; return structuredClone(request); };
  const save = f.context.savePreferences();
  assert.equal(f.$('preferencesContent').inert, true); assert.equal(f.$('cancelPreferences').disabled, true);
  f.context.closePreferences(); await f.context.savePreferences();
  assert.equal(writes, 1); assert.equal(f.$('preferencesDialog').open, true);
  disk.resolve(); await save; await tick();
  assert.equal(f.calls.commit, 1); assert.equal(f.$('preferencesDialog').open, false); assert.equal(f.context.preferenceSaving, false);
});

test('Cancelled or obsolete configuration loads cannot enable Save in a newer Preferences opening', async () => {
  const f = fixture(), old = deferred(), current = deferred(); let requests = 0;
  f.panesUI.beginConfiguration = () => ++requests === 1 ? old.promise : current.promise;
  const first = f.context.openPreferences('actions');
  await f.context.savePreferences(); assert.equal(f.calls.saves.length, 0);
  f.context.closePreferences(); const second = f.context.openPreferences('favorites');
  old.resolve(); await first; await tick();
  assert.equal(f.$('preferencesDialog').open, true); assert.equal(f.$('savePreferences').disabled, true);
  assert.equal(f.$('preferences-favorites').hidden, false);
  current.resolve(); await second; assert.equal(f.$('savePreferences').disabled, false);
});

test('new connection defaults apply without changing an existing connection', () => {
  const f = fixture(), form = f.$('connectionForm'); form.elements = {};
  const initial = { scrollback: 100000, archiveMB: 256, startup: 'all', autoConnect: true, record: false, name: '', auth: 'agent' };
  for (const [key, value] of Object.entries(initial)) form.elements[key] = Object.assign(new Node('input'), { type: typeof value === 'boolean' ? 'checkbox' : 'text' });
  form.reset = () => { for (const [key, value] of Object.entries(initial)) { if (typeof value === 'boolean') form.elements[key].checked = value; else form.elements[key].value = value; } };
  f.context.updateSessionMode = () => {};
  vm.runInContext(source.slice(source.indexOf('function editConnection('), source.indexOf('function appearanceFields(')), f.context);
  f.context.sessionDefaults = { scrollback: 44000, archiveMB: 64, startup: 'none', autoConnect: false, record: true };
  f.context.editConnection();
  assert.equal(form.elements.scrollback.value, 44000); assert.equal(form.elements.record.checked, true); assert.equal(form.elements.autoConnect.checked, false);
  f.context.editConnection({ id: 'existing', name: 'Existing', scrollback: 9000, archiveMB: 1024, startup: 'restore', autoConnect: true, record: false });
  assert.equal(form.elements.scrollback.value, 9000); assert.equal(form.elements.archiveMB.value, 1024);
  assert.equal(form.elements.record.checked, false); assert.equal(form.elements.startup.value, 'restore');
});
