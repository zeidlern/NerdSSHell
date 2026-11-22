'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { browserToken } = require('./file-listings.cjs');
const { FILE_PATH_CONTROLS } = require('./file-paths.cjs');
const { remotePath } = require('./sftp-browser.cjs');
const { sameUploadFile } = require('./transfer.cjs');
function inside(root, target) { const relative = path.relative(root, target); return relative === '' || !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative); }
function localPath(value) {
  if (typeof value !== 'string' || value.length > 4096 || !path.isAbsolute(value) || FILE_PATH_CONTROLS.test(value)) throw new Error('Choose an absolute local folder without control characters.');
  return value;
}
/** Grants are scoped to one live file-browser/view. Only native folder selection expands a grant. */
class LocalFiles {
  constructor(fileOwner, { home = os.homedir(), io = fs, timeoutMs = 10000 } = {}) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) throw new Error('Invalid local directory timeout.');
    this.fileOwner = fileOwner; this.home = home; this.io = io; this.timeoutMs = timeoutMs; this.records = new Map(); this.pending = 0;
  }
  record(key, id) {
    browserToken(id); const owner = this.fileOwner(key);
    for (const [token, record] of this.records) if (!record.owner.valid()) this.records.delete(token);
    let record = this.records.get(id);
    if (record && (record.key !== key || record.owner.remote !== owner.remote || record.owner.view !== owner.view)) throw new Error('Local file panel belongs to another session.');
    if (!record) {
      if (this.records.size >= 64) throw new Error('Too many file browsers. Close an unused session first.');
      record = { key, owner, root: null, directory: null, entries: [], version: 0, busy: false, remote: null, remoteVersion: 0 }; this.records.set(id, record);
    }
    owner.validate(); return record;
  }
  clearRemote(key, id) { const r = this.record(key, id); r.remote = null; r.remoteVersion++; }
  rememberRemote(key, id, result) {
    const r = this.record(key, id);
    remotePath(result.directory);
    r.remote = { directory: result.directory, entries: result.entries.filter(item => item.kind === 'file').map(item => ({ path: item.path })) };
  }
  captureRemote(key, id, value, upload = false) {
    const r = this.record(key, id), listing = r.remote, version = r.remoteVersion;
    if (!listing || (upload ? listing.directory !== value : !listing.entries.some(item => item.path === value))) throw new Error('Refresh this pane and select its listed Remote file or destination.');
    const validate = () => { r.owner.validate(); if (r.remote !== listing || r.remoteVersion !== version) throw new Error('Remote folder changed. Review the transfer again.'); };
    validate(); return { validate };
  }
  async list(key, id, directory, grantedRoot) {
    const r = this.record(key, id);
    if (r.busy || this.pending >= 8) throw new Error('Wait for the current local folder listing to finish.');
    r.busy = true; this.pending++; const version = ++r.version, deadline = Date.now() + this.timeoutMs;
    let timedOut = false, timer;
    const validate = () => { r.owner.validate(); if (timedOut || r.version !== version || Date.now() > deadline) throw new Error('Local directory request changed or timed out.'); };
    // Clear old selection authorization before an asynchronous read, including failed refreshes.
    r.entries = [];
    const timeout = new Promise((_resolve, reject) => { timer = setTimeout(() => { timedOut = true; reject(new Error('Local directory request timed out. Refresh when the filesystem is available.')); }, this.timeoutMs); });
    const operation = (async () => { try {
      const root = localPath(grantedRoot ? await this.io.realpath(localPath(grantedRoot)) : r.root || await this.io.realpath(this.home));
      if (await this.io.realpath(root) !== root) throw new Error('The chosen local root changed on disk. Use Browse again.');
      const target = localPath(await this.io.realpath(directory === '~' || !directory ? root : localPath(directory)));
      if (!inside(root, target)) throw new Error('This path is outside the chosen local folder. Use Browse to choose another location.');
      validate(); const entries = []; let scanned = 0, bytes = 0, truncated = false;
      const dir = await this.io.opendir(target);
      try {
        for await (const item of dir) {
          validate(); if (++scanned > 1000) { truncated = true; break; }
          if (FILE_PATH_CONTROLS.test(item.name)) continue;
          const full = path.join(target, item.name); let stat;
          try { stat = await this.io.lstat(full); } catch { continue; }
          validate(); const entry = { name: item.name, path: full, kind: stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other', size: stat.size, modified: Math.floor(stat.mtimeMs / 1000) };
          bytes += Buffer.byteLength(JSON.stringify(entry)); if (bytes > 262144) { truncated = true; break; } entries.push(entry);
        }
      } finally { try { await dir.close(); } catch (e) { if (e.code !== 'ERR_DIR_CLOSED') throw e; } }
      validate(); entries.sort((a,b) => (a.kind !== 'directory') - (b.kind !== 'directory') || a.name.localeCompare(b.name));
      r.root = root; r.directory = target; r.entries = entries;
      return { root, directory: target, parent: inside(root, path.dirname(target)) ? path.dirname(target) : root, entries, truncated };
    } finally { r.busy = false; this.pending--; clearTimeout(timer); } })();
    // Filesystem calls cannot always be cancelled (for example a stalled UNC
    // share). Report timeout promptly but retain the reservation until cleanup.
    return Promise.race([operation, timeout]);
  }
  async capture(key, id, file) {
    const r = this.record(key, id); if (r.busy || !r.directory) throw new Error('Load a local folder first.');
    const version = r.version, directory = r.directory, root = r.root;
    const validate = () => { r.owner.validate(); if (r.version !== version || r.directory !== directory) throw new Error('Local folder changed. Review the transfer again.'); };
    validate(); const actual = await this.io.realpath(directory); validate();
    if (actual !== directory || !inside(root, actual)) throw new Error('Local folder changed on disk. Refresh first.');
    let selected, identity;
    if (file !== undefined) {
      selected = r.entries.find(item => item.path === file && item.kind === 'file');
      if (!selected) throw new Error('Select a regular file from this local panel.');
      const stat = await this.io.lstat(file, { bigint: true }), real = await this.io.realpath(file); validate();
      if (!stat.isFile() || real !== file || !inside(root, real) || Number(stat.size) !== selected.size || Math.floor(Number(stat.mtimeMs) / 1000) !== selected.modified) throw new Error('Selected local file changed. Refresh first.');
      identity = stat;
      selected = { ...selected };
    }
    return { owner: r.owner, directory, selected, validate, revalidate: async sources => {
      validate(); const current = await this.io.realpath(directory), currentRoot = await this.io.realpath(root);
      if (current !== directory || currentRoot !== root || !inside(root, current)) throw new Error('Local folder changed on disk.');
      if (selected) {
        const stat = await this.io.lstat(selected.path, { bigint: true }), real = await this.io.realpath(selected.path);
        if (!sameUploadFile(stat, identity) || real !== selected.path || !inside(root, real)) throw new Error('Selected local file changed. Refresh first.');
        if (sources && (sources.length !== 1 || sources[0].file !== selected.path || !sameUploadFile(sources[0].stat, identity))) throw new Error('Selected local file changed. Review the upload again.');
      }
      validate();
    } };
  }
}
module.exports = { LocalFiles, inside, localPath };
