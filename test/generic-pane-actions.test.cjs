'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
function fixture({ terminalType = 'generic', metadata, fail = false } = {}) {
  class Element {
    constructor(tag = 'div') { this.tag = tag; this.children = []; this.value = ''; this.hidden = false; this.disabled = false; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    insertBefore(node) { this.children.push(node); }
    querySelector() { return null; }
    setAttribute() {} focus() {}
  }
  const nodes = new Map(), calls = [], errors = [], views = new Map();
  let data = metadata || { title: 'Router', os: 'Network device', platform: { system: 'network-device' },
    capabilities: { automaticDetection: false }, target: null, actions: [], favorites: [] };
  const api = { paneActions: async () => { calls.push('actions'); if (fail) throw Error('Canceled metadata'); return data; },
    workbenchDetect: async () => { calls.push('detect'); }, paneActionRun: async () => { calls.push('run'); }, onEvent() {} };
  const context = vm.createContext({ api, views, structuredClone, window: { NerdSSHellPreferences: { open() {} } },
    $: id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); },
    element: (tag, className, text) => Object.assign(new Element(tag), { className, textContent: text }),
    button: (text, action) => Object.assign(new Element('button'), { textContent: text, onclick: action }),
    run: promise => Promise.resolve(promise).catch(error => errors.push(error.message)), message: value => errors.push(value) });
  vm.runInContext(fs.readFileSync(require.resolve('../ui/pane-actions.js'), 'utf8'), context);
  const pane = { key: 'router/standard-one', profileId: 'router', ...(terminalType ? { terminalType } : {}) };
  const v = { pane, wrapper: new Element(), generation: 1, ready: true, terminal: { focus() {} } }; views.set(pane.key, v);
  return { v, calls, errors, api, setMetadata(value) { data = value; }, ui: context.window.NerdSSHellPanes };
}
test('generic metadata hides the action toolbar without calling automatic system detection', async () => {
  const h = fixture({ terminalType: null }); await h.ui.refresh(h.v);
  assert.equal(h.v.actionBar.bar.hidden, true); assert.equal(h.v.actionBar.all.disabled, true);
  assert.equal(h.v.actionBar.favoriteButtons.size, 0); assert.deepEqual(h.calls, ['actions']);
  h.v.actionBar.all.value = '__detect'; await h.v.actionBar.all.onchange(); assert.deepEqual(h.calls, ['actions']);
});
test('generic pane metadata hides the toolbar before loading and never creates a detect retry on failure', async () => {
  const h = fixture({ fail: true }); h.ui.onView(h.v, false); assert.equal(h.v.actionBar.bar.hidden, true);
  await h.ui.refresh(h.v); assert.equal(h.v.actionBar.bar.hidden, true); assert.equal(h.v.actionBar.all.disabled, true);
  assert.equal(h.v.actionBar.all.children.some(node => node.value === '__detect'), false); assert.deepEqual(h.calls, ['actions']);
});
test('ordinary unknown server retains platform detection and its action toolbar', async () => {
  const h = fixture({ terminalType: 'server', metadata: { title: 'Server', os: 'Unknown', platform: { system: 'unknown' },
    capabilities: { automaticDetection: true }, target: 'target', actions: [], favorites: [] } });
  await h.ui.refresh(h.v); assert.equal(h.v.actionBar.bar.hidden, false); assert.deepEqual(h.calls, ['actions', 'detect', 'actions']);
  assert.ok(h.v.actionBar.all.children.some(node => node.value === '__detect'));
});

test('generic pane identity cannot trigger detection when older metadata omits capabilities', async () => {
  const h = fixture({ metadata: { title: 'Router', os: 'Unknown', platform: { system: 'unknown' }, target: 'stale', actions: [], favorites: [] } });
  await h.ui.refresh(h.v); assert.deepEqual(h.calls, ['actions']); assert.equal(h.v.actionBar.bar.hidden, true);
});

test('capabilities are rechecked after a server detection result changes to generic', async () => {
  const h = fixture({ terminalType: 'server', metadata: { title: 'Server', os: 'Unknown', target: 'stale', actions: [], favorites: [] } });
  h.api.workbenchDetect = async () => { h.calls.push('detect'); h.setMetadata({ title: 'Router', os: 'Network device', capabilities: { automaticDetection: false }, actions: [], favorites: [] }); };
  await h.ui.refresh(h.v); assert.deepEqual(h.calls, ['actions', 'detect', 'actions']); assert.equal(h.v.actionBar.bar.hidden, true);
  assert.equal(h.v.actionBar.all.children.some(node => node.value === '__detect'), false);
});
