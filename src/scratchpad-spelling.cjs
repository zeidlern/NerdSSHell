'use strict';

const { UI_URL, ORIGIN } = require('./app-protocol.cjs');
const SPELLING_WORLD = 1010;
const MAX_WORD_LENGTH = 256, MAX_SUGGESTIONS = 8;

// No dictionary server receives notes. Windows uses its local spelling APIs;
// any unavailable-language Hunspell fallback remains on our inert app origin.
function configureScratchpadSpelling(session) {
  session.setSpellCheckerDictionaryDownloadURL(`${ORIGIN}/spellcheck-dictionaries/`);
  session.setSpellCheckerLanguages(['en-US']);
  session.setSpellCheckerEnabled(true);
}

// These fixed scripts run only in the already-verified app's main frame. The
// isolated world retains the target element/text locally so the main process
// receives only an opaque revision and the selected misspelled word. Suggestions
// are passed to Electron's editing API, never interpolated into renderer code.
const CAPTURE_TARGET = `(() => {
  let state = globalThis.nerdsshScratchpadSpelling;
  if (!state) {
    state = globalThis.nerdsshScratchpadSpelling = { sequence: 0, target: null };
    state.current = () => {
      const t = state.target, e = document.getElementById('scratchText'), p = document.getElementById('scratchpad');
      return !!t && e === t.element && e.isConnected && document.activeElement === e &&
        !!p && !p.hidden && e.tagName === 'TEXTAREA' && e.spellcheck && !e.disabled && !e.readOnly &&
        e.value === t.text && e.selectionStart === t.start && e.selectionEnd === t.end && e.selectionDirection === t.direction;
    };
    const invalidate = () => { if (!state.current()) state.target = null; };
    document.addEventListener('input', invalidate, true);
    document.addEventListener('change', invalidate, true);
    document.addEventListener('focusin', invalidate, true);
    document.addEventListener('selectionchange', invalidate, true);
  }
  state.target = null;
  const e = document.getElementById('scratchText'), p = document.getElementById('scratchpad');
  if (!e || !p || p.hidden || document.activeElement !== e || !e.isConnected || e.tagName !== 'TEXTAREA' ||
      !e.spellcheck || e.disabled || e.readOnly || e.value.length > 1048576) return null;
  const start = e.selectionStart, end = e.selectionEnd;
  if (end <= start || end - start > 256) return null;
  state.target = { element: e, text: e.value, start, end, direction: e.selectionDirection, token: ++state.sequence };
  return { token: state.target.token, word: e.value.slice(start, end) };
})()`;
const CHECK_TARGET = `(() => {
  const state = globalThis.nerdsshScratchpadSpelling;
  if (!state || !state.current()) { if (state) state.target = null; return null; }
  return state.target.token;
})()`;

function word(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_WORD_LENGTH && !/[\u0000-\u001f\u007f]/u.test(value);
}

function installScratchpadSpelling({ getWindow, Menu }) {
  const owner = getWindow(), contents = owner.webContents;
  let generation = 0;
  const invalidate = () => { generation++; };
  for (const event of ['did-start-navigation', 'render-process-gone', 'destroyed']) contents.on(event, invalidate);
  contents.on('context-menu', (_event, params) => {
    const currentGeneration = ++generation, frame = params?.frame;
    const current = () => {
      try {
        return generation === currentGeneration && getWindow() === owner && !owner.isDestroyed() && !contents.isDestroyed() &&
          owner.webContents === contents && contents.mainFrame === frame && contents.getURL() === UI_URL && frame?.url === UI_URL &&
          contents.focusedFrame === frame;
      } catch { return false; }
    };
    // On Windows 44.4.5 spellcheckEnabled can be false even while the native
    // service supplies suggestions. Verify the actual textarea setting below.
    if (!current() || params.pageURL !== UI_URL || (params.frameURL && params.frameURL !== UI_URL) ||
        params.isEditable !== true || params.formControlType !== 'text-area' || !word(params.misspelledWord)) return;
    // Native context-menu selection identifies the underlined word. Capture and
    // later compare the exact editor, notes and selection before replacing it.
    Promise.resolve().then(async () => {
      if (!current()) return;
      const target = await contents.executeJavaScriptInIsolatedWorld(SPELLING_WORLD, [{ code: CAPTURE_TARGET }]);
      if (!current() || !Number.isSafeInteger(target?.token) || target.word !== params.misspelledWord) return;
      const suggestions = [...new Set((Array.isArray(params.dictionarySuggestions) ? params.dictionarySuggestions : []).slice(0, 64).filter(word))].slice(0, MAX_SUGGESTIONS);
      let used = false;
      const items = suggestions.map(suggestion => ({ label: suggestion.replace(/&/g, '&&'), click: () => {
        if (used || !current()) return;
        used = true;
        Promise.resolve().then(async () => {
          if (!current()) return;
          const token = await contents.executeJavaScriptInIsolatedWorld(SPELLING_WORLD, [{ code: CHECK_TARGET }]);
          if (current() && token === target.token) contents.replaceMisspelling(suggestion);
        }).catch(() => {});
      } }));
      if (!items.length) items.push({ label: 'No spelling suggestions', enabled: false });
      if (current()) Menu.buildFromTemplate(items).popup({ window: owner });
    }).catch(() => {});
  });
}

module.exports = { configureScratchpadSpelling, installScratchpadSpelling, CAPTURE_TARGET, CHECK_TARGET, SPELLING_WORLD };
