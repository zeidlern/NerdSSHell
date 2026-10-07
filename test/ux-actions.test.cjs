'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { installWorkbench } = require('../src/workbench.cjs');
const { validateSettings, configuredActions, compileConfigured, previewFacts, favoriteIds } = require('../src/action-settings.cjs');
const customId = 'custom.01234567-1234-1234-1234-0123456789ab';
const custom = { id: customId, os: 'Ubuntu', title: 'Inspect test marker', code: 'printf original' };
const vm = require('node:vm'), fs = require('node:fs');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function fixture() {
  const handlers = {}, calls = [], panes = new Map([
    ['a/persistent', { key: 'a/persistent', sessionToken: 'persistent-one' }],
    ['a/standard-one', { key: 'a/standard-one', sessionToken: 'standard-one', standard: true }]
  ]);
  const views = new Map([...panes].map(([key, pane]) => [key, { active: true, pane }]));
  const profile = { id: 'a', name: 'Alpha', host: 'alpha.example', username: 'fixture', port: 22, sessionMode: 'standard' };
  const remote = { connected: true, closing: false, views, panes: [...panes.values()], shells: new Map([['a/standard-one', {}]]),
    pane: key => { const pane = panes.get(key); if (!pane) throw Error('Unknown pane'); return pane; },
    isStandard: key => key.includes('/standard-'),
    checked: async () => 'system:Linux\nID=ubuntu\ncap:apt\ncap:sudo\ncap:systemctl\ncap:systemd',
    createTaskFor: async (name, code, persistent) => { calls.push({ name, code, persistent }); return { key: 'a/new-task' }; },
    createTask: () => { throw Error('Wrong provider default'); }, input: () => { throw Error('Must never inject an existing shell'); }
  };
  const connections = new Map([['a', { profile, remote }]]), store = { data: { workbench: { favorites: ['system.disk'] } }, save() {} };
  let confirm = async () => ({ response: 0 });
  installWorkbench({ handle: (name, fn) => { handlers[name] = fn; }, connections, getStore: () => store,
    app: { isPackaged: false, getVersion: () => 'fixture' }, dialog: { showMessageBox: (_window, options) => confirm(options) },
    getWindow: () => null, emit() {}, queueOutput() {}, discardOutput() {}, output: { flush() {} },
    forKey: key => { const r = connections.get(key.split('/')[0]); if (!r?.remote.views.get(key)?.active) throw Error('Inactive source'); return r; }, shellProvider: () => [] });
  return { handlers, calls, store, remote, connections, panes, setConfirm: fn => { confirm = fn; } };
}
test('per-OS configuration strips unrelated payloads and preserves explicit empty favorites', () => {
  const checked = validateSettings({ custom: [custom], favoritesByOS: { Ubuntu: [], Windows: ['system.disk'] }, credentials: 'not retained' });
  assert.deepEqual(Object.keys(checked), ['custom', 'favoritesByOS']);
  assert.deepEqual(favoriteIds(checked, 'Ubuntu'), []);
  assert.deepEqual(favoriteIds(checked, 'Debian', ['system.disk']), ['system.disk']);
});
test('custom action validation rejects controls, identity confusion, oversize bodies and cross-OS favorites', () => {
  for (const changed of [ { id: 'custom.' + '-'.repeat(36) }, { title: 'hidden\u202e' }, { code: 'x'.repeat(8193) }, { code: 'echo\x1b[31m' }, { os: 'unknown' } ]) {
    assert.throws(() => validateSettings({ custom: [{ ...custom, ...changed }] }));
  }
  assert.throws(() => validateSettings({ custom: [custom, custom] }));
  assert.throws(() => validateSettings({ custom: [custom], favoritesByOS: { Windows: [customId] } }));
  assert.throws(() => validateSettings({ favoritesByOS: { Ubuntu: Array(33).fill('system.disk') } }));
  assert.throws(() => validateSettings({ favoritesByOS: JSON.parse('{"__proto__":[]}') }));
});
test('generic Linux custom actions apply to distributions without leaking Windows or Ubuntu-only actions', () => {
  const settings = validateSettings({ custom: [custom, { ...custom, id: customId.replace('0123456789ab', '0123456789ac'), os: 'Linux' }] });
  assert.equal(configuredActions(previewFacts('Ubuntu'), settings).filter(a => a.id.startsWith('custom.')).length, 2);
  assert.equal(configuredActions(previewFacts('Debian'), settings).filter(a => a.id.startsWith('custom.')).length, 1);
  assert.equal(configuredActions(previewFacts('Windows'), settings).filter(a => a.id.startsWith('custom.')).length, 0);
  assert.throws(() => compileConfigured(customId, previewFacts('Windows'), '', settings), /unavailable/);
  assert.throws(() => compileConfigured({}, previewFacts('Ubuntu'), '', settings), /valid action/);
});
test('saving configuration is explicit, legacy favorites survive and failed persistence rolls back', () => {
  const h = fixture();
  const draft = h.handlers.actionConfiguration(); draft.custom.push(custom);
  assert.equal(h.handlers.actionConfiguration().custom.length, 0);
  assert.deepEqual(h.handlers.actionConfiguration().defaults, ['system.disk']);
  h.handlers.actionConfigurationSave(draft);
  assert.equal(h.store.data.actionConfiguration.custom.length, 1);
  const saved = h.store.data.actionConfiguration;
  h.store.save = () => { throw Error('Disk unavailable'); };
  assert.throws(() => h.handlers.actionConfigurationSave({ custom: [], favoritesByOS: {} }), /Disk unavailable/);
  assert.equal(h.store.data.actionConfiguration, saved);
});
test('pane action discovery uses the original destination and returns saved OS favorites', async () => {
  const h = fixture(); h.handlers.actionConfigurationSave({ custom: [custom], favoritesByOS: { Ubuntu: [customId] } });
  assert.equal(h.handlers.paneActions('a/persistent').os, 'Unknown');
  await h.handlers.workbenchDetect('a', 'a/persistent');
  const found = h.handlers.paneActions('a/persistent');
  assert.equal(found.os, 'Ubuntu'); assert.deepEqual(found.favorites, [customId]);
  assert.ok(found.actions.some(a => a.id === customId && a.enabled));
  assert.throws(() => h.handlers.workbenchActions('a', 'b/persistent'), /does not belong/);
  assert.equal(h.calls.length, 0);
});
test('reviewed actions retain the source pane provider rather than the profile default', async () => {
  const h = fixture();
  const persistent = h.handlers.workbenchReview('a', { key: 'a/persistent', code: 'printf persistent' });
  assert.match(persistent.persistence, /new persistent task/);
  await h.handlers.workbenchRun(persistent.token);
  const standard = h.handlers.workbenchReview('a', { key: 'a/standard-one', code: 'printf standard' });
  assert.match(standard.persistence, /NOT persistent/);
  await h.handlers.workbenchRun(standard.token);
  assert.deepEqual(h.calls.map(c => c.persistent), [true, false]);
});
test('a replaced pane token or view invalidates consent before creation', async () => {
  for (const replace of ['token', 'view', 'connection']) {
    const h = fixture(); h.setConfirm(async () => {
      if (replace === 'token') h.panes.get('a/persistent').sessionToken = 'replacement';
      if (replace === 'view') h.remote.views.set('a/persistent', { active: true, pane: h.panes.get('a/persistent') });
      if (replace === 'connection') h.connections.set('a', { ...h.connections.get('a'), remote: { ...h.remote } });
      return { response: 0 };
    });
    const reviewed = h.handlers.workbenchReview('a', { key: 'a/persistent', code: 'printf original' });
    await assert.rejects(h.handlers.workbenchRun(reviewed.token), /changed/);
    assert.equal(h.calls.length, 0);
  }
});
test('saved custom edits cannot alter the immutable reviewed command and Cancel defaults last', async () => {
  const h = fixture(); await h.handlers.workbenchDetect('a');
  h.handlers.actionConfigurationSave({ custom: [custom] });
  const reviewed = h.handlers.workbenchReview('a', { key: 'a/persistent', actionId: customId, code: custom.code });
  h.handlers.actionConfigurationSave({ custom: [{ ...custom, code: 'printf changed' }] });
  h.setConfirm(async options => {
    assert.deepEqual(options.buttons, ['Run in new console', 'Cancel']);
    assert.equal(options.cancelId, 1); assert.equal(options.defaultId, 1); return { response: 0 };
  });
  await h.handlers.workbenchRun(reviewed.token);
  assert.equal(h.calls[0].code, custom.code);
  const cancelled = h.handlers.workbenchReview('a', { key: 'a/standard-one', code: 'printf never' });
  h.setConfirm(async () => ({ response: 1 })); assert.equal(await h.handlers.workbenchRun(cancelled.token), null);
  assert.equal(h.calls.length, 1);
});

