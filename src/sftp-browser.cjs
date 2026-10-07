'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { openSftp, call } = require('./transfer.cjs');
const { publishExport } = require('./storage.cjs');

function remotePath(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\x00-\x1f\x7f-\x9f]/.test(value) || !value || !(value.startsWith('/') || value === '~' || value.startsWith('~/') || value === '.')) {
    throw new Error('Use an absolute remote path or ~/; control characters are not allowed.');
  }
  return value;
}
function safeName(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 255 && value !== '.' && value !== '..' && !/[\/\\\x00-\x1f\x7f-\x9f]/.test(value);
}
function downloadName(value) {
  let name = path.posix.basename(remotePath(value)).replace(/[<>:"/\\|?*\x00-\x1f\x7f-\x9f]/g, '_').replace(/[. ]+$/, '').slice(0, 180);
  if (!name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = 'download-' + (name || 'file');
  return name;
}
async function canonical(s, value, signal, timeoutMs) {
  value = remotePath(value);
  if (value === '~') value = '.';
  else if (value.startsWith('~/')) {
    const home = await call(s, 'realpath', ['.'], signal, timeoutMs);
    value = path.posix.join(remotePath(home), value.slice(2));
  }
  const result = await call(s, 'realpath', [value], signal, timeoutMs);
  if (!remotePath(result).startsWith('/')) throw new Error('The SFTP server did not return an absolute path.');
  return result;
}
function linkedSignal(signal, timeoutMs) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) throw new Error('Invalid SFTP timeout.');
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => controller.abort(new Error('SFTP browsing timed out.')), timeoutMs);
  return { signal: controller.signal, close() { clearTimeout(timer); signal?.removeEventListener('abort', abort); } };
}
async function listDirectory(remote, requested = '~', { signal, timeoutMs = 20000, maxEntries = 1000 } = {}) {
  remotePath(requested);
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 1000) throw new Error('Invalid listing limit.');
  const bound = linkedSignal(signal, timeoutMs); let s;
  try {
    s = await openSftp(remote, bound.signal, timeoutMs);
    const directory = await canonical(s, requested, bound.signal, timeoutMs);
    const handle = await call(s, 'opendir', [directory], bound.signal, timeoutMs);
    const entries = []; let truncated = false, skipped = 0, budget = 0;
    // A handle-based listing avoids ssh2's unbounded whole-directory readdir aggregation.
    while (!truncated) {
      let rows;
      try { rows = await call(s, 'readdir', [handle], bound.signal, timeoutMs); }
      catch (error) {
        // ssh2 reports SSH_FX_EOF (1) as an Error for handle-based READDIR.
        // It is normal end-of-list here, not a browsing failure. All other errors propagate.
        if (error.code === 1) break;
        throw error;
      }
      if (rows === false || Array.isArray(rows) && rows.length === 0) break;
      if (!Array.isArray(rows)) throw new Error('Invalid SFTP directory response.');
      for (const row of rows) {
        bound.signal.throwIfAborted();
        if (entries.length >= maxEntries || budget >= 256 * 1024) { truncated = true; break; }
        if (!safeName(row?.filename)) { skipped++; if (skipped >= 1000) { truncated = true; break; } continue; }
        const a = row.attrs || {}, mode = a.mode;
        const kind = Number.isInteger(mode) ? ((mode & 0o170000) === 0o040000 ? 'directory' : (mode & 0o170000) === 0o100000 ? 'file' : (mode & 0o170000) === 0o120000 ? 'link' : 'other') : 'other';
        const entry = { name: row.filename, path: path.posix.join(directory, row.filename), kind,
          size: Number.isSafeInteger(a.size) && a.size >= 0 ? a.size : null,
          modified: Number.isSafeInteger(a.mtime) && a.mtime >= 0 && a.mtime <= 253402300799 ? a.mtime : null };
        remotePath(entry.path); budget += Buffer.byteLength(JSON.stringify(entry)); entries.push(entry);
      }
    }
    await call(s, 'close', [handle], bound.signal, timeoutMs);
    entries.sort((a, b) => (a.kind === 'directory' ? 0 : 1) - (b.kind === 'directory' ? 0 : 1) || a.name.localeCompare(b.name));
    return { directory, parent: path.posix.dirname(directory), entries, truncated, skipped };
  } finally { bound.close(); try { s?.end(); } catch {} }
}

