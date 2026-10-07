'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function handlers() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'ui', 'app.js'), 'utf8');
  const start = source.indexOf("document.addEventListener('keydown', e => {");
  const end = source.indexOf("window.addEventListener('beforeunload'", start);
  assert.ok(start >= 0 && end > start, 'terminal shortcut listeners must be present');
  const listeners = new Map(), calls = [];
  const host = {};
  const view = { host };
  const context = {
    document: {
      querySelector: () => null,
      addEventListener: (type, handler, capture) => listeners.set(type, { handler, capture })
    },
    views: new Map([['disposable-pane', view]]),
    paste: async key => { calls.push(key); },
    run: task => task
  };
  vm.runInNewContext(source.slice(start, end), context);
  return { listeners, calls, host, context };
}

function event(host, key = 'v') {
  let prevented = 0, stopped = 0;
  return {
    key, ctrlKey: true, altKey: false, shiftKey: false,
    target: { closest: selector => selector === '.terminal-host' ? host : null },
    preventDefault: () => prevented++, stopImmediatePropagation: () => stopped++,
    get prevented() { return prevented; }, get stopped() { return stopped; }
  };
}

test('Ctrl+V in a terminal uses the confirmed paste path exactly once', () => {
  const { listeners, calls, host } = handlers();
  assert.equal(listeners.get('keydown').capture, true, 'shortcut must run before xterm key handling');
  const e = event(host);
  listeners.get('keydown').handler(e);
  assert.deepEqual(calls, ['disposable-pane']);
  assert.equal(e.prevented, 1, 'native paste must be suppressed to avoid duplicate input');
  assert.equal(e.stopped, 1);
});

test('Ctrl+V outside a terminal keeps normal text-field paste behavior', () => {
  const { listeners, calls } = handlers();
  const e = event(null);
  listeners.get('keydown').handler(e);
  assert.deepEqual(calls, []);
  assert.equal(e.prevented, 0);
  assert.equal(e.stopped, 0);
});

test('native paste events still use the confirmed path for menu paste', () => {
  const { listeners, calls, host } = handlers();
  const e = event(host);
  listeners.get('paste').handler(e);
  assert.deepEqual(calls, ['disposable-pane']);
  assert.equal(e.prevented, 1);
  assert.equal(e.stopped, 1);
});