function editorFixture() {
  const nodes = new Map(), errors = [], destinations = [], writes = [], eventHandlers = [];
  class Element {
    constructor(tag = 'div') { this.tag = tag; this.children = []; this.value = ''; this.textContent = ''; this.open = false; this.disabled = false; this.events = {}; this.attrs = {}; }
    append(...items) { for (const item of items) item.parent = this; this.children.push(...items); if (!this.value && this.tag === 'select') this.value = items[0]?.value || ''; }
    replaceChildren(...items) { this.children = []; this.value = ''; this.append(...items); }
    setAttribute(name, value) { this.attrs[name] = value; } focus() { this.focused = true; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(item => item !== this); }
    addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
  }
  const $ = id => { if (!nodes.has(id)) nodes.set(id, new Element(/(?:OS|Shell)$/.test(id) ? 'select' : id === 'actionCode' ? 'textarea' : id === 'actionName' ? 'input' : 'button')); return nodes.get(id); };
  let configuration = { custom: [], favoritesByOS: {}, osTypes: ['Ubuntu', 'Windows', 'Linux'], defaults: ['system.disk'] };
  const api = { actionConfiguration: async () => structuredClone(configuration), actionTemplates: async () => [{ id: 'system.info', title: 'Info', enabled: true, description: 'Inspect' }],
    actionPreview: async () => ({ code: 'printf builtin' }), actionNewId: async () => customId,
    actionConfigurationSave: async value => { writes.push(value); throw Error('Use the atomic Preferences save.'); }, onEvent: handler => eventHandlers.push(handler) };
  const context = vm.createContext({ $, api, views: new Map(), profiles: new Map(), structuredClone, window: { NerdSSHellPreferences: { open: async category => destinations.push(category) } },
    element: (tag, className, text) => { const node = new Element(tag); node.className = className || ''; node.textContent = text || ''; return node; },
    button: (text, action) => { const node = new Element('button'); node.textContent = text; node.onclick = action; return node; },
    run: promise => Promise.resolve(promise).catch(e => errors.push(e.message)), message: value => errors.push(value) });
  vm.runInContext(fs.readFileSync(require.resolve('../ui/pane-actions.js'), 'utf8'), context);
  return { $, api, writes, errors, destinations, context, ui: context.window.BetterSSHPanes, emit(event) { for (const handler of eventHandlers) handler(event); }, setConfiguration(value) { configuration = value; } };
}
function setFavorite(h, checked) { const node = h.$('favoriteConfigList').children[0].children[0]; node.checked = checked; node.onchange(); }
test('Preferences action draft cancels favorites and leaves persistence to the atomic Save', async () => {
  const h = editorFixture(); await h.ui.beginConfiguration(); setFavorite(h, true);
  assert.deepEqual(h.ui.stageConfiguration().favoritesByOS.Ubuntu, ['system.disk', 'system.info']); assert.equal(h.writes.length, 0);
  h.ui.cancelConfiguration(); await h.ui.beginConfiguration();
  assert.equal(h.$('favoriteConfigList').children[0].children[0].checked, false);
  setFavorite(h, true); const draft = h.ui.stageConfiguration(); h.ui.commitConfiguration();
  assert.deepEqual(draft.favoritesByOS.Ubuntu, ['system.disk', 'system.info']); assert.equal(h.writes.length, 0);
});
test('pending action staging rejects a second creation and cannot become an incomplete Preferences save', async () => {
  const h = editorFixture(), identity = deferred(); let issued = 0;
  h.api.actionNewId = async () => { issued++; return identity.promise; }; await h.ui.beginConfiguration();
  h.$('actionName').value = 'Fixture'; h.$('actionName').oninput(); h.$('actionCode').value = 'printf staged'; h.$('actionCode').oninput();
  const pending = h.$('actionStore').onclick(); await h.$('actionStore').onclick();
  assert.equal(issued, 1); assert.throws(() => h.ui.stageConfiguration(), /current action edit/);
  identity.resolve(customId); await pending;
  assert.deepEqual(h.ui.stageConfiguration().custom, [{ id: customId, os: 'Ubuntu', title: 'Fixture', code: 'printf staged' }]);
});
test('Cancel during custom staging discards a late ID without contaminating a reopened Preferences draft', async () => {
  const h = editorFixture(), identity = deferred(); h.api.actionNewId = () => identity.promise; await h.ui.beginConfiguration();
  h.$('actionName').value = 'Discard'; h.$('actionCode').value = 'printf never'; const pending = h.$('actionStore').onclick();
  h.ui.cancelConfiguration(); await h.ui.beginConfiguration(); identity.resolve(customId); await pending;
  assert.equal(h.ui.stageConfiguration().custom.length, 0); assert.equal(h.$('actionCode').value, '');
});
test('late built-in preview cannot replace a user edit or silently stage unsaved text', async () => {
  const h = editorFixture(), preview = deferred(); h.api.actionPreview = () => preview.promise; await h.ui.beginConfiguration();
  assert.equal(h.$('actionConfigList').children[0].type, 'button', 'selecting an action must not submit the surrounding Preferences form');
  const choosing = h.$('actionConfigList').children[0].onclick();
  h.$('actionCode').value = 'printf edited'; h.$('actionCode').oninput(); preview.resolve({ code: 'printf late' }); await choosing;
  assert.equal(h.$('actionCode').value, 'printf edited'); assert.throws(() => h.ui.stageConfiguration(), /Keep custom action/);
});
test('atomic Save freezes action and favorite edits until Preferences finishes', async () => {
  const h = editorFixture(); await h.ui.beginConfiguration(); setFavorite(h, true); const before = h.ui.stageConfiguration();
  h.ui.blockConfiguration(true); setFavorite(h, false); h.$('actionNew').onclick(); await h.$('actionStore').onclick();
  assert.throws(() => h.ui.stageConfiguration(), /current action edit/); h.ui.blockConfiguration(false);
  assert.deepEqual(h.ui.stageConfiguration(), before); assert.equal(h.writes.length, 0);
});
test('changing OS clears old action rows until matching templates arrive', async () => {
  const h = editorFixture(), templates = deferred(); await h.ui.beginConfiguration();
  h.api.actionTemplates = () => templates.promise; h.$('actionOS').value = 'Windows'; h.$('actionOS').onchange();
  assert.equal(h.$('actionConfigList').children.length, 0);
  templates.resolve([{ id: 'system.disk', title: 'Windows disk', enabled: true }]); await tick();
  assert.equal(h.$('actionConfigList').children[0].textContent, 'Windows disk');
  assert.equal(h.$('actionShellField').hidden, false);
});
test('late configuration load after Cancel cannot replace a newer draft', async () => {
  const h = editorFixture(), first = deferred(), second = deferred(); h.api.actionConfiguration = () => first.promise;
  const old = h.ui.beginConfiguration(); h.ui.cancelConfiguration(); h.api.actionConfiguration = () => second.promise;
  const fresh = h.ui.beginConfiguration(); second.resolve({ custom: [], favoritesByOS: { Ubuntu: [] }, osTypes: ['Ubuntu'], defaults: ['system.disk'] }); await fresh;
  first.resolve({ custom: [custom], favoritesByOS: {}, osTypes: ['Windows'], defaults: [] }); await old;
  assert.equal(h.$('actionOS').value, 'Ubuntu'); assert.deepEqual(h.ui.stageConfiguration(), { custom: [], favoritesByOS: { Ubuntu: [] } });
});
test('removed preference controls cannot edit another OS or a reopened draft', async () => {
  const h = editorFixture(); await h.ui.beginConfiguration();
  const oldAction = h.$('actionConfigList').children[0], oldFavorite = h.$('favoriteConfigList').children[0].children[0];
  h.$('actionOS').value = 'Windows'; h.$('actionOS').onchange(); h.$('favoriteOS').value = 'Windows'; h.$('favoriteOS').onchange(); await tick();
  await oldAction.onclick(); oldFavorite.checked = true; oldFavorite.onchange();
  assert.equal(h.$('actionName').value, ''); assert.deepEqual(h.ui.stageConfiguration().favoritesByOS, {});
  h.ui.cancelConfiguration(); await h.ui.beginConfiguration(); oldFavorite.onchange();
  assert.deepEqual(h.ui.stageConfiguration().favoritesByOS, {});
});
test('Command Prompt custom action editor stages its explicit shell without changing old PowerShell actions', async () => {
  const h = editorFixture(); await h.ui.beginConfiguration(); h.$('actionOS').value = 'Windows'; h.$('actionShell').value = 'cmd'; h.$('actionShell').onchange(); await tick();
  h.$('actionName').value = 'CMD fixture'; h.$('actionCode').value = 'echo %CD%'; await h.$('actionStore').onclick();
  assert.deepEqual(h.ui.stageConfiguration().custom, [{ id: customId, os: 'Windows', shell: 'cmd', title: 'CMD fixture', code: 'echo %CD%' }]);
});

