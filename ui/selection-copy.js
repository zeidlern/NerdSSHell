'use strict';
// Copy only after a completed local mouse gesture, never on a generic selection
// change: search, snapshots and remote output can also change xterm selections.
(() => {
  function attach({ terminal, host, copy, enabled, isCurrent, generation = () => 0, onError = () => {} }) {
    const doc = host.ownerDocument, win = doc.defaultView;
    let disposed = false, gesture = null, timer = null, serial = 0;
    function cancel() {
      gesture = null; serial++;
      if (timer !== null) { win.clearTimeout(timer); timer = null; }
    }
    function begin(event) {
      cancel();
      if (!event.isTrusted || event.button !== 0 || !enabled() || !isCurrent()) return;
      gesture = { serial, generation: generation() };
    }
    function finish(event) {
      if (!gesture || !event.isTrusted || event.button !== 0) return;
      const completed = gesture; gesture = null;
      // xterm finishes its selection in the same mouseup dispatch. Read after
      // those handlers, including double/triple-click and release outside host.
      timer = win.setTimeout(() => {
        timer = null;
        if (disposed || completed.serial !== serial || completed.generation !== generation() || !enabled() || !isCurrent()) return;
        const text = terminal.getSelection();
        if (!text) return; // Deselecting must not empty the system clipboard.
        try { Promise.resolve(copy(text)).catch(onError); } catch (error) { onError(error); }
        // Do not clear the highlight: Ctrl+C with a selection must stay copy,
        // not unexpectedly become a remote interrupt after automatic copying.
      }, 0);
    }
    host.addEventListener('mousedown', begin, true);
    doc.addEventListener('mouseup', finish, true);
    win.addEventListener('blur', cancel);
    doc.addEventListener('pointercancel', cancel, true);
    return { dispose() {
      if (disposed) return; disposed = true; cancel();
      host.removeEventListener('mousedown', begin, true);
      doc.removeEventListener('mouseup', finish, true);
      win.removeEventListener('blur', cancel);
      doc.removeEventListener('pointercancel', cancel, true);
    } };
  }
  const api = Object.freeze({ attach });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.BetterSSHSelectionCopy = api;
})();
