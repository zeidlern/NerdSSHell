'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness(keys = ['a', 'b']) {
  const node = () => ({ style: { setProperty() {} }, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, addEventListener() {}, classes: new Set(), classList: { toggle(name, enabled) { enabled ? this.owner.classes.add(name) : this.owner.classes.delete(name); }, add(name) { this.owner.classes.add(name); }, remove(name) { this.owner.classes.delete(name); } }, append(...children) { this.children.push(...children); }, children: [] });
  const make = () => { const n = node(); n.classList.owner = n; return n; };
  const grid = make(); grid.querySelectorAll = () => { const old = grid.children; grid.children = []; return old.map(n => ({ remove() {} })); };
  const elements = new Map(['welcome', 'dividerX', 'dividerY'].map(id => [id, make()])); elements.set('grid', grid);
  const buttons = ['1', '2-side-by-side', '2-stacked', '4'].map(layoutChoice => Object.assign(make(), { dataset: { layoutChoice } }));
  let saves = 0;
  const views = new Map(keys.map(key => [key, { wrapper: make() }]));
  const context = vm.createContext({ order: keys, slots: [], active: keys.at(-1), layout: 2, twoPaneOrientation: 'stacked', splitX: 50, splitY: 63,
    views, $: id => elements.get(id), document: { querySelectorAll: () => buttons }, renderTabs() {}, renderConnections() {},
    element: () => make(), button: () => make(), dropTarget() {}, syncFiles() {}, syncActiveAttention() {}, remember() { saves++; }, requestAnimationFrame() {} });
  const source = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('function visibleKeys()'), source.indexOf('function updateDimensions()')), context);
  vm.runInContext(source.slice(source.indexOf('function chooseLayout('), source.indexOf("$('preferences').onclick")), context);
  return { context, grid, elements, buttons, views, render: () => context.render(), saves: () => saves };
}

test('switching stacked and side-by-side layouts keeps the same view identities and uses the correct divider', () => {
  const h = harness(), a = h.views.get('a'), b = h.views.get('b'); h.render();
  assert.equal(h.grid.className, 'layout-2-stacked');
  assert.deepEqual([a.wrapper.style.gridColumn, a.wrapper.style.gridRow, b.wrapper.style.gridColumn, b.wrapper.style.gridRow], ['1', '1', '1', '2']);
  assert.equal(h.elements.get('dividerX').hidden, true); assert.equal(h.elements.get('dividerY').hidden, false);
  assert.equal(h.buttons[2].attributes['aria-pressed'], 'true'); assert.equal(h.buttons.filter(b => b.classes.has('active')).length, 1);
  h.context.twoPaneOrientation = 'side-by-side'; h.render();
  assert.deepEqual([a.wrapper.style.gridColumn, a.wrapper.style.gridRow, b.wrapper.style.gridColumn, b.wrapper.style.gridRow], ['1', '1', '2', '1']);
  assert.equal(h.elements.get('dividerX').hidden, false); assert.equal(h.elements.get('dividerY').hidden, true);
  assert.equal(h.buttons[1].attributes['aria-pressed'], 'true'); assert.equal(h.buttons[2].attributes['aria-pressed'], 'false');
  assert.equal(h.views.get('a'), a); assert.equal(h.views.get('b'), b);
});

test('dedicated buttons choose every layout, persist it and retain terminal ownership and active session', () => {
  const h = harness(), original = [...h.views.values()];
  for (const [index, choice] of ['1', '2-side-by-side', '2-stacked', '4'].entries()) {
    h.buttons[index].onclick();
    assert.equal(h.context.layout, choice.startsWith('2-') ? 2 : Number(choice));
    if (choice.startsWith('2-')) assert.equal(h.context.twoPaneOrientation, choice.slice(2));
    assert.equal(h.buttons[index].attributes['aria-pressed'], 'true');
    assert.equal(h.buttons.filter(b => b.attributes['aria-pressed'] === 'true').length, 1);
    assert.equal(h.context.active, 'b'); assert.deepEqual([...h.views.values()], original);
  }
  assert.equal(h.saves(), 4);
  h.context.chooseLayout('2-invalid'); assert.equal(h.saves(), 4); assert.equal(h.context.layout, 4);
});

