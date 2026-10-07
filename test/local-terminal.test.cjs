'use strict';
require('./packaged-local-geometry.test.cjs');
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { Terminal } = require('@xterm/xterm');

function terminal(t, options = {}) {
  const term = new Terminal({ cols: 20, rows: 10, scrollback: 100, allowProposedApi: true,
    windowsPty: { backend: 'conpty' }, ...options });
  t.after(() => term.dispose());
  return term;
}
const write = (term, text) => new Promise(resolve => term.write(text, resolve));
function logicalLines(term) {
  const buffer = term.buffer.active, lines = [];
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i), text = line.translateToString(true);
    if (line.isWrapped && lines.length) lines[lines.length - 1] += text;
    else lines.push(text);
  }
  return lines.filter(Boolean);
}
const terminalFits = new WeakMap();
async function resize(term, cols = 40, rows = term.rows) {
  let h = terminalFits.get(term);
  if (!h) { h = fitHarness({ terminal: term }); terminalFits.set(term, h); }
  h.dimensions.cols = cols; h.dimensions.rows = rows;
  h.context.fit(h.v); await h.v.render;
  assert.equal(h.notices.length, 0, 'The real renderer fitting path must not fail');
}
async function wrappedPrompt(term, history = 16) {
  await write(term, Array.from({ length: history }, (_, i) => `history-${i}\r\n`).join('') +
    'VISIBLE-' + 'x'.repeat(38) + '\r\nPS> ');
}

test('LOCAL widening preserves logical history and keeps input at the displayed prompt', async t => {
  const term = terminal(t); await wrappedPrompt(term);
  const lines = logicalLines(term), y = term.buffer.active.cursorY;
  await resize(term);
  assert.deepEqual(logicalLines(term), lines);
  assert.equal(term.buffer.active.cursorY, y);
  assert.equal(term.buffer.active.getLine(term.buffer.active.baseY + term.buffer.active.cursorY).translateToString(true), 'PS> ');
  assert.equal(term.buffer.active.cursorX, 4);
  await write(term, 'fresh-input');
  assert.equal(term.buffer.active.getLine(term.buffer.active.baseY + term.buffer.active.cursorY).translateToString(true), 'PS> fresh-input');
  assert.equal(term.markers.length, 0, 'Public fitting creates no measurement markers');
});

test('LOCAL widening preserves wide glyph cells and syntax colors', async t => {
  const term = terminal(t);
  await write(term, 'history\r\n'.repeat(16) + '\x1b[31m' + '漢字😀'.repeat(12) + '\x1b[0m\r\nPS> ');
  function cells() {
    const result = [], buffer = term.buffer.active;
    for (let i = 0; i < buffer.length; i++) for (let x = 0; x < term.cols; x++) {
      const cell = buffer.getLine(i).getCell(x);
      if (cell.getChars()) result.push({ chars: cell.getChars(), width: cell.getWidth(), foreground: cell.getFgColor(), mode: cell.getFgColorMode() });
    }
    return result;
  }
  const expected = cells(), y = term.buffer.active.cursorY;
  await resize(term);
  assert.deepEqual(cells(), expected);
  assert.equal(term.buffer.active.cursorY, y);
  assert.equal(term.buffer.active.getLine(term.buffer.active.baseY + term.buffer.active.cursorY).translateToString(true), 'PS> ');
});

test('LOCAL widening respects full history cap and keeps latest output and prompt', async t => {
  const term = terminal(t, { scrollback: 3 }); await wrappedPrompt(term, 50);
  await resize(term);
  assert.ok(term.buffer.active.length <= term.rows + 3);
  assert.ok(term.buffer.active.baseY >= 0 && term.buffer.active.baseY <= 3);
  assert.ok(term.buffer.active.cursorY >= 0 && term.buffer.active.cursorY < term.rows);
  assert.ok(logicalLines(term).includes('VISIBLE-' + 'x'.repeat(38)));
  assert.equal(term.buffer.active.getLine(term.buffer.active.baseY + term.buffer.active.cursorY).translateToString(true), 'PS> ');
  assert.equal(term.markers.length, 0);
});

