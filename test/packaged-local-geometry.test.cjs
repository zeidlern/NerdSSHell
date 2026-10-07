'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const { waitForLocalGeometry } = require('../scripts/Packaged-LocalCmd-Smoke.cjs');
const token = '11111111-2222-4333-8444-555555555555', key = 'local:cmd/standard-' + token;
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function fixture() {
  const dimensions = { cols: 92, rows: 30 }, counts = { evaluate: 0, discover: 0, resize: 0, input: 0, frames: 0 }, observations = [];
  const view = { ready: true, generation: 1, wrapper: { hidden: false }, host: { clientWidth: 900, clientHeight: 500 }, fitQueued: false, render: Promise.resolve(),
    pane: { key, profileId: 'local:cmd', shellId: 'local:cmd', sessionToken: token, local: true, administrator: false },
    terminal: { ...dimensions }, fit: { proposeDimensions: () => ({ ...dimensions }) } };
  const native = { ...view.pane, cols: 92, rows: 30 }, views = new Map([[key, view]]);
  const h = { view, views, native, dimensions, counts, observations, onFrame() {}, advance: async () => {}, discovery: async () => [{ ...native }] };
  const api = Object.freeze({
    discover: async id => { assert.equal(id, 'local:cmd'); counts.discover++; return h.discovery(); },
    resize: () => { counts.resize++; throw Error('The observer must not force a resize'); },
    input: () => { counts.input++; throw Error('The observer must not query a shell'); }
  });
  const context = vm.createContext({ window: {}, views, api, requestAnimationFrame: callback => setImmediate(() => { counts.frames++; h.onFrame(counts.frames); callback(); }) }); context.window = context;
  const evaluate = async expression => { counts.evaluate++; const value = await vm.runInContext(expression, context); return JSON.parse(JSON.stringify(value)); };
  const wait = async (expression, message) => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const settled = await evaluate(expression); observations.push(settled);
      if (settled) return;
      await h.advance(attempt);
    }
    throw Error(message);
  };
  return Object.assign(h, { context, api, evaluate, wait, observe: value => waitForLocalGeometry({ evaluate, wait, key: value || key }) });
}

test('local geometry waits for renderer drain and actual native readback without mutating the API', async () => {
  const h = fixture(), output = deferred(); h.view.render = output.promise; h.native.cols = 120; h.native.rows = 36;
  h.advance = async () => { h.native.cols = 92; h.native.rows = 30; };
  const pending = h.observe(); await tick(); assert.equal(h.counts.discover, 0, 'Pending renderer output owns the fit first');
  output.resolve(); assert.deepEqual(await pending, { cols: 92, rows: 30 });
  assert.deepEqual(h.observations, [false, true]); assert.equal(h.counts.discover, 2);
  assert.equal(h.counts.resize, 0); assert.equal(h.counts.input, 0); assert.equal(h.context.api, h.api); assert.ok(Object.isFrozen(h.api));
  assert.equal(h.context.__smokeLocalGeometry, undefined, 'The completed observer releases its captured view');
});

test('local geometry consumes the queued layout frame and waits for its real native acknowledgment', async () => {
  const h = fixture(); h.onFrame = frame => {
    if (frame === 1) h.view.render = Promise.resolve().then(() => { h.view.terminal.cols = h.dimensions.cols = 100; });
  };
  h.advance = async () => { h.native.cols = 100; };
  assert.deepEqual(await h.observe(), { cols: 100, rows: 30 }); assert.deepEqual(h.observations, [false, true]); assert.equal(h.counts.discover, 2);
  assert.equal(h.counts.frames, 4); assert.equal(h.counts.resize, 0);
});

test('rounded DOM renderer cell metrics do not make a hypothetical fit proposal a native acknowledgment oracle', async () => {
  const h = fixture(), availableWidth = 819, charWidth = 9.0055;
  const propose = cols => Math.floor(availableWidth / (Math.round(charWidth * cols) / cols));
  assert.equal(propose(90), 91); assert.equal(propose(91), 90, 'Faithful DOM canvas rounding can produce a two-cycle with a fixed host');
  Object.assign(h.view.terminal, { cols: 90, rows: 41 }); Object.assign(h.native, { cols: 92, rows: 41 });
  h.view.fit.proposeDimensions = () => ({ cols: propose(h.view.terminal.cols), rows: 41 });
  h.onFrame = frame => { if (frame === 1) h.view.terminal.cols = 91; if (frame === 2) h.view.terminal.cols = 90; };
  h.advance = async () => { h.native.cols = 90; };
  assert.deepEqual(await h.observe(), { cols: 90, rows: 41 }); assert.deepEqual(h.observations, [false, true]);
  assert.equal(h.counts.frames, 4); assert.equal(h.counts.discover, 2); assert.equal(h.counts.resize, 0); assert.equal(h.counts.input, 0);
});

