/* Command extraction is intentionally non-executing; never joins separate blocks or rewrites prompts. */
(function (root, factory) {
  const value = factory(); if (typeof module === 'object' && module.exports) module.exports = value;
  else root.NerdSSHellCommandReview = value;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function extractBlocks(text) {
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > 65536) throw new Error('Paste up to 64 KiB of instructions at a time.');
    const lines = text.replace(/\r\n?/g, '\n').split('\n'), blocks = [];
    let current = null;
    for (const line of lines) {
      if (!current) {
        const start = /^ {0,3}(`{3,}|~{3,})([^`~]*)$/.exec(line);
        if (start) current = { marker: start[1][0], count: start[1].length, language: start[2].trim().slice(0, 60), lines: [] };
      } else {
        if (new RegExp('^ {0,3}' + current.marker + '{' + current.count + ',}\\s*$').test(line)) {
          blocks.push({ language: current.language || 'unspecified', code: current.lines.join('\n') }); current = null;
          if (blocks.length > 32) throw new Error('Too many code blocks. Paste a smaller section.');
        } else current.lines.push(line);
      }
    }
    if (current) throw new Error('A code fence is incomplete. Finish it or paste the command directly in the editor.');
    return blocks;
  }
  function visibleText(text) {
    return text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/gu,
      c => `[U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}]`);
  }
  function outputExcerpt(terminal, maxLines = 200, maxBytes = 131072) {
    if (!Number.isInteger(maxLines) || maxLines < 1 || maxLines > 200 || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 131072)
      throw new Error('Excerpt limits must be 1–200 rows and 1–128 KiB.');
    const buffer = terminal.buffer.active, lines = [], encoder = new TextEncoder();
    const start = Math.max(0, buffer.length - maxLines); let used = 0;
    for (let i = buffer.length - 1; i >= start; i--) {
      const line = buffer.getLine(i); if (!line) continue;
      const continued = !!lines[0]?.wrapped;
      // A soft-wrapped predecessor can end in an actual space. Do not trim it.
      // Empty padding before a wide glyph is different from an explicit space.
      let end = line.length;
      if (continued && Number.isInteger(end) && typeof line.getCell === 'function') {
        while (end > 0) { const cell = line.getCell(end - 1); if (!cell || cell.getWidth() !== 1 || cell.getChars() !== '') break; end--; }
      }
      const text = visibleText(line.translateToString(!continued, 0, end)), size = encoder.encode(text).length;
      const separator = lines.length && !lines[0].wrapped ? 1 : 0;
      if (used + size + separator > maxBytes) break;
      used += size + separator; lines.unshift({ text, wrapped: line.isWrapped });
    }
    return { text: lines.map((line, i) => (i && !line.wrapped ? '\n' : '') + line.text).join(''),
      rows: lines.length, bytes: used, omittedRows: Math.max(0, buffer.length - lines.length),
      startsMidLine: !!lines[0]?.wrapped, buffer: buffer.type || 'active', rowLimit: maxLines, byteLimit: maxBytes };
  }
  function selectionText(terminal, maxLines = 200, maxBytes = 131072) { return outputExcerpt(terminal, maxLines, maxBytes).text; }
  return { extractBlocks, selectionText, outputExcerpt, visibleText };
});