test('LOCAL widening without scrollback keeps the public terminal prompt correspondence', async t => {
  const term = terminal(t); await wrappedPrompt(term, 0);
  const y = term.buffer.active.cursorY, lines = logicalLines(term);
  assert.equal(term.buffer.active.baseY, 0);
  await resize(term);
  assert.equal(term.buffer.active.cursorY, y - 1);
  assert.deepEqual(logicalLines(term), lines);
  assert.equal(term.markers.length, 0);
});

test('LOCAL widening preserves a fragmented OSC across the resize boundary', async t => {
  const term = terminal(t); await wrappedPrompt(term);
  const titles = []; term.onTitleChange(title => titles.push(title));
  await write(term, '\x1b]0;split-title');
  await resize(term);
  await write(term, '-finished\x07');
  assert.deepEqual(titles, ['split-title-finished']);
  assert.equal(term.buffer.active.getLine(term.buffer.active.baseY + term.buffer.active.cursorY).translateToString(true), 'PS> ');
  assert.equal(term.markers.length, 0);
});

test('LOCAL widening preserves a fragmented CSI and its final attributes', async t => {
  const term = terminal(t); await wrappedPrompt(term);
  await write(term, '\x1b[3'); await resize(term); await write(term, '1mRED');
  const line = term.buffer.active.getLine(term.buffer.active.baseY + term.buffer.active.cursorY);
  assert.equal(line.translateToString(true), 'PS> RED');
  assert.equal(line.getCell(4).getFgColor(), 1);
});

test('LOCAL widening preserves a fragmented DCS payload without injecting commands', async t => {
  const term = terminal(t); await wrappedPrompt(term);
  const payloads = [];
  term.parser.registerDcsHandler({ final: 'q' }, payload => { payloads.push(payload); return true; });
  await write(term, '\x1bPqsplit-payload'); await resize(term); await write(term, '-finished\x1b\\');
  assert.deepEqual(payloads, ['split-payload-finished']);
  assert.equal(term.buffer.active.getLine(term.buffer.active.baseY + term.buffer.active.cursorY).translateToString(true), 'PS> ');
});

test('LOCAL widening retains the application saved cursor at its logical prompt', async t => {
  const term = terminal(t); await wrappedPrompt(term); await write(term, '\x1b7');
  await resize(term); const expected = { x: term.buffer.active.cursorX, y: term.buffer.active.cursorY };
  await write(term, '\x1b[1;1H\x1b8');
  assert.equal(term.buffer.active.cursorX, expected.x); assert.equal(term.buffer.active.cursorY, expected.y);
  assert.equal(term.buffer.active.getLine(term.buffer.active.baseY + term.buffer.active.cursorY).translateToString(true), 'PS> ');
});

for (const [name, prepare, options] of [
  ['alternate screen', term => write(term, '\x1b[?1049h'), {}],
  ['origin mode', term => write(term, '\x1b[?6h'), {}],
  ['partial scroll region', term => write(term, '\x1b[2;8r'), {}],
  ['pending wrap', term => write(term, 'x'.repeat(16)), {}],
  ['busy screen below cursor', term => write(term, '\x1b[10;1HBUSY\x1b[7;5H'), {}],
  ['cursor-line reflow', async () => {}, { reflowCursorLine: true }]
]) test(`LOCAL widening leaves ${name} to the terminal application`, async t => {
  const term = terminal(t, options), control = terminal(t, options);
  await wrappedPrompt(term); await prepare(term);
  await wrappedPrompt(control); await prepare(control);
  control.resize(40, control.rows);
  await resize(term, 40, term.rows);
  const state = value => ({ type: value.buffer.active.type, cursorX: value.buffer.active.cursorX,
    cursorY: value.buffer.active.cursorY, baseY: value.buffer.active.baseY, lines: logicalLines(value),
    windowsPty: value.options.windowsPty, originMode: value.modes.originMode });
  assert.deepEqual(state(term), state(control));
  assert.equal(term.markers.length, 0);
});

test('LOCAL simultaneous width and height changes use only the requested geometry', async t => {
  const term = terminal(t); await wrappedPrompt(term);
  const originalResize = term.resize.bind(term), geometries = [];
  term.resize = (cols, rows) => { geometries.push([cols, rows]); originalResize(cols, rows); };
  await resize(term, 40, 12);
  assert.deepEqual(geometries, [[40, 12]]);
  assert.equal(term.markers.length, 0);
});

async function shrinkablePrompt(term) {
  await wrappedPrompt(term); term.resize(40, 15);
}

