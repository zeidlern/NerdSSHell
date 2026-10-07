'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { configureScratchpadSpelling, installScratchpadSpelling, SPELLING_WORLD } = require('../src/scratchpad-spelling.cjs');
const { UI_URL, assetPath } = require('../src/app-protocol.cjs');

const turn = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const menus = [], replacements = [], scripts = [], listeners = new Map();
  const editor = { value: 'mispellling notes', selectionStart: 0, selectionEnd: 11, selectionDirection: 'none',
    isConnected: true, tagName: 'TEXTAREA', spellcheck: true, disabled: false, readOnly: false };
  const panel = { hidden: false }, elements = { scratchText: editor, scratchpad: panel };
  const document = { activeElement: editor, getElementById: id => elements[id],
    addEventListener: (name, handler) => { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(handler); } };
  const world = vm.createContext({ document });
  const contents = new EventEmitter(), frame = { url: UI_URL }, owner = { webContents: contents, isDestroyed: () => false };
  let window = owner, destroyed = false;
  Object.assign(contents, { mainFrame: frame, focusedFrame: frame, isDestroyed: () => destroyed, getURL: () => UI_URL,
    executeJavaScriptInIsolatedWorld: async (id, sources) => {
      assert.equal(id, SPELLING_WORLD); assert.equal(sources.length, 1); scripts.push(sources[0].code); return vm.runInContext(sources[0].code, world);
    }, replaceMisspelling: value => replacements.push(value) });
  const Menu = { buildFromTemplate: items => { const menu = { items, popup: ({ window }) => { assert.equal(window, owner); menus.push(menu); } }; return menu; } };
  installScratchpadSpelling({ getWindow: () => window, Menu });
  const params = { frame, pageURL: UI_URL, frameURL: '', isEditable: true, spellcheckEnabled: true, formControlType: 'text-area',
    misspelledWord: 'mispellling', dictionarySuggestions: ['misspelling', 'misfilling'] };
  return { editor, panel, elements, document, menus, replacements, scripts, contents, params, world, owner,
    open: overrides => contents.emit('context-menu', {}, { ...params, ...overrides }),
    event: name => { for (const fn of listeners.get(name) || []) fn(); },
    replaceWindow: () => { window = { ...owner }; }, destroy: () => { destroyed = true; } };
}

test('spelling is local and unavailable dictionaries stay on the blocked application origin', () => {
  const calls = [], session = {
    setSpellCheckerDictionaryDownloadURL: url => calls.push(['url', url]),
    setSpellCheckerLanguages: languages => calls.push(['languages', languages]),
    setSpellCheckerEnabled: enabled => calls.push(['enabled', enabled])
  };
  configureScratchpadSpelling(session);
  assert.deepEqual(calls, [['url', 'betterssh://app/spellcheck-dictionaries/'], ['languages', ['en-US']], ['enabled', true]]);
  assert.equal(assetPath('betterssh://app/spellcheck-dictionaries/en-us-10-1.bdic', 'betterssh://app', __dirname), null);
});

test('native suggestions correct only the same scratchpad selection and can be used once', async () => {
  const h = fixture(); h.open(); await turn();
  assert.equal(h.menus.length, 1); assert.deepEqual(h.menus[0].items.map(x => x.label), ['misspelling', 'misfilling']);
  h.menus[0].items[0].click(); h.menus[0].items[1].click(); await turn();
  assert.deepEqual(h.replacements, ['misspelling']);
  assert.equal(h.scripts.some(code => code.includes('misfilling')), false, 'Correction text never becomes executable renderer code.');
});

test('correction context menu rejects foreign windows, subframes, terminal fields and disabled spelling', async () => {
  for (const override of [{ frame: { url: UI_URL } }, { frame: null }, { pageURL: 'https://foreign.invalid' },
    { frameURL: 'https://foreign.invalid' }, { isEditable: false },
    { formControlType: 'input-text' }, { misspelledWord: '' }, { misspelledWord: 'x'.repeat(257) }]) {
    const h = fixture(); h.open(override); await turn(); assert.deepEqual(h.menus, []); assert.deepEqual(h.scripts, []);
  }
  for (const change of [h => h.replaceWindow(), h => h.destroy(), h => { h.contents.mainFrame = { url: UI_URL }; },
    h => { h.contents.focusedFrame = { url: UI_URL }; }, h => { h.contents.getURL = () => 'https://foreign.invalid'; }]) {
    const h = fixture(); change(h); h.open(); await turn(); assert.deepEqual(h.menus, []); assert.deepEqual(h.scripts, []);
  }
  const disabled = fixture(); disabled.editor.spellcheck = false; disabled.open(); await turn(); assert.deepEqual(disabled.menus, []);
  const native = fixture(); native.open({ spellcheckEnabled: false }); await turn(); assert.equal(native.menus.length, 1, 'Windows native suggestions work despite the inaccurate Chromium flag.');
});

