'use strict';
const fs = require('node:fs'), path = require('node:path'), { randomUUID } = require('node:crypto');
const { publishExport } = require('./storage.cjs');
const MAX_NOTE = 1024 * 1024;
function noteText(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > MAX_NOTE || value.includes('\0')) throw new Error('Scratchpad supports UTF-8 text up to 1 MiB, without NUL characters.');
  return value;
}
function readNoteFile(filename) {
  const fd = fs.openSync(filename, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_NOTE) throw new Error('Choose a text file no larger than 1 MiB.');
    const buffer = Buffer.alloc(MAX_NOTE + 1); let length = 0, count;
    // A short read does not imply EOF, including on network filesystems.
    while (length < buffer.length && (count = fs.readSync(fd, buffer, length, buffer.length - length, null))) length += count;
    if (length > MAX_NOTE) throw new Error('File grew beyond the 1 MiB limit.');
    return noteText(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)));
  } finally { fs.closeSync(fd); }
}
function saveNewNoteFile(filename, text) {
  noteText(text);
  const temp = filename + '.' + randomUUID() + '.tmp';
  // The native dialog alone cannot authorize a later concurrent overwrite.
  const fd = fs.openSync(temp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, text, { encoding: 'utf8' });
    fs.fsyncSync(fd);
    publishExport(temp, filename);
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(temp);
  }
}
function installDesktopTools({ handle, app, dialog, getWindow, confirm, adminLaunch = async () => { throw new Error('Embedded administrator hosting is unavailable.'); } }) {
  let adminBusy = false, noteBusy = false;
  handle('localAdminOpen', async id => {
    if (adminBusy) throw new Error('Finish or cancel the current Windows UAC prompt first.');
    if (!['local:powershell', 'local:pwsh', 'local:cmd'].includes(id)) throw new Error('Choose a local shell installation.');
    adminBusy = true;
    try { return await adminLaunch(id); } finally { adminBusy = false; }
  });
  handle('scratchpadDirty', dirty => { if (typeof dirty !== 'boolean') throw new Error('Invalid scratchpad state.'); app.nerdsshellScratchpadDirty = dirty; app.nerdsshellScratchpadRevision = (app.nerdsshellScratchpadRevision || 0) + 1; });
  handle('scratchpadRead', async () => {
    if (noteBusy) throw new Error('Finish the current scratchpad file dialog first.');
    noteBusy = true;
    try {
      if (app.nerdsshellScratchpadDirty && !await confirm('Replace scratchpad?', 'Discard unsaved scratchpad edits and open another file?', 'Cancel to keep editing or Save As first.')) return null;
      const result = await dialog.showOpenDialog(getWindow(), { title: 'Open text in scratchpad', properties: ['openFile'], filters: [{ name: 'Text and code', extensions: ['txt', 'md', 'ps1', 'sh', 'py', 'json', 'yaml', 'yml', 'log'] }, { name: 'All files', extensions: ['*'] }] });
      if (result.canceled) return null;
      if (!Array.isArray(result.filePaths) || result.filePaths.length !== 1 || !path.isAbsolute(result.filePaths[0])) throw new Error('Choose one text file.');
      return { text: readNoteFile(result.filePaths[0]), name: path.basename(result.filePaths[0]) };
    } finally { noteBusy = false; }
  });
  handle('scratchpadSave', async text => {
    noteText(text); if (noteBusy) throw new Error('Finish the current scratchpad file dialog first.');
    noteBusy = true;
    try {
      const result = await dialog.showSaveDialog(getWindow(), { title: 'Save scratchpad as a NEW file', defaultPath: 'notes.md', filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'Text', extensions: ['txt'] }] });
      if (result.canceled || !result.filePath) return null;
      if (!path.isAbsolute(result.filePath)) throw new Error('Choose a new local file.');
      saveNewNoteFile(result.filePath, text);
      return { name: path.basename(result.filePath) };
    } finally { noteBusy = false; }
  });
}
module.exports = { noteText, readNoteFile, saveNewNoteFile, installDesktopTools, MAX_NOTE };