const targetId = '11111111-2222-4333-8444-555555555555';
function paneFixture() {
  const h = editorFixture(), submitted = [], inspected = [], acknowledgements = [];
  const view = { pane: { key: 'a/source', profileId: 'a' }, ready: false, generation: 0,
    terminal: { focus() {}, modes: { bracketedPasteMode: true }, options: {} }, attentionTracker: { captureInput: () => 'attention-token', acceptInput: (data, token) => { assert.equal(token, 'attention-token'); acknowledgements.push(data); } },
    wrapper: { insertBefore() {}, querySelector() { return {}; } } };
  h.context.views.set(view.pane.key, view); h.ui.onView(view); view.ready = true;
  h.context.window.BetterSSHWorkbench = { open: () => { throw Error('Pane commands must not open the workbench'); } };
  h.api.paneActions = async () => ({ target: targetId, os: 'Ubuntu', title: 'Fixture A', actions: [
    { id: 'system.disk', title: 'Disk', enabled: true }, { id: 'system.reboot', title: 'Reboot', enabled: true },
    { id: 'services.status', title: 'Inspect service', enabled: true, argument: 'service' },
    { id: 'unavailable', title: 'Unavailable', enabled: false }
  ], favorites: ['system.disk'] });
  h.api.workbenchDetect = async (...args) => { inspected.push(args); };
  h.api.paneActionRun = async (key, request) => { submitted.push({ key, ...structuredClone(request) }); return { key }; };
  h.api.input = () => { throw Error('The main process must resolve saved command IDs'); };
  return { ...h, view, submitted, inspected, acknowledgements };
}
async function choose(h, id, menu = 'all', event) {
  if (menu === 'favorites') return h.view.actionBar.favoriteButtons.get(id)?.onclick(event);
  const node = h.view.actionBar[menu]; node.value = id; return node.onchange();
}
test('Actions and Favorites execute a stable action ID on the invoking terminal without workbench or configuration', async () => {
  const h = paneFixture(); await h.ui.refresh(h.view); h.context.active = 'different/session';
  h.api.actionConfiguration = async () => { throw Error('Command selection must not open configuration'); };
  await choose(h, 'system.disk'); await choose(h, 'system.disk', 'favorites'); await choose(h, 'system.reboot');
  assert.deepEqual(h.submitted.map(item => [item.key, item.actionId, item.target, item.bracketedPaste]), [
    ['a/source', 'system.disk', targetId, true], ['a/source', 'system.disk', targetId, true], ['a/source', 'system.reboot', targetId, true]
  ]);
  for (const id of ['unavailable', '__configure', 'not-listed']) await choose(h, id);
  assert.equal(h.submitted.length, 3); assert.deepEqual(h.destinations, []); assert.deepEqual(h.errors, []); assert.equal(h.acknowledgements.length, 3);
});
test('Configure Favorites is a separate native button that remains available offline', async () => {
  const h = paneFixture(); await h.ui.refresh(h.view);
  const { favorites, configureFavorites, bar } = h.view.actionBar;
  assert.equal(favorites.tag, 'div'); assert.equal(favorites.attrs.role, 'group'); assert.equal(favorites.attrs['aria-label'], 'Favorites for this session');
  assert.equal(configureFavorites.tag, 'button'); assert.equal(configureFavorites.type, 'button'); assert.equal(configureFavorites.textContent, 'Configure Favorites…');
  assert.ok(bar.children.includes(configureFavorites)); assert.ok(!favorites.children.includes(configureFavorites));
  h.view.ready = false; await h.ui.refresh(h.view); assert.equal(favorites.children.length, 0); assert.equal(configureFavorites.disabled, false);
  await configureFavorites.onclick();
  assert.deepEqual(h.destinations, ['favorites']); assert.equal(h.submitted.length, 0);
});
test('favorite buttons preserve all 32 saved IDs in order and show unavailable entries disabled', async () => {
  const h = paneFixture(), actions = Array.from({ length: 32 }, (_, index) => ({ id: 'favorite.' + index, title: 'Favorite ' + index, description: 'Inspect ' + index, enabled: index !== 0, reason: index === 0 ? 'Required tool unavailable' : undefined }));
  const favorites = actions.map(action => action.id).reverse();
  h.api.paneActions = async () => ({ target: targetId, os: 'Ubuntu', title: 'Fixture', actions, favorites: [...favorites, 'other-shell'] });
  await h.ui.refresh(h.view); const row = h.view.actionBar.favorites;
  assert.equal(row.children.length, 32); assert.equal(row.tabIndex, 0);
  assert.deepEqual(row.children.map(node => node.attrs['data-action-id']), favorites);
  assert.ok(row.children.every(node => node.tag === 'button' && node.type === 'button'));
  const unavailable = h.view.actionBar.favoriteButtons.get('favorite.0'); assert.equal(unavailable.disabled, true); assert.equal(unavailable.title, 'Required tool unavailable');
  await unavailable.onclick(); assert.equal(h.submitted.length, 0);
  assert.equal(h.view.actionBar.favoriteButtons.has('other-shell'), false);
  assert.equal(h.view.actionBar.all.tag, 'select', 'Actions retains its dropdown');
});
test('removed favorite buttons cannot dispatch into a refreshed or replacement view', async () => {
  const h = paneFixture(); await h.ui.refresh(h.view); const old = h.view.actionBar.favoriteButtons.get('system.disk');
  const response = deferred(), original = h.api.paneActions; h.api.paneActions = () => response.promise;
  const refreshing = h.ui.refresh(h.view); await old.onclick(); assert.equal(h.submitted.length, 0);
  response.resolve(await original()); await refreshing; await old.onclick(); assert.equal(h.submitted.length, 0);
  const live = h.view.actionBar.favoriteButtons.get('system.disk'); h.context.views.set(h.view.pane.key, { ...h.view }); await live.onclick();
  assert.equal(h.submitted.length, 0);
});
test('refreshing or replacing a pane rejects stale dropdown choices before asynchronous results arrive', async () => {
  const h = paneFixture(); await h.ui.refresh(h.view); const response = deferred(); h.api.paneActions = () => response.promise;
  const refreshing = h.ui.refresh(h.view); await choose(h, 'system.disk'); assert.equal(h.submitted.length, 0);
  response.resolve({ target: targetId, os: 'Ubuntu', title: 'Fixture A', actions: [], favorites: [] }); await refreshing;
  await choose(h, 'system.disk'); h.context.views.set(h.view.pane.key, { ...h.view }); await choose(h, 'system.disk');
  assert.equal(h.submitted.length, 0);
});
test('automatic OS inspection enables only the refreshed action list for the original pane', async () => {
  const h = paneFixture(); let requests = 0;
  h.api.paneActions = async () => ({ target: targetId, os: ++requests === 1 ? 'Unknown' : 'Ubuntu', title: 'Fixture A', actions: [{ id: 'system.disk', title: 'Disk', enabled: requests > 1 }], favorites: [] });
  await h.ui.refresh(h.view); assert.deepEqual(h.inspected, [['a', 'a/source']]); await choose(h, 'system.disk');
  assert.equal(h.submitted.length, 1); assert.equal(h.submitted[0].key, 'a/source');
});
test('locked sessions reject Actions and preserve the disabled bracketed-paste override', async () => {
  const h = paneFixture(); await h.ui.refresh(h.view); h.view.locked = true; await choose(h, 'system.disk');
  assert.equal(h.submitted.length, 0); assert.match(h.errors[0], /Input is locked/);
  h.view.locked = false; h.view.terminal.options.ignoreBracketedPasteMode = true; await choose(h, 'system.disk');
  assert.equal(h.submitted[0].bracketedPaste, false);
});
test('favorite buttons disable on input lock without disabling offline configuration', async () => {
  const h = paneFixture(); await h.ui.refresh(h.view); h.view.locked = true; h.emit({ type: 'input-lock', key: h.view.pane.key, locked: true });
  assert.equal(h.view.actionBar.favoriteButtons.get('system.disk').disabled, true); await choose(h, 'system.disk', 'favorites'); assert.equal(h.submitted.length, 0);
  assert.equal(h.view.actionBar.configureFavorites.disabled, false); await h.view.actionBar.configureFavorites.onclick(); assert.deepEqual(h.destinations, ['favorites']);
  h.view.locked = false; h.emit({ type: 'input-lock', key: h.view.pane.key, locked: false }); h.view.terminal.options.ignoreBracketedPasteMode = true;
  await choose(h, 'system.disk', 'favorites'); assert.equal(h.submitted[0].bracketedPaste, false);
});
test('parameterized recipes collect their exact name inline and execute once in that same pane', async () => {
  const h = paneFixture(); await h.ui.refresh(h.view); const pending = choose(h, 'services.status');
  const form = h.view.actionBar.bar.children.find(node => node.tag === 'form'), input = form.children[1].children[0];
  assert.equal(h.submitted.length, 0); input.value = 'bad; command'; form.onsubmit({ preventDefault() {} });
  assert.equal(h.submitted.length, 0); assert.match(h.errors[0], /exact name/);
  input.value = 'fixture.service'; form.onsubmit({ preventDefault() {} }); await pending;
  assert.deepEqual(h.submitted.map(item => [item.key, item.actionId, item.argument]), [['a/source', 'services.status', 'fixture.service']]);
  assert.ok(!h.view.actionBar.bar.children.includes(form));
});
test('disconnect/recovery during parameter entry discards the selection instead of replaying on reconnect', async () => {
  const h = paneFixture(); await h.ui.refresh(h.view); const pending = choose(h, 'services.status');
  const form = h.view.actionBar.bar.children.find(node => node.tag === 'form'); form.children[1].children[0].value = 'fixture.service';
  h.view.ready = false; h.view.generation++; await h.ui.refresh(h.view); h.view.ready = true; await h.ui.refresh(h.view);
  form.onsubmit({ preventDefault() {} }); await pending; assert.equal(h.submitted.length, 0);
});
test('a pending command prevents duplicate menu execution while preserving ordinary target selection', async () => {
  const h = paneFixture(), sent = deferred(); let calls = 0; h.api.paneActionRun = () => { calls++; return sent.promise; };
  await h.ui.refresh(h.view); const pending = choose(h, 'system.disk'); await choose(h, 'system.reboot');
  assert.equal(calls, 1); sent.resolve({ key: h.view.pane.key }); await pending; assert.equal(h.view.actionBar.all.disabled, false);
});
test('favorite clicks dispatch once while pending and ignore the second native double-click event', async () => {
  const h = paneFixture(), sent = deferred(); let calls = 0; h.api.paneActionRun = () => { calls++; return sent.promise; };
  await h.ui.refresh(h.view); const pending = choose(h, 'system.disk', 'favorites', { detail: 1 });
  assert.equal(h.view.actionBar.favoriteButtons.get('system.disk').disabled, true); await choose(h, 'system.disk', 'favorites', { detail: 1 }); assert.equal(calls, 1);
  sent.resolve({ key: h.view.pane.key }); await pending;
  await choose(h, 'system.disk', 'favorites', { detail: 2 }); assert.equal(calls, 1);
  await choose(h, 'system.disk', 'favorites', { detail: 0 }); assert.equal(calls, 2, 'Keyboard activation remains available');
});
test('parameterized favorite buttons collect inline names and discard a refreshed pending form', async () => {
  const h = paneFixture(), original = h.api.paneActions; h.api.paneActions = async () => ({ ...await original(), favorites: ['services.status'] }); await h.ui.refresh(h.view);
  const pending = choose(h, 'services.status', 'favorites'); const form = h.view.actionBar.bar.children.find(node => node.tag === 'form');
  form.children[1].children[0].value = 'fixture.service'; h.view.generation++; await h.ui.refresh(h.view); form.onsubmit({ preventDefault() {} }); await pending;
  assert.equal(h.submitted.length, 0);
  const next = choose(h, 'services.status', 'favorites'), liveForm = h.view.actionBar.bar.children.find(node => node.tag === 'form');
  liveForm.children[1].children[0].value = 'fixture.service'; liveForm.onsubmit({ preventDefault() {} }); await next;
  assert.deepEqual(h.submitted.map(item => [item.key, item.actionId, item.argument]), [['a/source', 'services.status', 'fixture.service']]);
});