test('a layout changing during discovery cannot accept the prior geometry acknowledgment', async () => {
  const h = fixture(); h.discovery = async () => {
    if (h.counts.discover === 1) { h.dimensions.cols = h.view.terminal.cols = 100; return [{ ...h.native }]; }
    h.native.cols = 100; return [{ ...h.native }];
  };
  assert.deepEqual(await h.observe(), { cols: 100, rows: 30 }); assert.deepEqual(h.observations, [false, true]); assert.equal(h.counts.discover, 2);
});

test('a host changing during discovery is observed in a fresh frame before native geometry is accepted', async () => {
  const h = fixture(); h.discovery = async () => { if (h.counts.discover === 1) h.view.host.clientWidth++; return [{ ...h.native }]; };
  assert.deepEqual(await h.observe(), { cols: 92, rows: 30 }); assert.deepEqual(h.observations, [false, true]); assert.equal(h.counts.frames, 4);
});

test('local geometry rejects remote, administrator, other-shell and malformed keys before IPC', async () => {
  for (const changed of ['fixture/standard-' + token, 'local:cmd-admin/standard-' + token, 'local:powershell/standard-' + token, 'local:cmd/standard-bad', {}, null]) {
    const h = fixture(); await assert.rejects(waitForLocalGeometry({ evaluate: h.evaluate, wait: h.wait, key: changed }), /owned ordinary CMD key/);
    assert.equal(h.counts.evaluate, 0); assert.equal(h.counts.discover, 0);
  }
});

test('local geometry rejects a replaced view or snapshot generation while discovery is pending', async () => {
  for (const change of ['view', 'generation', 'token', 'administrator']) {
    const h = fixture(); h.discovery = async () => {
      if (change === 'view') h.views.set(key, { ...h.view });
      if (change === 'generation') h.view.generation++;
      if (change === 'token') h.view.pane.sessionToken = 'replacement';
      if (change === 'administrator') h.view.pane.administrator = true;
      return [{ ...h.native }];
    };
    await assert.rejects(h.observe(), /target changed/); assert.equal(h.counts.discover, 1); assert.equal(h.context.__smokeLocalGeometry, undefined);
  }
});

test('local geometry validates bounded discovery, live identity and native dimensions', async () => {
  for (const changed of [null, Array.from({ length: 17 }, () => ({})), [], { sessionToken: 'replacement' }, { administrator: true }, { dead: true }, { cols: 1001 }, { rows: 4 }, { cols: 92.5 }]) {
    const h = fixture(); h.discovery = async () => Array.isArray(changed) || changed === null ? changed : [{ ...h.native, ...changed }];
    await assert.rejects(h.observe(), /discovery result|identity changed|native CMD dimensions/);
    assert.equal(h.counts.resize, 0); assert.equal(h.counts.input, 0); assert.equal(h.context.__smokeLocalGeometry, undefined);
  }
});

test('local geometry keeps exact native bounds and never clamps an unusable renderer into a pass', async () => {
  for (const [cols, rows] of [[20, 5], [1000, 500]]) {
    const h = fixture(); Object.assign(h.dimensions, { cols, rows }); Object.assign(h.view.terminal, { cols, rows }); Object.assign(h.native, { cols, rows });
    assert.deepEqual(await h.observe(), { cols, rows });
  }
  for (const [cols, rows] of [[19, 30], [1001, 30], [92, 4], [92, 501], [92.5, 30], [92, NaN]]) {
    const h = fixture(); Object.assign(h.dimensions, { cols, rows }); Object.assign(h.view.terminal, { cols, rows });
    await assert.rejects(h.observe(), /did not acknowledge/); assert.equal(h.counts.discover, 0); assert.equal(h.context.__smokeLocalGeometry, undefined);
  }
});

test('hidden or queued-fit local panes cannot accept an acknowledgment from a prior frame', async () => {
  for (const change of ['hidden', 'fitQueued']) {
    const h = fixture(); if (change === 'hidden') h.view.wrapper.hidden = true; else h.view.fitQueued = true;
    h.advance = async () => { h.view.wrapper.hidden = false; h.view.fitQueued = false; };
    assert.deepEqual(await h.observe(), { cols: 92, rows: 30 }); assert.deepEqual(h.observations, [false, true]); assert.equal(h.counts.discover, 1);
  }
});
