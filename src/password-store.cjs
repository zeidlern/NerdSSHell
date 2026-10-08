'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { hostName } = require('./quick-connect.cjs');
const { randomUUID } = require('node:crypto');

const MAX_PASSWORD_BYTES = 16 * 1024;
const MAX_CIPHERTEXT_BYTES = 24 * 1024;
const MAX_RECORDS = 256;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const FILE_NAME = 'remembered-passwords.json';
const MESSAGES = Object.freeze({
  PASSWORD_STORAGE_UNAVAILABLE: 'Remembering passwords requires available Windows account encryption.',
  PASSWORD_STORAGE_READ_FAILED: 'Cannot read remembered passwords. The saved file has not been changed.',
  PASSWORD_STORAGE_WRITE_FAILED: 'Cannot update remembered passwords. The previous saved file has been preserved.',
  PASSWORD_STORAGE_INVALID_RECORD: 'This remembered password cannot be unlocked for this connection. Forget it and sign in again.',
  PASSWORD_STORAGE_INVALID_PROFILE: 'Invalid connection identity for remembered passwords.',
  PASSWORD_STORAGE_INVALID_PASSWORD: 'The password must be nonempty and at most 16 KiB.',
  PASSWORD_STORAGE_FULL: 'The remembered-password storage limit has been reached.'
});
function failure(code) { const error = new Error(MESSAGES[code]); error.code = code; return error; }
const NATIVE_CODES = new Set(['EACCES', 'EPERM', 'EBUSY', 'EEXIST', 'ENOENT', 'ENOSPC', 'EIO', 'EMFILE', 'ENFILE', 'EROFS', 'EINVAL', 'ENOTDIR', 'EISDIR', 'ENOTEMPTY', 'EXDEV']);
const WINDOWS_LOCK_CODES = new Set(['EACCES', 'EPERM', 'EBUSY']);
const RETRY_DELAYS = Object.freeze([20, 40, 80, 80]);
function writeFailure(cause, step) {
  const error = failure('PASSWORD_STORAGE_WRITE_FAILED'); error.storageStep = step;
  if (NATIVE_CODES.has(cause?.code)) error.nativeCode = cause.code;
  return error;
}
function profileId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) throw failure('PASSWORD_STORAGE_INVALID_PROFILE');
  return value;
}
function validHost(value) { try { hostName(value.trim()); return true; } catch { return false; } }
function identity(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile) || profile.auth !== 'password') throw failure('PASSWORD_STORAGE_INVALID_PROFILE');
  const id = profileId(profile.id);
  if (typeof profile.host !== 'string' || profile.host.length > 253 || /[\x00-\x1f\x7f]/.test(profile.host) || !validHost(profile.host) ||
      typeof profile.username !== 'string' || profile.username.length > 128 || /[\x00-\x1f\x7f]/.test(profile.username) || !/^[A-Za-z0-9_][A-Za-z0-9_.@-]*$/.test(profile.username.trim()) ||
      !Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65535) throw failure('PASSWORD_STORAGE_INVALID_PROFILE');
  return { profileId: id, host: profile.host.trim().toLowerCase(), port: profile.port, username: profile.username.trim() };
}
function validPassword(value) { return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value, 'utf8') <= MAX_PASSWORD_BYTES && !value.includes('\0'); }
function regular(stat) { return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && Number.isSafeInteger(stat.size) && stat.size <= MAX_FILE_BYTES; }
function sameFile(a, b) { return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs; }
function sameDirectory(a, b) { return a.dev === b.dev && a.ino === b.ino && b.isDirectory() && !b.isSymbolicLink(); }

