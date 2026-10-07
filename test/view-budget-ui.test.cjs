'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { MAX_OPEN_VIEWS } = require('../src/session-limits.cjs');
const source = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');

test('automatic startup opens bounded views across servers and keeps remaining sessions discoverable', async () => {
  let listener, pending; const notices = [], opened = [], panes = new Map(), views = new Map();
  views.set('other/server-view', {});
  const context = vm.createContext({
    api: { onEvent: fn => { listener = fn; } }, profiles: new Map([['server', { id: 'server', startup: 'all', sessionMode: 'persistent' }]]),
    panes, views, order: [], savedOrder: [], desiredActive: '', savedSlots: [], maxOpenViews: MAX_OPEN_VIEWS, pendingViewSlots: 0,
    run: promise => { pending = promise; }, render() {}, message: text => notices.push(text),
    openPane: async key => { opened.push(key); views.set(key, {}); },
  });
  vm.runInContext(source.slice(source.indexOf('api.onEvent(event => {'), source.indexOf("$('connectionForm').addEventListener")), context);
  const advertised = Array.from({ length: 1024 }, (_, i) => ({ key: 'server/' + i, profileId: 'server', dead: false }));
  listener({ type: 'connected', profileId: 'server', panes: advertised }); await pending;
  assert.equal(views.size, MAX_OPEN_VIEWS);
  assert.equal(opened.length, MAX_OPEN_VIEWS - 1);
  assert.equal(panes.size, 1024, 'Unopened remote work stays in the session sidebar');
  assert.equal(notices.length, 1); assert.match(notices[0], /sidebar.*64.*remote work keeps running/);
  assert.ok(views.has('other/server-view'), 'A different server retains its original view');
  const retained = views.get('server/0'); opened.length = 0;
  context.savedOrder = ['server/0'];
  context.openPane = async key => { opened.push(key); };
  listener({ type: 'connected', profileId: 'server', panes: advertised }); await pending;
  assert.equal(opened.length, MAX_OPEN_VIEWS - 1, 'Existing views reconnect even when capacity is full');
  assert.equal(views.get('server/0'), retained);
});

test('full view budget rejects a new xterm before DOM or terminal allocation', () => {
  const views = new Map(Array.from({ length: MAX_OPEN_VIEWS }, (_, i) => ['server/' + i, {}]));
  let allocations = 0;
  const context = vm.createContext({ views, maxOpenViews: MAX_OPEN_VIEWS, pendingViewSlots: 0, element() { allocations++; throw Error('Unexpected allocation'); } });
  const guardStart = source.indexOf('function requireViewCapacity('), guardEnd = source.indexOf('\n}', guardStart) + 2;
  vm.runInContext(source.slice(guardStart, guardEnd), context);
  vm.runInContext(source.slice(source.indexOf('function createView('), source.indexOf('async function openPane(')), context);
  assert.throws(() => context.createView({ key: 'server/new' }), /64 open terminal views/);
  assert.equal(allocations, 0);
  assert.doesNotThrow(() => context.requireViewCapacity('server/0'));
  views.delete('server/1');
  assert.doesNotThrow(() => context.requireViewCapacity('server/new'));
});

test('pending launch reservations cannot be stolen by another view and release on completion or cancellation', async () => {
  const views = new Map(Array.from({ length: MAX_OPEN_VIEWS - 1 }, (_, i) => ['server/' + i, {}]));
  const context = vm.createContext({ views, maxOpenViews: MAX_OPEN_VIEWS, pendingViewSlots: 0 });
  const start = source.indexOf('function requireViewCapacity('), end = source.indexOf('\nconst activeTransfers', start);
  vm.runInContext(source.slice(start, end), context);
  let resume; const wait = new Promise(resolve => { resume = resolve; });
  const pending = context.withViewCapacity(async release => { await wait; release(); views.set('approved/new', {}); });
  assert.equal(context.pendingViewSlots, 1);
  assert.throws(() => context.requireViewCapacity('unrelated/new'), /64 open terminal views/);
  await assert.rejects(context.withViewCapacity(() => { throw Error('Should not start'); }), /64 open terminal views/);
  assert.doesNotThrow(() => context.requireViewCapacity('server/0'));
  resume(); await pending;
  assert.equal(context.pendingViewSlots, 0); assert.equal(views.size, MAX_OPEN_VIEWS);
  views.delete('approved/new');
  await assert.rejects(context.withViewCapacity(() => { throw Error('Cancelled synthetic launch'); }), /Cancelled synthetic/);
  assert.equal(context.pendingViewSlots, 0);
  await context.withViewCapacity(release => { release(); release(); });
  assert.equal(context.pendingViewSlots, 0, 'Release is idempotent');
});

test('Standard connection reserves its first shell and displays it when its event arrives before the IPC result', async () => {
  const views = new Map(Array.from({ length: MAX_OPEN_VIEWS }, (_, i) => ['other/' + i, {}]));
  const panes = new Map(), pane = { key: 'server/first', profileId: 'server', dead: false };
  let connections = 0, listener, eventTask;
  const context = vm.createContext({ views, panes, maxOpenViews: MAX_OPEN_VIEWS, pendingViewSlots: 0,
    profiles: new Map([['server', { sessionMode: 'standard' }]]), connected: () => false,
    order: [], savedOrder: [], desiredActive: '', savedSlots: [], render() {}, message() {},
    run: promise => { eventTask = promise; },
    api: { onEvent: fn => { listener = fn; }, connect: async () => { connections++; listener({ type: 'connected', profileId: 'server', panes: [pane] }); return [pane]; } },
    openPane: async key => { context.requireViewCapacity(key); if (!views.has(key)) views.set(key, {}); },
  });
  const guardStart = source.indexOf('function requireViewCapacity(');
  vm.runInContext(source.slice(guardStart, source.indexOf('\nconst activeTransfers', guardStart)), context);
  vm.runInContext(source.slice(source.indexOf('async function connectProfile('), source.indexOf('function remember(')), context);
  vm.runInContext(source.slice(source.indexOf('api.onEvent(event => {'), source.indexOf("$('connectionForm').addEventListener")), context);
  await assert.rejects(context.connectProfile('server'), /64 open terminal views/);
  assert.equal(connections, 0, 'No hidden ordinary shell can start at a full renderer budget');
  views.delete('other/0');
  await context.connectProfile('server'); await eventTask;
  assert.equal(connections, 1); assert.ok(views.has(pane.key)); assert.equal(views.size, MAX_OPEN_VIEWS);
  assert.equal(context.pendingViewSlots, 0); assert.equal(panes.get(pane.key), pane);
});