test('scratchpad target guard rejects different or stale elements, notes, focus, selection and visibility', async () => {
  for (const change of [h => { h.document.activeElement = {}; }, h => { h.editor.value += ' changed'; h.event('input'); },
    h => { h.editor.selectionStart = 1; h.event('selectionchange'); }, h => { h.editor.selectionDirection = 'backward'; },
    h => { h.panel.hidden = true; }, h => { h.editor.isConnected = false; }, h => { h.editor.disabled = true; },
    h => { h.editor.readOnly = true; }, h => { h.editor.spellcheck = false; }, h => { h.elements.scratchText = { ...h.editor }; }]) {
    const h = fixture(); h.open(); await turn(); assert.equal(h.menus.length, 1); change(h);
    h.menus[0].items[0].click(); await turn(); assert.deepEqual(h.replacements, []);
  }
  const h = fixture(); h.open(); await turn(); h.editor.value = 'changed'; h.event('input'); h.editor.value = 'mispellling notes';
  h.menus[0].items[0].click(); await turn(); assert.deepEqual(h.replacements, [], 'Changing and restoring notes cannot resurrect an invalidated target.');
});

test('pending and open correction menus cannot cross navigation, process or context changes', async () => {
  for (const change of [h => h.contents.emit('did-start-navigation'), h => h.contents.emit('render-process-gone'),
    h => h.contents.emit('destroyed'), h => h.replaceWindow(), h => h.destroy(),
    h => { h.contents.mainFrame = { url: UI_URL }; }, h => { h.contents.focusedFrame = { url: UI_URL }; }]) {
    const h = fixture(); h.open(); await turn(); change(h); h.menus[0].items[0].click(); await turn(); assert.deepEqual(h.replacements, []);
  }
  const h = fixture(); h.open(); await turn(); const first = h.menus[0]; h.open(); await turn();
  first.items[0].click(); await turn(); assert.deepEqual(h.replacements, []);
  h.menus[1].items[0].click(); await turn(); assert.deepEqual(h.replacements, ['misspelling']);
  const pending = fixture(); let resolve;
  pending.contents.executeJavaScriptInIsolatedWorld = () => new Promise(done => { resolve = done; });
  pending.open(); await turn(); pending.contents.emit('did-start-navigation'); resolve({ token: 1, word: 'mispellling' }); await turn();
  assert.deepEqual(pending.menus, []);
});

test('spelling suggestions are bounded native labels; hostile text stays data and malformed values are ignored', async () => {
  const h = fixture(), hostile = '";globalThis.injected=true;//';
  h.open({ dictionarySuggestions: [null, 7, '', 'x'.repeat(257), 'bad\nword', 'A&B', 'A&B', hostile, ...Array.from({ length: 20 }, (_, i) => 'word' + i)] }); await turn();
  assert.equal(h.menus[0].items.length, 8); assert.equal(h.menus[0].items[0].label, 'A&&B');
  h.menus[0].items[1].click(); await turn(); assert.deepEqual(h.replacements, [hostile]); assert.equal(h.world.injected, undefined);
  const empty = fixture(); empty.open({ dictionarySuggestions: [] }); await turn();
  assert.deepEqual(empty.menus[0].items, [{ label: 'No spelling suggestions', enabled: false }]);
});

test('destroyed or rejecting renderer evaluation leaves notes untouched and does not reject the event loop', async () => {
  const h = fixture(); h.contents.executeJavaScriptInIsolatedWorld = async () => { throw Error('frame destroyed'); };
  h.open(); await turn(); assert.deepEqual(h.menus, []); assert.deepEqual(h.replacements, []);
  const clicked = fixture(); clicked.open(); await turn(); clicked.contents.executeJavaScriptInIsolatedWorld = async () => { throw Error('frame destroyed'); };
  clicked.menus[0].items[0].click(); await turn(); assert.deepEqual(clicked.replacements, []);
});
