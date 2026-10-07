/* global $, api, views, fit, run, message */
'use strict';
(function (root) {
  const MAX_HIGHLIGHT_LENGTH = 100000, MAX_HIGHLIGHT_PARTS = 4000;
  // A bounded lexical preview, not a parser or executable Markdown renderer.
  function tokens(text, mode = 'auto') {
    if (typeof text !== 'string') throw new TypeError('Scratchpad text must be a string.');
    if (!['auto', 'plain', 'markdown', 'code', 'powershell'].includes(mode)) mode = 'plain';
    if (mode === 'plain' || text.length > MAX_HIGHLIGHT_LENGTH) return [{ text, kind: '' }];
    if (mode === 'auto') mode = /(^|\n)(#{1,6} |```)|\*\*/.test(text) ? 'markdown' : /\$[A-Za-z_]|\b(Get|Set|Write|New)-[A-Z]/.test(text) ? 'powershell' : 'code';
    const re = /```[^\n]*|\*\*[^*\n]+\*\*|\"(?:[^\"\\\n]|\\.)*\"|'(?:[^'\n]|'')*'|#[^\n]*|\/\/[^\n]*|\$[A-Za-z_][\w:]*|\b(?:if|else|elif|then|fi|for|foreach|while|function|def|return|class|import|from|try|catch|finally|param|true|false|null|sudo)\b|\b(?:Get|Set|Write|New|Start|Stop|Import|Remove|Test|Join)-[A-Za-z]+|\b\d+(?:\.\d+)?\b/gi;
    const result = []; let last = 0;
    for (const match of text.matchAll(re)) {
      if (match.index > last) result.push({ text: text.slice(last, match.index), kind: '' });
      const t = match[0]; let kind = /^['"]/.test(t) ? 'string' : /^#|^\/\//.test(t) ? 'comment' : /^\$/.test(t) ? 'variable' : /^\d/.test(t) ? 'number' : 'keyword';
      if (t.startsWith('**')) kind = mode === 'markdown' ? 'bold' : '';
      if (t.startsWith('```')) kind = 'comment';
      result.push({ text: t, kind }); last = match.index + t.length;
      // Dense code can otherwise create tens of thousands of DOM nodes even
      // within the character limit. Keep the native plain-text editor usable.
      if (result.length >= MAX_HIGHLIGHT_PARTS) return [{ text, kind: '' }];
    }
    if (last < text.length) result.push({ text: text.slice(last), kind: '' });
    return result;
  }
  if (typeof module !== 'undefined') { module.exports = { tokens }; return; }
  const panel = $('scratchpad'), editor = $('scratchText'), mirror = $('scratchHighlight');
  let serial = 0, dirty = false, saved = '', width = 380, timer, dragging, composing = false, wordWrap = false;
  function visibleText() {
    // The textarea owns the current glyphs immediately. A stale mirror must
    // never conceal input while the optional syntax preview is catching up.
    editor.setAttribute('data-highlight', 'pending'); mirror.hidden = true;
  }
  function updateStatus(exactBytes = false) {
    const text = editor.value;
    // UTF-8 is at most four bytes per UTF-16 code unit. Count larger documents
    // only after typing settles, rather than allocating bytes on every key.
    const overLimit = exactBytes && text.length > 262144 && new TextEncoder().encode(text).byteLength > 1048576;
    $('scratchStatus').textContent = `${dirty ? 'Unsaved · ' : ''}${text.length.toLocaleString()} characters · ${overLimit ? 'Over the 1 MiB save limit · ' : ''}Memory only until Save As`;
  }
  function schedulePaint() {
    clearTimeout(timer);
    if (composing) return;
    const revision = serial;
    timer = setTimeout(() => { if (revision !== serial || composing) return; timer = null; paint(); }, 80);
  }
  function changed() {
    serial++; dirty = editor.value !== saved; api.scratchpadDirty(dirty).catch(() => {});
    visibleText(); updateStatus(); schedulePaint();
  }
  function paint() {
    clearTimeout(timer); timer = null;
    if (composing) return;
    updateStatus(true);
    const parts = tokens(editor.value, $('scratchMode').value);
    if (!parts.some(part => part.kind)) {
      mirror.replaceChildren(); mirror.hidden = true; editor.setAttribute('data-highlight', 'plain'); return;
    }
    const fragment = document.createDocumentFragment();
    for (const part of parts) {
      const span = document.createElement('span'); span.className = part.kind ? 'syntax-' + part.kind : ''; span.textContent = part.text; fragment.append(span);
    }
    fragment.append(document.createTextNode('\n')); mirror.replaceChildren(fragment); syncScroll();
    mirror.hidden = false; editor.setAttribute('data-highlight', 'current');
  }
  function syncScroll() { mirror.scrollTop = editor.scrollTop; mirror.scrollLeft = editor.scrollLeft; }
  function resize() { panel.style.width = Math.max(240, Math.min(width, Math.max(240, window.innerWidth - 380))) + 'px'; }
  function show(value) { panel.hidden = !value; $('scratchpadToggle').setAttribute('aria-expanded', String(value)); resize(); if (value) editor.focus(); requestAnimationFrame(() => { for (const v of views.values()) fit(v); }); }
  $('scratchpadToggle').onclick = () => show(panel.hidden); $('scratchCollapse').onclick = () => show(false);
  editor.addEventListener('beforeinput', () => { visibleText(); schedulePaint(); });
  editor.addEventListener('input', changed); editor.addEventListener('scroll', syncScroll);
  editor.addEventListener('compositionstart', () => { composing = true; clearTimeout(timer); visibleText(); });
  editor.addEventListener('compositionend', () => { composing = false; schedulePaint(); });
  $('scratchMode').onchange = () => { visibleText(); paint(); };
  $('scratchWrap').onclick = () => {
    wordWrap = !wordWrap;
    panel.setAttribute('data-wrap', wordWrap ? 'on' : 'off');
    editor.wrap = wordWrap ? 'soft' : 'off';
    $('scratchWrap').setAttribute('aria-pressed', String(wordWrap));
    editor.scrollLeft = 0; syncScroll();
    editor.focus({ preventScroll: true });
  };
  $('scratchBold').onclick = () => { const start = editor.selectionStart, end = editor.selectionEnd; editor.setRangeText('**' + editor.value.slice(start, end) + '**', start, end, 'select'); changed(); editor.focus(); };
  $('scratchOpen').onclick = () => run((async () => { const generation = serial, result = await api.scratchpadRead(); if (!result) return; if (generation !== serial) throw new Error('Scratchpad changed while the file dialog was open. The new file was not loaded.'); editor.value = result.text; saved = editor.value; changed(); paint(); })());
  $('scratchSave').onclick = () => run((async () => { const text = editor.value, result = await api.scratchpadSave(text); if (result) { saved = text; changed(); message('Saved scratchpad to ' + result.name); } })());
  $('scratchCopy').onclick = () => run(api.copy(editor.value));
  const grip = $('scratchGrip');
  grip.onpointerdown = e => { dragging = e.pointerId; grip.setPointerCapture(e.pointerId); e.preventDefault(); };
  grip.onpointermove = e => { if (dragging !== e.pointerId) return; width = window.innerWidth - e.clientX; resize(); };
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) grip.addEventListener(name, () => { dragging = null; });
  grip.onkeydown = e => { if (['ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); width += e.key === 'ArrowLeft' ? 20 : -20; resize(); } };
  window.addEventListener('resize', resize); changed();
})(typeof window === 'undefined' ? globalThis : window);