test('LOCAL repeated narrowing and growth keep before-Enter input on its prompt and preserve history', async t => {
  const term = terminal(t, { cols: 40 }); await shrinkablePrompt(term);
  const expected = logicalLines(term), base = term.buffer.active.baseY, y = term.buffer.active.cursorY;
  for (let i = 0; i < 12; i++) for (const cols of [20, 40]) {
    await resize(term, cols);
    const buffer = term.buffer.active, expectedY = y;
    assert.equal(buffer.baseY, base + (cols === 20 ? 1 : 0)); assert.equal(buffer.cursorY, expectedY);
    assert.equal(buffer.getLine(buffer.baseY + buffer.cursorY).translateToString(true), 'PS> ');
    const command = `typed-${i}`; await write(term, command);
    assert.equal(buffer.getLine(buffer.baseY + expectedY).translateToString(true), 'PS> ' + command);
    await write(term, '\b'.repeat(command.length) + '\x1b[K');
    assert.deepEqual(logicalLines(term), expected);
    assert.equal(term.rows, 15); assert.equal(term.options.windowsPty.backend, 'conpty'); assert.equal(term.markers.length, 0);
  }
});

test('LOCAL shrinking and regrowth obey a full history cap without losing current visible output', async t => {
  const term = terminal(t, { cols: 40, scrollback: 3 }); await shrinkablePrompt(term);
  for (const cols of [20, 40, 20, 40]) {
    await resize(term, cols);
    const buffer = term.buffer.active;
    assert.ok(buffer.length <= term.rows + 3); assert.ok(buffer.baseY >= 0 && buffer.baseY <= 3);
    assert.ok(buffer.cursorY >= 0 && buffer.cursorY < term.rows);
    assert.equal(buffer.getLine(buffer.baseY + buffer.cursorY).translateToString(true), 'PS> ');
    assert.ok(logicalLines(term).includes('VISIBLE-' + 'x'.repeat(38)));
    assert.equal(term.markers.length, 0);
  }
});

test('LOCAL shrinking preserves split OSC, CSI and DCS without changing ConPTY options', async t => {
  const term = terminal(t, { cols: 40 }); await shrinkablePrompt(term);
  const titles = [], payloads = [];
  term.onTitleChange(title => titles.push(title));
  term.parser.registerDcsHandler({ final: 'q' }, payload => { payloads.push(payload); return true; });
  await write(term, '\x1b]0;first'); await resize(term, 20); await write(term, '-title\x07');
  assert.deepEqual(titles, ['first-title']);
  await resize(term, 40); await write(term, '\x1bPqfirst'); await resize(term, 20); await write(term, '-payload\x1b\\');
  assert.deepEqual(payloads, ['first-payload']);
  await resize(term, 40); await write(term, '\x1b[3'); await resize(term, 20); await write(term, '1mRED');
  const buffer = term.buffer.active, line = buffer.getLine(buffer.baseY + buffer.cursorY);
  assert.equal(line.translateToString(true), 'PS> RED'); assert.equal(line.getCell(4).getFgColor(), 1);
  assert.deepEqual(term.options.windowsPty, { backend: 'conpty' }); assert.equal(term.rows, 15);
});

test('LOCAL shrinking and regrowth preserve an application saved prompt cursor', async t => {
  const term = terminal(t, { cols: 40 }); await shrinkablePrompt(term); await write(term, '\x1b7');
  for (const cols of [20, 40]) {
    await resize(term, cols); const expected = { x: term.buffer.active.cursorX, y: term.buffer.active.cursorY };
    await write(term, '\x1b[1;1H\x1b8');
    assert.equal(term.buffer.active.cursorX, expected.x); assert.equal(term.buffer.active.cursorY, expected.y);
    assert.equal(term.buffer.active.getLine(term.buffer.active.baseY + term.buffer.active.cursorY).translateToString(true), 'PS> ');
  }
});