/** Main-process-only encrypted storage. Plaintext never reaches settings, backups or this file. */
class PasswordStore {
  constructor(directory, safeStorage, options = {}) {
    if (typeof directory !== 'string' || !directory || !path.isAbsolute(directory)) throw failure('PASSWORD_STORAGE_INVALID_PROFILE');
    this.directory = path.resolve(directory); this.file = path.join(this.directory, FILE_NAME);
    this.safeStorage = safeStorage; this.platform = options.platform ?? process.platform; this.fs = options.fs ?? fs;
    this.retryWait = options.retryWait ?? (milliseconds => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds));
  }
  isAvailable() {
    if (this.platform !== 'win32' || typeof this.safeStorage?.encryptString !== 'function' || typeof this.safeStorage?.decryptString !== 'function') return false;
    try { return this.safeStorage.isEncryptionAvailable() === true; } catch { return false; }
  }
  _requireAvailable() { if (!this.isAvailable()) throw failure('PASSWORD_STORAGE_UNAVAILABLE'); }
  _directories(create = false) {
    const chain = []; let current = this.directory;
    while (true) {
      try {
        const stat = this.fs.lstatSync(current);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe directory.');
        chain.push({ file: current, stat });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        // The selected userData leaf may be new; never create or traverse an unverified ancestor.
        if (current !== this.directory) throw error;
        chain.push({ file: current, stat: null });
      }
      const parent = path.dirname(current); if (parent === current) break; current = parent;
    }
    if (!chain[0].stat && create) {
      this.fs.mkdirSync(this.directory, { mode: 0o700 });
      const stat = this.fs.lstatSync(this.directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Unsafe directory.');
      chain[0].stat = stat;
    }
    return chain;
  }
  _checkDirectories(chain) {
    for (const item of chain) {
      if (!item.stat) { try { this.fs.lstatSync(item.file); } catch (error) { if (error.code === 'ENOENT') continue; throw error; } throw new Error('Directory changed.'); }
      if (!sameDirectory(item.stat, this.fs.lstatSync(item.file))) throw new Error('Directory changed.');
    }
  }
  _read() {
    let fd;
    try {
      const directories = this._directories(); let stat;
      try { stat = this.fs.lstatSync(this.file); } catch (error) { if (error.code === 'ENOENT') return { records: [], stat: null, directories }; throw error; }
      if (!regular(stat)) throw new Error('Unsafe file.');
      fd = this.fs.openSync(this.file, this.fs.constants.O_RDONLY | (this.fs.constants.O_NOFOLLOW ?? 0));
      if (!regular(this.fs.fstatSync(fd)) || !sameFile(stat, this.fs.fstatSync(fd))) throw new Error('File changed.');
      // An exact bounded read avoids allocating for a file that grows concurrently.
      const bytes = Buffer.alloc(stat.size + 1); let offset = 0;
      while (offset < bytes.length) { const count = this.fs.readSync(fd, bytes, offset, bytes.length - offset, null); if (!count) break; offset += count; }
      if (offset !== stat.size || !sameFile(stat, this.fs.fstatSync(fd))) throw new Error('File changed.');
      const after = this.fs.lstatSync(this.file);
      if (!regular(after) || !sameFile(stat, after)) throw new Error('File changed.');
      this._checkDirectories(directories);
      const data = JSON.parse(bytes.subarray(0, offset).toString('utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length !== 2 || data.version !== 1 || !Array.isArray(data.records) || data.records.length > MAX_RECORDS) throw new Error('Invalid format.');
      const seen = new Set();
      for (const record of data.records) {
        if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).length !== 2 || !Object.hasOwn(record, 'ciphertext')) throw new Error('Invalid record.');
        profileId(record.profileId); if (seen.has(record.profileId)) throw new Error('Duplicate record.'); seen.add(record.profileId);
      }
      return { records: data.records, stat, directories };
    } catch { throw failure('PASSWORD_STORAGE_READ_FAILED'); }
    finally { if (fd !== undefined) try { this.fs.closeSync(fd); } catch {} }
  }
  _checkCurrent(snapshot) {
    this._checkDirectories(snapshot.directories);
    let stat; try { stat = this.fs.lstatSync(this.file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (snapshot.stat ? !stat || !regular(stat) || !sameFile(snapshot.stat, stat) : stat) throw new Error('File changed.');
  }
  _retryLocked(operation) {
    for (let attempt = 0; ; attempt++) {
      try { return operation(); }
      catch (error) {
        if (this.platform !== 'win32' || !WINDOWS_LOCK_CODES.has(error.code) || attempt >= RETRY_DELAYS.length) throw error;
        // Antivirus/indexing handles can briefly deny replacement on Windows.
        // Keep consent and the synchronous API, with a fixed total wait budget.
        this.retryWait(RETRY_DELAYS[attempt]);
      }
    }
  }
  _checkStage(file, owned) {
    const stat = this.fs.lstatSync(file);
    if (!regular(stat) || !sameFile(owned, stat)) throw new Error('Temporary file changed.');
  }
  _removeOwned(file, owned, directories) {
    this._retryLocked(() => {
      this._checkDirectories(directories);
      const stat = this.fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink < 1 || stat.nlink > 2 || stat.dev !== owned.dev || stat.ino !== owned.ino) throw new Error('Owned file changed.');
      this.fs.unlinkSync(file);
    });
  }
  _write(records, snapshot) {
    const bytes = Buffer.from(JSON.stringify({ version: 1, records }) + '\n');
    if (records.length > MAX_RECORDS || bytes.length > MAX_FILE_BYTES) throw failure('PASSWORD_STORAGE_FULL');
    const temp = path.join(this.directory, `.remembered-passwords-${randomUUID()}.tmp`); let fd, owned, publishedInitial = false, step = 'prepare-directory';
    try {
      if (!snapshot.directories[0].stat) snapshot.directories = this._directories(true);
      step = 'verify-before-stage';
      this._checkCurrent(snapshot);
      step = 'open-stage';
      fd = this.fs.openSync(temp, 'wx', 0o600); owned = this.fs.fstatSync(fd);
      if (!regular(owned)) throw new Error('Unsafe temporary file.');
      step = 'write-stage'; this.fs.writeFileSync(fd, bytes);
      step = 'flush-stage'; this.fs.fsyncSync(fd);
      step = 'verify-stage';
      const written = this.fs.fstatSync(fd), named = this.fs.lstatSync(temp);
      if (!regular(written) || !regular(named) || !sameFile(written, named) || owned.dev !== written.dev || owned.ino !== written.ino) throw new Error('Temporary file changed.');
      step = 'close-stage';
      this.fs.closeSync(fd); fd = undefined;
      this._checkStage(temp, written);
      step = 'verify-before-publish';
      this._checkCurrent(snapshot);
      // Exclusive initial publication does not overwrite a concurrently created file.
      if (!snapshot.stat) {
        step = 'publish-initial'; this.fs.linkSync(temp, this.file); publishedInitial = true;
        step = 'remove-initial-stage'; this._removeOwned(temp, owned, snapshot.directories); owned = null;
      } else {
        step = 'replace';
        this._retryLocked(() => { this._checkCurrent(snapshot); this._checkStage(temp, written); this.fs.renameSync(temp, this.file); });
        owned = null;
      }
    } catch (cause) {
      const error = writeFailure(cause, step);
      if (publishedInitial && owned) {
        // A failed initial cleanup must not leave a two-link vault masquerading
        // as a successful save. Only undo the link to the exact file we created.
        try { this._removeOwned(this.file, owned, snapshot.directories); error.rollback = 'completed'; }
        catch {
          error.rollback = 'blocked'; error.publishedOwnedCopyPossible = true;
          try {
            this._checkDirectories(snapshot.directories);
            const stat = this.fs.lstatSync(this.file);
            error.publishedOwnedCopyPossible = stat.isFile() && !stat.isSymbolicLink() && stat.dev === owned.dev && stat.ino === owned.ino;
          } catch (check) { if (check.code === 'ENOENT') error.publishedOwnedCopyPossible = false; }
          if (error.publishedOwnedCopyPossible) error.message = 'Cannot finish saving this remembered password. An encrypted copy may remain. Check file access and use Forget password before trying again.';
        }
      }
      throw error;
    }
    finally {
      if (fd !== undefined) try { this.fs.closeSync(fd); } catch {}
      if (owned) try { this._removeOwned(temp, owned, snapshot.directories); } catch {}
    }
  }
  get(profile) {
    this._requireAvailable(); const bound = identity(profile), record = this._read().records.find(row => row.profileId === bound.profileId);
    if (!record) return null;
    try {
      const value = record.ciphertext;
      if (typeof value !== 'string' || !value || value.length > Math.ceil(MAX_CIPHERTEXT_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('Invalid ciphertext.');
      const cipher = Buffer.from(value, 'base64');
      if (!cipher.length || cipher.length > MAX_CIPHERTEXT_BYTES || cipher.toString('base64') !== value) throw new Error('Invalid ciphertext.');
      const plaintext = this.safeStorage.decryptString(cipher);
      if (typeof plaintext !== 'string' || Buffer.byteLength(plaintext) > MAX_CIPHERTEXT_BYTES) throw new Error('Invalid payload.');
      const payload = JSON.parse(plaintext);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length !== 6 || payload.version !== 1 ||
          payload.profileId !== bound.profileId || payload.host !== bound.host || payload.port !== bound.port || payload.username !== bound.username || !validPassword(payload.password)) throw new Error('Invalid binding.');
      return payload.password;
    } catch { throw failure('PASSWORD_STORAGE_INVALID_RECORD'); }
  }
  has(profile) { return this.get(profile) !== null; }
  set(profile, password) {
    this._requireAvailable(); const bound = identity(profile);
    if (!validPassword(password)) throw failure('PASSWORD_STORAGE_INVALID_PASSWORD');
    const snapshot = this._read(); let ciphertext;
    try {
      const cipher = this.safeStorage.encryptString(JSON.stringify({ version: 1, ...bound, password }));
      if (!Buffer.isBuffer(cipher) || !cipher.length || cipher.length > MAX_CIPHERTEXT_BYTES) throw new Error('Invalid ciphertext.');
      ciphertext = cipher.toString('base64');
    } catch { throw failure('PASSWORD_STORAGE_WRITE_FAILED'); }
    const records = snapshot.records.filter(row => row.profileId !== bound.profileId).concat({ profileId: bound.profileId, ciphertext });
    this._write(records, snapshot);
  }
  delete(id) {
    id = profileId(id); const snapshot = this._read(), records = snapshot.records.filter(row => row.profileId !== id);
    if (records.length === snapshot.records.length) return false;
    this._write(records, snapshot); return true;
  }
}
module.exports = { PasswordStore, MAX_PASSWORD_BYTES, MAX_CIPHERTEXT_BYTES, MAX_RECORDS, MAX_FILE_BYTES, FILE_NAME };
