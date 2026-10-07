'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const OPERATION_TIMEOUT_MS = 20000;
const STREAM_IDLE_TIMEOUT_MS = 30000;
// Listings and transfers share the transport's channel budget. A caller timing
// out does not mean ssh2 has completed its underlying channel-open request.
const SFTP_CHANNEL_LIMIT = 20;
const sftpTransports = new WeakMap();
let outstandingSftpChannels = 0;
function reserveSftp(remote) {
  const transport = remote.client || remote;
  if (outstandingSftpChannels >= SFTP_CHANNEL_LIMIT) throw new Error('Too many outstanding SFTP channels. Wait for cleanup or reconnect the server.');
  let state = sftpTransports.get(transport);
  if (!state) { state = { leases: new Set() }; sftpTransports.set(transport, state); }
  const observable = typeof transport.once === 'function' && typeof transport.off === 'function';
  const lease = { released: false, observable, onClose: null, release() {
    if (lease.released) return;
    lease.released = true; outstandingSftpChannels--; state.leases.delete(lease);
    if (!state.leases.size && observable) transport.off('close', state.closed);
  } };
  if (!state.leases.size && observable) {
    state.closed = () => { for (const pending of [...state.leases]) { pending.onClose?.(); pending.release(); } };
    transport.once('close', state.closed);
  }
  state.leases.add(lease); outstandingSftpChannels++;
  return lease;
}
function cancelled(signal) { return signal?.reason instanceof Error ? signal.reason : new Error('Transfer cancelled.'); }
function bounded(value, fallback) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > 300000) throw new Error('Invalid transfer timeout.');
  return value;
}
function openSftp(remote, signal, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false, timer, lease;
    const finish = (error, sftp) => {
      if (sftp) {
        sftp.on?.('error', () => {});
        // Production transports retain their reservation until channel CLOSE,
        // including a channel delivered after timeout/cancellation. Minimal
        // injected remotes without a transport lifecycle only account opens.
        if (lease.observable) sftp.once?.('close', lease.release);
        else lease.release();
      }
      if (settled || lease?.released && lease.observable) { try { sftp?.end(); } catch {} return; }
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(sftp);
    };
    const abort = () => finish(cancelled(signal));
    if (signal?.aborted) { reject(cancelled(signal)); return; }
    try { lease = reserveSftp(remote); } catch (error) { reject(error); return; }
    lease.onClose = () => finish(new Error('SSH transport closed while opening SFTP.'));
    timer = setTimeout(() => finish(new Error('Opening the SFTP channel timed out.')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); lease.release(); return; }
    Promise.resolve().then(() => {
      if (settled) { lease.release(); return; }
      return remote.sftp();
    }).then(s => { if (s) finish(null, s); }, e => { finish(e); lease.release(); });
  });
}
function call(s, method, args, signal, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); s.off?.('error', failed); s.off?.('close', closed);
      if (error) reject(error); else resolve(value);
    };
    const failed = error => finish(error), closed = () => finish(new Error('SFTP channel closed.'));
    s.once?.('error', failed); s.once?.('close', closed);
    const stop = error => { finish(error); try { s.end(); } catch {} };
    const abort = () => stop(cancelled(signal));
    const timer = setTimeout(() => stop(new Error(`SFTP ${method} timed out; the server outcome is unknown.`)), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    try { s[method](...args, (error, value) => finish(error, value)); } catch (error) { finish(error); }
  });
}
async function writeTemp(s, local, temp, stat, progress, signal, idleTimeoutMs) {
  const source = fs.createReadStream(local), destination = s.createWriteStream(temp, { flags: 'wx', mode: 0o600 });
  const controller = new AbortController(); let transferred = 0, timer, lastProgress = 0;
  const abort = () => controller.abort(cancelled(signal));
  const idle = () => { clearTimeout(timer); timer = setTimeout(() => {
    controller.abort(new Error('SFTP upload stalled; the remote outcome is unknown.'));
    try { s.end(); } catch {}
  }, idleTimeoutMs); };
  destination.on('drain', idle);
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) abort();
    idle(); const task = pipeline(source, destination, { signal: controller.signal });
    source.on('data', bytes => {
      transferred += bytes.length; idle();
      if (Date.now() - lastProgress >= 100) { lastProgress = Date.now(); progress?.({ transferred, total: stat.size }); }
    });
    await task;
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
  }
}
async function upload(remote, files, { confirmOverwrite, progress, signal, timeoutMs, idleTimeoutMs, directory } = {}) {
  if (!Array.isArray(files) || files.length < 1 || files.length > 50) throw new Error('Choose 1–50 files. Folder upload is not supported.');
  timeoutMs = bounded(timeoutMs, OPERATION_TIMEOUT_MS);
  idleTimeoutMs = bounded(idleTimeoutMs, STREAM_IDLE_TIMEOUT_MS);
  signal?.throwIfAborted();
  const s = await openSftp(remote, signal, timeoutMs); const results = [];
  const request = (method, ...args) => call(s, method, args, signal, timeoutMs);
  try {
    const home = await request('realpath', '.');
    let dir = directory ?? remote.profile.uploadDirectory;
    if (typeof dir !== 'string' || dir.length > 4096 || /[\x00-\x1f\x7f-\x9f]/.test(dir)) throw new Error('Invalid upload directory.');
    if (dir === '~') dir = home;
    else if (dir.startsWith('~/')) dir = path.posix.join(home, dir.slice(2));
    if (!dir.startsWith('/')) throw new Error('The upload folder must be an absolute Linux path or start with ~/.');
    dir = path.posix.normalize(dir);
    let current = '/';
    for (const component of dir.split('/').filter(Boolean)) {
      current = path.posix.join(current, component);
      let stat;
      try { stat = await request('lstat', current); }
      catch (error) {
        if (error.code !== 2) throw error;
        try { await request('mkdir', current, { mode: 0o700 }); }
        catch (mkdirError) { if (mkdirError.code !== 4 && mkdirError.code !== 11) throw mkdirError; }
        stat = await request('lstat', current);
      }
      if (stat.isSymbolicLink?.()) throw new Error(`Upload folder contains a symbolic link: ${current}`);
      if (!stat.isDirectory()) throw new Error(`${current} is not a directory.`);
    }
    for (const local of files) {
      signal?.throwIfAborted();
      const stat = await fsp.lstat(local); if (!stat.isFile()) throw new Error('Only regular files can be uploaded.');
      const name = path.basename(local); if (/[\x00-\x1f\x7f-\x9f]/.test(name)) throw new Error('Filenames containing control characters cannot be uploaded.');
      const target = path.posix.join(dir, name); const temp = path.posix.join(dir, `.nerdsshell-${randomUUID()}.part`);
      let existing;
      try { existing = await request('lstat', target); } catch (error) { if (error.code !== 2) throw error; }
      if (existing?.isSymbolicLink?.()) throw new Error('The destination is a symbolic link. Upload to a different filename.');
      if (existing && !await confirmOverwrite(target)) continue;
      signal?.throwIfAborted();
      let published = false;
      try {
        await writeTemp(s, local, temp, stat, data => progress?.({ name, ...data }), signal, idleTimeoutMs);
        signal?.throwIfAborted();
        if (existing) {
          // OpenSSH POSIX rename replaces only after explicit overwrite confirmation.
          // Another actor can change the target while the user decides or upload runs.
          await request('ext_openssh_rename', temp, target);
          published = true;
        } else {
          // This extension is exclusive: concurrent target creation fails. Ordinary SFTP
          // rename does not promise no-overwrite behavior across servers.
          try { await request('ext_openssh_hardlink', temp, target); }
          catch (error) {
            if (error.code === 8) throw new Error('This SFTP server lacks exclusive file publishing; upload was not completed.');
            throw error;
          }
          published = true;
          try { await request('unlink', temp); }
          catch (error) { throw new Error(`Upload was published, but temporary-file cleanup failed: ${error.message}`); }
        }
        progress?.({ name, transferred: stat.size, total: stat.size, complete: true }); results.push(target);
      } catch (error) {
        if (!published) try { await call(s, 'unlink', [temp], undefined, Math.min(timeoutMs, 5000)); } catch {}
        throw error;
      }
    }
    return results;
  } finally { try { s.end(); } catch {} }
}
module.exports = { upload, openSftp, call, SFTP_CHANNEL_LIMIT };