test('LOCAL shrinking and growth preserve wrapped history and a stable prompt row', async t => {
  const term = terminal(t, { cols: 40 });
  await write(term, 'history\r\n'.repeat(16) + 'VISIBLE-' + 'x'.repeat(118) + '\r\nPS> ');
  term.resize(40, 12);
  const lines = logicalLines(term), base = term.buffer.active.baseY, y = term.buffer.active.cursorY;
  await resize(term, 20);
  assert.equal(term.buffer.active.cursorY, y, 'The public reflow preserves the displayed prompt row');
  assert.equal(term.buffer.active.baseY, base + 3, 'The three additional wrapped rows belong to history');
  assert.deepEqual(logicalLines(term), lines);
  await resize(term, 40);
  assert.equal(term.buffer.active.cursorY, y, 'The round trip retains the original displayed prompt row');
  assert.equal(term.buffer.active.baseY, base);
  assert.equal(term.buffer.active.getLine(term.buffer.active.baseY + term.buffer.active.cursorY).translateToString(true), 'PS> ');
  assert.equal(term.markers.length, 0);
});

test('LOCAL nine-wrap round trip retains the same displayed prompt row before fresh editing', async t => {
  const term = terminal(t, { cols: 40, rows: 39 });
  await write(term, 'history\r\n'.repeat(16) + 'w'.repeat(50).concat('\r\n').repeat(9) + 'short\r\n'.repeat(12) + 'PS> ');
  term.resize(40, 31); term.resize(40, 39);
  const buffer = term.buffer.active, base = buffer.baseY, lines = logicalLines(term);
  assert.equal(buffer.cursorY, 30);
  await resize(term, 20);
  assert.equal(buffer.cursorY, 30); assert.equal(buffer.baseY, base + 9);
  assert.deepEqual(logicalLines(term), lines);
  await resize(term, 40);
  assert.equal(buffer.cursorY, 30); assert.equal(buffer.baseY, base);
  assert.equal(buffer.getLine(buffer.baseY + buffer.cursorY).translateToString(true), 'PS> ');
  await write(term, 'before-enter');
  assert.equal(buffer.getLine(buffer.baseY + buffer.cursorY).translateToString(true), 'PS> before-enter');
  assert.equal(term.options.windowsPty.backend, 'conpty'); assert.equal(term.rows, 39); assert.equal(term.markers.length, 0);
});

test('LOCAL widening preserves a partial viewport group and its history prefix', async t => {
  const term = terminal(t);
  await write(term, 'history\r\n'.repeat(16) + 'G'.repeat(45) + '\r\n' + 'short\r\n'.repeat(8) + 'PS> ');
  const buffer = term.buffer.active, lines = logicalLines(term);
  assert.equal(buffer.cursorY, 9); assert.equal(buffer.getLine(buffer.baseY).isWrapped, true);
  assert.equal(buffer.getLine(buffer.baseY).translateToString(true), 'G'.repeat(5));
  assert.equal(buffer.getLine(buffer.baseY + 1).isWrapped, false);
  await resize(term, 40);
  assert.equal(buffer.cursorY, 9, 'Reflow retains the displayed prompt row');
  assert.equal(buffer.getLine(buffer.baseY).translateToString(true), 'G'.repeat(5));
  assert.deepEqual(logicalLines(term), lines);
  await write(term, 'before-enter');
  assert.equal(buffer.getLine(buffer.baseY + buffer.cursorY).translateToString(true), 'PS> before-enter');
  assert.equal(term.markers.length, 0);
});

test('LOCAL widening preserves partial-group CJK padding, emoji and combining characters', async t => {
  const term = terminal(t);
  await write(term, 'history\r\n'.repeat(16) + 'A'.repeat(59) + '漢😀e\u0301BBB\r\n' + 'short\r\n'.repeat(7) + 'PS> ');
  const buffer = term.buffer.active, lines = logicalLines(term), first = buffer.getLine(buffer.baseY);
  assert.equal(buffer.cursorY, 9); assert.equal(first.isWrapped, true);
  assert.equal(first.getCell(19).getChars(), '', 'Wide glyph padding is not text');
  assert.equal(buffer.getLine(buffer.baseY + 1).getCell(0).getWidth(), 2);
  assert.equal(buffer.getLine(buffer.baseY + 2).isWrapped, false);
  await resize(term, 40);
  assert.equal(buffer.cursorY, 9, 'The displayed prompt stays on its row while the partial group reflows');
  assert.deepEqual(logicalLines(term), lines);
  assert.equal(buffer.getLine(buffer.baseY + buffer.cursorY).translateToString(true), 'PS> ');
  assert.equal(term.markers.length, 0);
});

