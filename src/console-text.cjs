'use strict';
// Startup readiness and native assertions inspect bounded, accumulated output.
// The renderer still receives the original bytes. Stop each OSC at its FIRST
// BEL/ST, and hide an unfinished OSC until a later chunk completes it; title
// payloads must neither erase subsequent visible text nor impersonate a prompt.
// CUP/HVP to column one separates startup lines even without CR/LF (ConPTY
// redraws CMD's banner this way). Empty/zero positions default to one. This is
// a plain-text approximation, not screen reconstruction: other cursor moves,
// overwrites and erasures are not modeled, and incomplete CSI stays guarded.
function consoleText(text) {
  return text.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\|$)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, sequence =>
      /^\x1b\[\d*(?:;0*1?)?[Hf]$/.test(sequence) ? '\n' : '');
}
module.exports = { consoleText };
