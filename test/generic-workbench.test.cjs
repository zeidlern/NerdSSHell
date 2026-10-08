'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { installWorkbench } = require('../src/workbench.cjs');
function fixture(terminalType = 'generic') {
  const handlers = {}, calls = [];
  const profile = { id: 'router', name: 'Router', host: 'router.invalid', port: 22, username: 'fixture', terminalType, sessionMode: 'standard' };
  const pane = { key: 'router/standard-one', sessionToken: 'synthetic-token', standard: true };
  const remote = { profile, connected: true, closing: false, views: new Map([[pane.key, { active: true }]]), shells: new Map(),
    pane: () => pane, checked: async () => { calls.push('probe'); return 'system:Linux\nID=ubuntu\ncap:apt'; },
    createTaskFor: async () => { calls.push('task'); return pane; } };
  const store = { data: {}, save() {} }, connections = new Map([[profile.id, { profile, remote }]]);
  let confirm = async () => ({ response: 0 });
  const workbench = installWorkbench({ handle: (name, fn) => { handlers[name] = fn; }, connections, getStore: () => store,
    app: { isPackaged: false, getVersion: () => 'fixture' }, dialog: { showMessageBox: () => { calls.push('confirmation'); return confirm(); } },
    getWindow: () => ({}), emit() {}, queueOutput() {}, discardOutput() {}, output: { flush() {} }, forKey: () => connections.get(profile.id),
    shellProvider: () => [], actionTarget: () => 'synthetic-target' });
  return { handlers, workbench, profile, remote, calls, pane, setConfirm: fn => { confirm = fn; } };
}
test('generic pane actions expose a no-probe capability and no recipes, favorites or target', () => {
  const h = fixture(), data = h.handlers.paneActions(h.pane.key);
  assert.equal(data.os, 'Network device'); assert.equal(data.platform.system, 'network-device');
  assert.deepEqual(data.capabilities, { terminalType: 'generic', automaticDetection: false, paneActions: false, workbench: false });
  assert.deepEqual(data.actions, []); assert.deepEqual(data.favorites, []); assert.equal(data.target, null);
  assert.deepEqual(h.handlers.workbenchContext().targets, []); assert.deepEqual(h.calls, []);
  assert.deepEqual(h.handlers.workbenchActions('router').actions, []);
});
test('main workbench independently rejects generic detection, templates, reviews and originating-pane actions', async () => {
  const h = fixture(); await assert.rejects(h.handlers.workbenchDetect('router', h.pane.key), /network-device/i);
  assert.throws(() => h.handlers.workbenchTemplate('router', 'system.info', '', h.pane.key), /network-device/i);
  assert.throws(() => h.handlers.workbenchReview('router', { key: h.pane.key, code: 'show version' }), /network-device/i);
  assert.throws(() => h.workbench.resolvePaneAction(h.pane.key, 'system.info'), /network-device/i);
  assert.deepEqual(h.calls, []);
});
test('changing a reviewed server destination into a generic connection cancels execution before confirmation', async () => {
  const h = fixture('server'), review = h.handlers.workbenchReview('router', { code: 'printf reviewed' });
  h.profile.terminalType = 'generic'; await assert.rejects(h.handlers.workbenchRun(review.token), /network-device/i);
  assert.deepEqual(h.calls, []);
});
test('changing capability during confirmation is rechecked before launch', async () => {
  const h = fixture('server'), review = h.handlers.workbenchReview('router', { code: 'printf reviewed' });
  h.setConfirm(async () => { h.profile.terminalType = 'generic'; return { response: 0 }; });
  await assert.rejects(h.handlers.workbenchRun(review.token), /network-device/i); assert.deepEqual(h.calls, ['confirmation']);
});
test('cached Linux facts cannot expose recipes after a destination becomes generic', async () => {
  const h = fixture('server'); await h.handlers.workbenchDetect('router');
  assert.ok(h.handlers.paneActions(h.pane.key).actions.length); h.profile.terminalType = 'generic';
  assert.deepEqual(h.handlers.paneActions(h.pane.key).actions, []);
  await assert.rejects(h.handlers.workbenchDetect('router'), /network-device/i); assert.deepEqual(h.calls, ['probe']);
});

test('a generic live provider remains restricted when runtime profile metadata says server', async () => {
  const h = fixture('server'); h.remote.profile = { ...h.profile, terminalType: 'generic' };
  assert.deepEqual(h.handlers.workbenchContext().targets, []); assert.deepEqual(h.handlers.paneActions(h.pane.key).actions, []);
  await assert.rejects(h.handlers.workbenchDetect('router'), /network-device/i); assert.deepEqual(h.calls, []);
});
