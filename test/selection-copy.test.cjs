'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { attach } = require('../ui/selection-copy.js');
function target() {
  const events = new Map();
  return { addEventListener(name, fn) { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(fn); },
    removeEventListener(name, fn) { events.get(name)?.delete(fn); },
    fire(name, data = {}) { for (const fn of events.get(name) || []) fn(data); },
    count() { return [...events.values()].reduce((n, x) => n + x.size, 0); } };
}
function setup() {
  const host = target(), doc = target(), win = target(), timers = new Map(); let next = 0;
  win.setTimeout = fn => { timers.set(++next, fn); return next; }; win.clearTimeout = id => timers.delete(id);
  host.ownerDocument = doc; doc.defaultView = win;
  let selected = '', enabled = true, current = true, generation = 0;
  const copies = [], errors = [], terminal = { getSelection: () => selected, clearSelection() { throw new Error('Automatic copy must preserve selection'); } };
  const binding = attach({ terminal, host, copy: text => { copies.push(text); }, enabled: () => enabled,
    isCurrent: () => current, generation: () => generation, onError: e => errors.push(e.message) });
  return { host, doc, win, terminal, binding, copies, errors,
    select(text) { selected = text; }, enable(value) { enabled = value; }, current(value) { current = value; },
    newGeneration() { generation++; }, start(extra = {}) { host.fire('mousedown', { isTrusted: true, button: 0, ...extra }); },
    finish(extra = {}) { doc.fire('mouseup', { isTrusted: true, button: 0, ...extra }); },
    flush() { const jobs = [...timers.values()]; timers.clear(); for (const job of jobs) job(); },
    selected: () => selected };
}
test('copy occurs once on mouse release, not during dragging; highlight remains', () => {
  const h = setup(); h.start(); h.select('first'); h.select('finished selection'); assert.deepEqual(h.copies, []);
  h.finish(); h.finish(); assert.deepEqual(h.copies, []); h.flush();
  assert.deepEqual(h.copies, ['finished selection']); assert.equal(h.selected(), 'finished selection'); h.binding.dispose();
});
test('double/triple-click and Shift-click selections use the same completed-gesture path', () => {
  const h = setup();
  for (const [text, extra] of [['word', { detail: 2 }], ['whole line', { detail: 3 }], ['extended', { shiftKey: true }]]) {
    h.start(extra); h.select(text); h.finish(extra); h.flush();
  }
  assert.deepEqual(h.copies, ['word', 'whole line', 'extended']); h.binding.dispose();
});
test('release outside the terminal still completes the initiating terminal selection', () => {
  const h = setup(); h.start(); h.select('outside release'); h.doc.fire('mouseup', { isTrusted: true, button: 0 }); h.flush();
  assert.deepEqual(h.copies, ['outside release']); h.binding.dispose();
});
test('Unicode, tabs, whitespace and line breaks are copied without editing', () => {
  const h = setup(), value = '  café 😀\t\nsecond\n'; h.start(); h.select(value); h.finish(); h.flush();
  assert.deepEqual(h.copies, [value]); h.binding.dispose();
});
test('clearing a selection never clears the system clipboard', () => {
  const h = setup(); h.start(); h.select(''); h.finish(); h.flush(); assert.deepEqual(h.copies, []); h.binding.dispose();
});
test('programmatic selection, search and output do not auto-copy without a mouse gesture', () => {
  const h = setup(); h.select('selected by search'); h.doc.fire('selectionchange'); h.finish(); h.flush();
  assert.deepEqual(h.copies, []); h.binding.dispose();
});
test('script-dispatched mouse events are not user intent', () => {
  const h = setup(); h.start({ isTrusted: false }); h.select('script'); h.finish(); h.flush();
  assert.deepEqual(h.copies, []); h.binding.dispose();
});
test('a synthetic mouseup cannot complete a trusted gesture', () => {
  const h = setup(); h.start(); h.select('not yet'); h.finish({ isTrusted: false }); h.flush();
  assert.deepEqual(h.copies, []); h.binding.dispose();
});
test('right and middle mouse gestures never auto-copy', () => {
  const h = setup(); for (const button of [1, 2]) { h.start({ button }); h.select('not copied'); h.finish({ button }); h.flush(); }
  assert.deepEqual(h.copies, []); h.binding.dispose();
});
test('disabled preference leaves the clipboard alone', () => {
  const h = setup(); h.enable(false); h.start(); h.select('off'); h.finish(); h.flush(); assert.deepEqual(h.copies, []); h.binding.dispose();
});
test('disabling between release and callback cancels the pending copy', () => {
  const h = setup(); h.start(); h.select('cancelled'); h.finish(); h.enable(false); h.flush(); assert.deepEqual(h.copies, []); h.binding.dispose();
});
test('enabling after a gesture started while disabled does not copy old selections', () => {
  const h = setup(); h.enable(false); h.start(); h.select('old'); h.enable(true); h.finish(); h.flush(); assert.deepEqual(h.copies, []); h.binding.dispose();
});
for (const reason of ['generation', 'hidden', 'blur', 'pointercancel', 'dispose']) {
  test(`${reason} invalidates a pending clipboard operation`, () => {
    const h = setup(); h.start(); h.select('obsolete'); h.finish();
    if (reason === 'generation') h.newGeneration();
    if (reason === 'hidden') h.current(false);
    if (reason === 'blur') h.win.fire('blur');
    if (reason === 'pointercancel') h.doc.fire('pointercancel');
    if (reason === 'dispose') h.binding.dispose();
    h.flush(); assert.deepEqual(h.copies, []); h.binding.dispose();
  });
}
test('a new gesture supersedes a deferred copy from the previous gesture', () => {
  const h = setup(); h.start(); h.select('old'); h.finish(); h.start(); h.select('new'); h.finish(); h.flush();
  assert.deepEqual(h.copies, ['new']); h.binding.dispose();
});
test('pane bindings do not copy another pane selection on unrelated release', () => {
  const a = setup(), b = setup(); a.select('old pane'); b.start(); b.select('new pane'); a.finish(); b.finish(); a.flush(); b.flush();
  assert.deepEqual(a.copies, []); assert.deepEqual(b.copies, ['new pane']); a.binding.dispose(); b.binding.dispose();
});
test('dispose removes host/document/window listeners and is idempotent', () => {
  const h = setup(); h.binding.dispose(); h.binding.dispose(); assert.equal(h.host.count()+h.doc.count()+h.win.count(), 0);
});
test('clipboard rejection is reported once with no retry and no remote input', async () => {
  const h = setup(); h.binding.dispose();
  const errors = []; let calls = 0;
  const binding = attach({ terminal: h.terminal, host: h.host, enabled: () => true, isCurrent: () => true,
    copy: () => { calls++; return Promise.reject(new Error('Clipboard unavailable')); }, onError: e => errors.push(e.message) });
  h.start(); h.select('sample'); h.finish(); h.flush(); await new Promise(setImmediate); h.flush();
  assert.equal(calls, 1); assert.deepEqual(errors, ['Clipboard unavailable']); binding.dispose();
});