test('LOCAL partial viewport reflow retains explicit trailing spaces as cells', async t => {
  const term = terminal(t);
  await write(term, 'history\r\n'.repeat(16) + 'A'.repeat(59) + '漢😀e\u0301' + ' '.repeat(19) + '\r\n' + 'short\r\n'.repeat(6) + 'PS> ');
  const buffer = term.buffer.active, lines = logicalLines(term), first = buffer.getLine(buffer.baseY);
  assert.equal(buffer.cursorY, 9); assert.equal(first.isWrapped, true);
  assert.equal(first.getCell(19).getChars(), '');
  assert.equal(buffer.getLine(buffer.baseY + 1).getCell(0).getWidth(), 2);
  assert.equal(buffer.getLine(buffer.baseY + 2).translateToString(true), '   ');
  assert.equal(buffer.getLine(buffer.baseY + 3).isWrapped, false);
  await resize(term, 40);
  assert.equal(buffer.cursorY, 9, 'The displayed prompt stays on its row while explicit space cells reflow');
  assert.deepEqual(logicalLines(term), lines);
  assert.equal(buffer.getLine(buffer.baseY + buffer.cursorY).translateToString(true), 'PS> ');
  assert.equal(term.markers.length, 0);
});

test('LOCAL widening and narrowing restore partial-group history and the displayed prompt', async t => {
  const term = terminal(t);
  await write(term, 'history\r\n'.repeat(16) + 'G'.repeat(45) + '\r\n' + 'short\r\n'.repeat(8) + 'PS> ');
  const buffer = term.buffer.active, lines = logicalLines(term);
  assert.equal(buffer.getLine(buffer.baseY).isWrapped, true);
  await resize(term, 40);
  assert.equal(buffer.cursorY, 9);
  assert.equal(buffer.getLine(buffer.baseY).translateToString(true), 'G'.repeat(5));
  assert.deepEqual(logicalLines(term), lines);
  await resize(term, 20);
  assert.equal(buffer.cursorY, 9);
  assert.deepEqual(logicalLines(term), lines);
  await write(term, 'before-enter');
  assert.equal(buffer.getLine(buffer.baseY + buffer.cursorY).translateToString(true), 'PS> before-enter');
  assert.equal(term.markers.length, 0);
});

for (const [name, text, shortRows, partialRows] of [
  ['one-row ASCII tail', 'G'.repeat(75), 8, 1],
  ['two-row ASCII tail', 'G'.repeat(115), 7, 2],
  ['CJK padding, emoji and combining glyphs', 'A'.repeat(39) + '漢😀e\u0301' + 'B'.repeat(29), 8, 1],
  ['explicit trailing spaces', 'A'.repeat(40) + ' '.repeat(35), 8, 1]
]) test(`LOCAL narrowing preserves ${name} across the viewport boundary`, async t => {
  const term = terminal(t, { cols: 40 });
  await write(term, 'history\r\n'.repeat(16) + text + '\r\n' + 'short\r\n'.repeat(shortRows) + 'PS> ');
  term.resize(40, 13);
  const buffer = term.buffer.active, lines = logicalLines(term), base = buffer.baseY, y = buffer.cursorY;
  assert.equal(y, 9); assert.equal(buffer.getLine(base).isWrapped, true);
  assert.equal(buffer.getLine(base + partialRows).isWrapped, false, 'A surviving marker can bind the end of the partial group');
  const end = term.registerMarker(partialRows - y);
  await resize(term, 30);
  assert.equal(end.isDisposed, false, 'Narrowing must keep the public end marker usable');
  assert.equal(buffer.cursorY, y, 'Partial-group reflow retains the displayed prompt row');
  assert.equal(buffer.baseY, base + 1, 'The additional wrapped row moves into history');
  assert.deepEqual(logicalLines(term), lines);
  assert.equal(buffer.getLine(buffer.baseY + buffer.cursorY).translateToString(true), 'PS> ');
  await write(term, 'before-enter');
  assert.equal(buffer.getLine(buffer.baseY + buffer.cursorY).translateToString(true), 'PS> before-enter');
  end.dispose(); assert.equal(term.markers.length, 0);
  assert.equal(term.options.windowsPty.backend, 'conpty'); assert.equal(term.rows, 13);
});