/** Explicit single-file download. Never opens files, executes them or overwrites a local target. */
async function download(remote, requested, destination, { signal, progress, timeoutMs = 20000, idleTimeoutMs = 30000 } = {}) {
  remotePath(requested);
  if (!path.isAbsolute(destination)) throw new Error('Choose an absolute local destination.');
  for (const n of [timeoutMs, idleTimeoutMs]) if (!Number.isInteger(n) || n < 1 || n > 300000) throw new Error('Invalid download timeout.');
  signal?.throwIfAborted();
  const s = await openSftp(remote, signal, timeoutMs);
  let temporary, handle;
  const req = (method, ...args) => call(s, method, args, signal, timeoutMs);
  try {
    // Resolve only the parent, not the final component: final symlinks are not downloaded implicitly.
    const name = path.posix.basename(requested);
    if (!safeName(name)) throw new Error('Invalid remote filename.');
    const parent = await canonical(s, path.posix.dirname(requested), signal, timeoutMs);
    const target = path.posix.join(parent, name);
    const before = await req('lstat', target);
    if (!before.isFile() || before.isSymbolicLink?.()) throw new Error('Download supports regular files only, not folders or symbolic links.');
    if (!Number.isSafeInteger(before.size) || before.size < 0) throw new Error('Invalid remote file size.');
    handle = await req('open', target, 'r');
    const opened = await req('fstat', handle);
    if (!opened.isFile() || opened.size !== before.size || opened.mtime !== before.mtime) throw new Error('The remote file changed before download. Refresh and try again.');
    // SFTP v3 OPEN follows symlinks and has no portable no-follow flag. Check
    // the final path again after opening to catch a replacement that persists.
    // Another actor can still swap it between checks; this is not atomic identity.
    const selected = await req('lstat', target);
    if (!selected.isFile() || selected.isSymbolicLink?.() || selected.size !== opened.size || selected.mtime !== opened.mtime) throw new Error('The remote file changed or became a symbolic link before download. Refresh and try again.');
    temporary = await fsp.mkdtemp(path.join(path.dirname(destination), '.nerdsshell-download-'));
    await fsp.chmod(temporary, 0o700);
    const temp = path.join(temporary, 'download.part');
    let received = 0, timer, lastProgress = 0;
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    const idle = () => { clearTimeout(timer); timer = setTimeout(() => {
      controller.abort(new Error('SFTP download stalled.')); try { s.end(); } catch {}
    }, idleTimeoutMs); };
    try {
      if (signal?.aborted) abort();
      if (opened.size === 0) await fsp.writeFile(temp, '', { flag: 'wx', mode: 0o600 });
      else {
        const source = s.createReadStream(target, { handle, autoClose: false, start: 0, end: opened.size - 1 });
        const limit = new Transform({ transform(chunk, _encoding, done) {
          received += chunk.length; idle();
          if (received > opened.size) return done(new Error('Server sent more data than the selected file size.'));
          if (Date.now() - lastProgress >= 100) { lastProgress = Date.now(); progress?.({ name, transferred: received, total: opened.size }); }
          done(null, chunk);
        } });
        idle(); await pipeline(source, limit, fs.createWriteStream(temp, { flags: 'wx', mode: 0o600 }), { signal: controller.signal });
      }
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    signal?.throwIfAborted();
    if (received !== opened.size) throw new Error('The remote file ended before its advertised size.');
    const after = await req('fstat', handle);
    if (after.size !== opened.size || after.mtime !== opened.mtime) throw new Error('The remote file changed during download. Local destination was not published.');
    await req('close', handle); handle = undefined;
    signal?.throwIfAborted();
    await publishExport(temp, destination); // Exclusive publication; fails closed on existing files.
    progress?.({ name, transferred: received, total: opened.size, complete: true });
    return destination;
  } finally {
    if (handle) try { await call(s, 'close', [handle], undefined, Math.min(timeoutMs, 1000)); } catch {}
    try { s.end(); } catch {}
    if (temporary) await fsp.rm(temporary, { recursive: true, force: true }); // Only this call's owned temp directory.
  }
}
module.exports = { listDirectory, download, remotePath, downloadName, safeName };