test('all four layout controls are native buttons with distinct accessible labels, tooltips and shortcut hints', () => {
  const html = fs.readFileSync(path.join(__dirname, '../ui/index.html'), 'utf8');
  assert.doesNotMatch(html, /id="layoutSelect"/);
  assert.match(html, /class="layout-buttons" role="group" aria-label="Terminal layout"/);
  const buttons = [...html.matchAll(/<button[^>]*data-layout-choice="([^"]+)"[^>]*>/g)];
  assert.deepEqual(buttons.map(match => match[1]), ['1', '2-side-by-side', '2-stacked', '4']);
  for (const [index, match] of buttons.entries()) {
    assert.match(match[0], /type="button"/); assert.match(match[0], /aria-label="[^"]+"/);
    assert.match(match[0], new RegExp('Ctrl\\+Alt\\+' + (index + 1))); assert.match(match[0], /aria-pressed="(?:true|false)"/);
  }
});

test('the empty stacked slot sits below its terminal and only explicit Layout changes collapse it', () => {
  const h = harness(['a']); h.render();
  assert.equal(h.grid.children.length, 1); assert.equal(h.grid.children[0].style.gridColumn, '1'); assert.equal(h.grid.children[0].style.gridRow, '2');
  h.context.layout = 1; h.render();
  assert.equal(h.grid.className, ''); assert.equal(h.grid.children.length, 0);
  assert.equal(h.elements.get('dividerX').hidden, true); assert.equal(h.elements.get('dividerY').hidden, true);
  h.context.layout = 2; h.render(); assert.equal(h.grid.className, 'layout-2-stacked');
});

test('the stacked shortcut is reserved from terminal input', () => {
  const source = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source.match(/^function isAppShortcut\(e\).*$/m)[0], context);
  assert.equal(context.isAppShortcut({ key: '3', ctrlKey: true, altKey: true }), true);
  assert.equal(context.isAppShortcut({ key: '3', ctrlKey: false, altKey: false }), false);
  assert.equal(context.isAppShortcut({ key: 'Enter', ctrlKey: true, shiftKey: true }), false);
  assert.doesNotMatch(source, /focused\s*=|head\.addEventListener\('dblclick'/);
});

test('selecting either visible terminal preserves its assigned slot', () => {
  const h = harness(['a', 'b', 'c', 'd', 'e']); h.context.layout = 4; h.render();
  assert.deepEqual([...h.context.slots], ['b', 'c', 'd', 'e']);
  h.context.active = 'b'; h.render();
  assert.deepEqual([...h.context.slots], ['b', 'c', 'd', 'e']);
  assert.equal(h.views.get('b').wrapper.style.gridColumn, '1');
  assert.equal(h.views.get('e').wrapper.style.gridRow, '2');
});

function dragHarness(keys = ['a', 'b']) {
  const h = harness(keys), source = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
  h.context.panes = new Map(keys.map(key => [key, { key }]));
  h.context.focusPane = key => { h.focused = key; }; h.context.message = text => { h.error = text; };
  h.context.openPane = async key => { h.context.order.push(key); };
  vm.runInContext(source.slice(source.indexOf('function dragSource('), source.indexOf('function quote(')), h.context);
  h.target = (index, layoutSlot = true) => {
    const handlers = {}, classes = new Set(), node = { addEventListener: (name, fn) => { handlers[name] = fn; }, classList: { add: value => classes.add(value), remove: value => classes.delete(value) } };
    h.context.dropTarget(node, () => index, layoutSlot);
    const event = key => ({ preventDefault() {}, stopPropagation() {}, dataTransfer: { types: ['application/x-nerdsshell-pane'], getData: () => key, files: [] } });
    return { classes, drop: key => handlers.drop(event(key)), over: types => handlers.dragover({ ...event(''), dataTransfer: { types } }) };
  };
  return h;
}