for (const backend of ['ordinary', 'winpty']) test(`LOCAL fitting uses public geometry for ${backend} terminals`, async t => {
  const term = terminal(t, { windowsPty: backend === 'ordinary' ? {} : { backend } }); await wrappedPrompt(term);
  const originalResize = term.resize.bind(term), geometries = [];
  term.resize = (cols, rows) => { geometries.push([cols, rows]); originalResize(cols, rows); };
  await resize(term);
  assert.deepEqual(geometries, [[40, 10]], 'The only frontend resize comes from the actual fit');
  assert.equal(term.markers.length, 0);
});

function fitHarness({ terminal } = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
  const code = source.slice(source.indexOf('function fit(v)'), source.indexOf('function decode(data)'));
  const events = [], views = new Map(), timers = [], notices = [];
  const dimensions = { cols: 40, rows: 10 };
  const context = { views,
    api: { resize: async (...args) => { events.push(['resize', ...args]); } }, run: p => p,
    updateDimensions() {}, message: text => notices.push(text), clearTimeout() {},
    setTimeout: fn => { timers.push(fn); return timers.length; } };
  vm.runInNewContext(code.slice(0, code.indexOf('function write(')), context);
  const term = terminal || { cols: 20, rows: 10, resize(cols, rows) { this.cols = cols; this.rows = rows; } };
  const v = { pane: { local: true, key: 'local-owned', profileId: 'local:powershell' }, wrapper: { hidden: false }, host: { clientWidth: 600, clientHeight: 400 },
    terminal: term, fit: { fit() { events.push('fit'); term.resize(dimensions.cols, dimensions.rows); } },
    generation: 1, ready: true, render: Promise.resolve() };
  views.set(v.pane.key, v);
  return { context, v, events, views, timers, notices, dimensions };
}

test('LOCAL fitting uses the public addon once for every supported shell identity', async () => {
  for (const profileId of ['local:powershell', 'local:powershell-admin', 'local:pwsh', 'local:pwsh-admin', 'local:cmd', 'local:cmd-admin']) {
    const h = fitHarness(); h.v.pane.profileId = profileId; h.context.fit(h.v); await h.v.render;
    assert.deepEqual(h.events, ['fit'], profileId);
    assert.equal(h.v.terminal.cols, 40); assert.equal(h.v.terminal.rows, 10);
  }
});

test('LOCAL failed fit releases the queue and retains prior terminal geometry', async () => {
  const h = fitHarness(), originalFit = h.v.fit.fit;
  h.v.fit.fit = () => { throw new Error('fit failure'); };
  h.context.fit(h.v); await h.v.render;
  assert.deepEqual(h.notices, ['fit failure']); assert.equal(h.v.fitQueued, false);
  assert.equal(h.v.terminal.cols, 20); assert.equal(h.v.terminal.rows, 10);
  assert.equal(h.timers.length, 0);
  h.v.fit.fit = originalFit; h.context.fit(h.v); await h.v.render;
  assert.deepEqual(h.events, ['fit']); assert.equal(h.timers.length, 1);
});

test('LOCAL fit waits for prior output and sends only final geometry to the backend', async () => {
  const h = fitHarness(); let completeOutput;
  h.v.render = new Promise(resolve => { completeOutput = resolve; });
  h.context.fit(h.v); h.context.fit(h.v);
  assert.deepEqual(h.events, [], 'Output already queued owns the renderer first');
  h.v.render = h.v.render.then(() => { h.events.push('later output'); });
  completeOutput(); await h.v.render;
  assert.deepEqual(h.events, ['fit', 'later output']);
  assert.equal(h.timers.length, 1);
  h.timers[0](); await Promise.resolve();
  assert.deepEqual(h.events[2], ['resize', 'local-owned', 40, 10]);
});

for (const reason of ['generation', 'replacement', 'hidden']) test(`LOCAL queued fit ignores stale ${reason}`, async () => {
  const h = fitHarness(); h.context.fit(h.v);
  if (reason === 'generation') h.v.generation++;
  if (reason === 'replacement') h.views.set(h.v.pane.key, {});
  if (reason === 'hidden') h.v.wrapper.hidden = true;
  await h.v.render;
  assert.deepEqual(h.events, []); assert.equal(h.timers.length, 0); assert.equal(h.v.fitQueued, false);
});

test('LOCAL deferred backend resize ignores a disposed view', async () => {
  const h = fitHarness(); h.context.fit(h.v); await h.v.render;
  h.views.delete(h.v.pane.key); h.timers[0]();
  assert.equal(h.events.filter(event => Array.isArray(event)).length, 0);
});