test('drag swaps occupied slots without recreating views or shifting the selected pane', async () => {
  const h = dragHarness(['a', 'b', 'c', 'd']); h.context.layout = 4; h.render();
  const identities = [...h.views.values()], target = h.target(0); target.over(['application/x-nerdsshell-pane']);
  assert.equal(target.classes.has('drop-target'), true);
  await target.drop('d');
  assert.deepEqual([...h.context.slots], ['d', 'b', 'c', 'a']);
  assert.equal(h.context.active, 'd'); assert.equal(h.focused, 'd'); assert.deepEqual([...h.views.values()], identities);
  assert.equal(h.views.get('d').wrapper.style.gridColumn, '1'); assert.equal(h.views.get('d').wrapper.style.gridRow, '1');
  assert.equal(target.classes.has('drop-target'), false);
});

test('dragging into an empty quadrant preserves holes and accepts subsequent swaps', async () => {
  const h = dragHarness(['a', 'b']); h.context.layout = 4; h.render();
  await h.target(3).drop('a');
  assert.deepEqual([...h.context.slots], [null, 'b', null, 'a']); assert.equal(h.grid.children.length, 2);
  h.context.active = 'b'; h.render(); assert.deepEqual([...h.context.slots], [null, 'b', null, 'a']);
  await h.target(1).drop('a'); assert.deepEqual([...h.context.slots], [null, 'a', null, 'b']);
  h.context.layout = 2; h.render(); assert.equal(h.context.slots.length, 2); assert.equal(h.context.slots.includes('a'), true);
});

test('external text, forged keys and stale asynchronous sidebar drops cannot move another session', async () => {
  const h = dragHarness(); h.render(); const target = h.target(0);
  target.over(['text/plain']); assert.equal(target.classes.has('drop-target'), false);
  await target.drop('foreign'); assert.deepEqual([...h.context.slots], ['a', 'b']);
  let resolve; h.context.panes.set('c', { key: 'c' });
  h.context.openPane = async key => { await new Promise(r => { resolve = r; }); h.context.order.push(key); };
  const pending = target.drop('c'); h.context.slots = ['b', 'a']; resolve(); await pending;
  assert.deepEqual([...h.context.slots], ['b', 'a']); assert.equal(h.context.active, 'b'); assert.equal(h.focused, undefined);
});

test('opening a selected session focuses its current terminal while stale or background opens stay quiet', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8'), frames = [], focus = [];
  const views = new Map(['a', 'b'].map(key => [key, { pane: { key }, wrapper: { hidden: false }, terminal: { focus: () => focus.push(key) }, ready: true }]));
  const context = vm.createContext({ active: 'a', order: ['a', 'b'], views, panes: new Map(['a', 'b'].map(key => [key, { key, profileId: 'fixture' }])),
    opening: new Map(), closing: new Map(), connected: () => true, render() {}, remember() {}, requestAnimationFrame: fn => frames.push(fn), document: { querySelector: () => null }, message() {} });
  vm.runInContext(source.slice(source.indexOf('function focusPane('), source.indexOf('function activate(')), context);
  vm.runInContext(source.slice(source.indexOf('async function openPane('), source.indexOf('async function closeView(')), context);
  await context.openPane('b'); frames.splice(0).forEach(fn => fn()); assert.deepEqual(focus, ['b']);
  await context.openPane('a', false); assert.equal(frames.length, 0);
  await context.openPane('a'); context.active = 'b'; frames.splice(0).forEach(fn => fn()); assert.deepEqual(focus, ['b']);
  await context.openPane('a'); views.set('a', { wrapper: { hidden: false }, terminal: { focus: () => focus.push('replacement') } }); frames.splice(0).forEach(fn => fn()); assert.deepEqual(focus, ['b']);
});
