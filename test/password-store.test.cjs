'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const { PasswordStore, MAX_PASSWORD_BYTES, MAX_CIPHERTEXT_BYTES, MAX_RECORDS, MAX_FILE_BYTES, FILE_NAME } = require('../src/password-store.cjs');

// Authenticated synthetic provider: exercises the contract without claiming real DPAPI acceptance.
function encryption(key = randomBytes(32)) {
  return {
    available: true,
    isEncryptionAvailable() { return this.available; },
    encryptString(value) {
      const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
      const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), bytes]);
    },
    decryptString(value) {
      const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8');
    }
  };
}
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nerdsshell-password-test-'));
  const directory = path.join(root, 'user-data'); fs.mkdirSync(directory);
  const safeStorage = options.safeStorage ?? encryption();
  const store = new PasswordStore(directory, safeStorage, { platform: 'win32', ...options });
  const p = { id: 'synthetic-profile', host: 'demo.invalid', port: 22, username: 'demoadmin', auth: 'password' };
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, directory, file: path.join(directory, FILE_NAME), store, safeStorage, p };
}
function rewrite(f, update) { const data = JSON.parse(fs.readFileSync(f.file, 'utf8')); update(data); fs.writeFileSync(f.file, JSON.stringify(data)); }
function errorCode(code) { return error => error.code === 'PASSWORD_STORAGE_' + code; }

test('remembered password persists only encrypted bytes and survives a new store instance', t => {
  const f = fixture(t), password = 'synthetic-unique-password-秘密';
  assert.equal(f.store.get(f.p), null); assert.equal(f.store.has(f.p), false);
  f.store.set(f.p, password);
  const data = fs.readFileSync(f.file, 'utf8');
  for (const sensitive of [password, f.p.host, f.p.username]) assert.equal(data.includes(sensitive), false);
  assert.equal(fs.existsSync(f.file + '.backup'), false);
  assert.deepEqual(fs.readdirSync(f.directory), [FILE_NAME]);
  const reopened = new PasswordStore(f.directory, f.safeStorage, { platform: 'win32' });
  assert.equal(reopened.get(f.p), password); assert.equal(reopened.has(f.p), true);
});

test('encrypted payload binds exact profile identity, normalized host, port and username', t => {
  const f = fixture(t); f.store.set({ ...f.p, host: 'DEMO.INVALID' }, 'synthetic-password');
  assert.equal(f.store.get(f.p), 'synthetic-password');
  for (const changed of [{ host: 'other.invalid' }, { port: 2222 }, { username: 'other' }]) {
    assert.throws(() => f.store.get({ ...f.p, ...changed }), errorCode('INVALID_RECORD'));
  }
  assert.equal(f.store.get({ ...f.p, name: 'New display name', sessionMode: 'standard' }), 'synthetic-password');
});

test('copying ciphertext to another profile at the same endpoint fails closed', t => {
  const f = fixture(t), other = { ...f.p, id: 'other-profile' };
  f.store.set(f.p, 'synthetic-password');
  rewrite(f, data => { data.records.push({ ...data.records[0], profileId: other.id }); });
  assert.throws(() => f.store.get(other), errorCode('INVALID_RECORD'));
  assert.equal(f.store.get(f.p), 'synthetic-password');
});

test('swapping two endpoint ciphertexts fails closed and does not erase either record', t => {
  const f = fixture(t), other = { ...f.p, id: 'other-profile', host: 'other.invalid' };
  f.store.set(f.p, 'synthetic-first'); f.store.set(other, 'synthetic-second');
  rewrite(f, data => { [data.records[0].ciphertext, data.records[1].ciphertext] = [data.records[1].ciphertext, data.records[0].ciphertext]; });
  const before = fs.readFileSync(f.file);
  assert.throws(() => f.store.get(f.p), errorCode('INVALID_RECORD')); assert.throws(() => f.store.get(other), errorCode('INVALID_RECORD'));
  assert.deepEqual(fs.readFileSync(f.file), before);
});

test('ciphertext corruption and a different account encryption key fail without changing storage', t => {
  const f = fixture(t); f.store.set(f.p, 'synthetic-password');
  const otherAccount = new PasswordStore(f.directory, encryption(), { platform: 'win32' });
  const before = fs.readFileSync(f.file); assert.throws(() => otherAccount.get(f.p), errorCode('INVALID_RECORD'));
  assert.deepEqual(fs.readFileSync(f.file), before);
  rewrite(f, data => { const bytes = Buffer.from(data.records[0].ciphertext, 'base64'); bytes[bytes.length - 1] ^= 1; data.records[0].ciphertext = bytes.toString('base64'); });
  assert.throws(() => f.store.get(f.p), errorCode('INVALID_RECORD'));
});

test('unsupported platforms reject remembering even when a provider claims encryption is available', t => {
  for (const platform of ['linux', 'darwin', 'freebsd']) {
    const f = fixture(t, { platform });
    // Linux basic_text must never become an implicit plaintext fallback.
    f.safeStorage.getSelectedStorageBackend = () => 'basic_text';
    assert.equal(f.store.isAvailable(), false);
    assert.throws(() => f.store.set(f.p, 'synthetic-password'), errorCode('UNAVAILABLE'));
    assert.throws(() => f.store.get(f.p), errorCode('UNAVAILABLE'));
    assert.equal(fs.existsSync(f.file), false);
  }
});

test('unavailable or throwing account encryption reports a generic error and preserves existing data', t => {
  const f = fixture(t); f.store.set(f.p, 'synthetic-password'); const before = fs.readFileSync(f.file);
  f.safeStorage.available = false;
  assert.equal(f.store.isAvailable(), false); assert.throws(() => f.store.set(f.p, 'replacement'), errorCode('UNAVAILABLE'));
  f.safeStorage.isEncryptionAvailable = () => { throw new Error('synthetic-sensitive-provider-message'); };
  assert.equal(f.store.isAvailable(), false); assert.throws(() => f.store.get(f.p), errorCode('UNAVAILABLE'));
  assert.deepEqual(fs.readFileSync(f.file), before);
});

test('encryption exceptions and invalid ciphertext output cannot persist plaintext or replace old data', t => {
  const f = fixture(t); f.store.set(f.p, 'synthetic-first'); const before = fs.readFileSync(f.file);
  for (const result of [null, 'synthetic-replacement', Buffer.alloc(0), Buffer.alloc(MAX_CIPHERTEXT_BYTES + 1)]) {
    f.safeStorage.encryptString = () => result;
    assert.throws(() => f.store.set(f.p, 'synthetic-replacement'), errorCode('WRITE_FAILED'));
    assert.deepEqual(fs.readFileSync(f.file), before);
  }
  f.safeStorage.encryptString = () => { throw new Error('synthetic-replacement'); };
  assert.throws(() => f.store.set(f.p, 'synthetic-replacement'), error => errorCode('WRITE_FAILED')(error) && !error.message.includes('synthetic-replacement'));
  assert.deepEqual(fs.readFileSync(f.file), before);
});

test('decryption exceptions do not expose provider messages or the password', t => {
  const f = fixture(t); f.store.set(f.p, 'synthetic-password');
  f.safeStorage.decryptString = () => { throw new Error('synthetic-password'); };
  assert.throws(() => f.store.get(f.p), error => errorCode('INVALID_RECORD')(error) && !error.message.includes('synthetic-password'));
});

test('decrypted payloads require every identity field and reject extra fields or wrong versions', t => {
  const f = fixture(t); f.store.set(f.p, 'synthetic-password');
  const valid = { version: 1, profileId: f.p.id, host: f.p.host, port: f.p.port, username: f.p.username, password: 'synthetic-password' };
  for (const change of [p => { delete p.profileId; }, p => { p.version = 2; }, p => { p.extra = true; }, p => { p.password = ''; }, p => { p.port = '22'; }]) {
    const payload = { ...valid }; change(payload); f.safeStorage.decryptString = () => JSON.stringify(payload);
    assert.throws(() => f.store.get(f.p), errorCode('INVALID_RECORD'));
  }
  for (const result of [null, '{invalid', 'x'.repeat(MAX_CIPHERTEXT_BYTES + 1)]) {
    f.safeStorage.decryptString = () => result; assert.throws(() => f.store.get(f.p), errorCode('INVALID_RECORD'));
  }
});

test('Forget removes only the selected malformed entry and preserves unrelated encrypted passwords', t => {
  const f = fixture(t), other = { ...f.p, id: 'other-profile' };
  f.store.set(f.p, 'synthetic-first'); f.store.set(other, 'synthetic-second');
  rewrite(f, data => { data.records.find(row => row.profileId === f.p.id).ciphertext = 'bad base64'; });
  assert.throws(() => f.store.get(f.p), errorCode('INVALID_RECORD'));
  assert.equal(f.store.delete(f.p.id), true); assert.equal(f.store.get(f.p), null); assert.equal(f.store.get(other), 'synthetic-second');
  const before = fs.readFileSync(f.file); assert.equal(f.store.delete('missing'), false); assert.deepEqual(fs.readFileSync(f.file), before);
});

test('Forget remains possible when Windows encryption becomes unavailable', t => {
  const f = fixture(t); f.store.set(f.p, 'synthetic-password'); f.safeStorage.available = false;
  assert.equal(f.store.delete(f.p.id), true); assert.deepEqual(JSON.parse(fs.readFileSync(f.file, 'utf8')), { version: 1, records: [] });
});

test('saving or forgetting another password preserves a malformed unrelated record', t => {
  const f = fixture(t), other = { ...f.p, id: 'other-profile' };
  f.store.set(f.p, 'synthetic-first');
  rewrite(f, data => { data.records[0].ciphertext = 'malformed-unrelated-entry'; });
  f.store.set(other, 'synthetic-other'); assert.equal(f.store.get(other), 'synthetic-other');
  assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).records.find(row => row.profileId === f.p.id).ciphertext, 'malformed-unrelated-entry');
  assert.equal(f.store.delete(other.id), true); assert.throws(() => f.store.get(f.p), errorCode('INVALID_RECORD'));
  assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).records[0].ciphertext, 'malformed-unrelated-entry');
});

test('replacing one password preserves other encrypted entries and never adds a plaintext backup', t => {
  const f = fixture(t), other = { ...f.p, id: 'other-profile' };
  f.store.set(f.p, 'synthetic-first'); f.store.set(other, 'synthetic-other');
  const previous = JSON.parse(fs.readFileSync(f.file, 'utf8')).records.find(row => row.profileId === other.id).ciphertext;
  f.store.set(f.p, 'synthetic-new');
  assert.equal(f.store.get(f.p), 'synthetic-new'); assert.equal(f.store.get(other), 'synthetic-other');
  assert.equal(JSON.parse(fs.readFileSync(f.file, 'utf8')).records.find(row => row.profileId === other.id).ciphertext, previous);
  assert.deepEqual(fs.readdirSync(f.directory), [FILE_NAME]);
});

test('rename failures preserve previous bytes, remove owned staging and do not leak sensitive diagnostics', t => {
  const injected = Object.create(fs), f = fixture(t, { fs: injected }); f.store.set(f.p, 'synthetic-first'); const before = fs.readFileSync(f.file);
  injected.renameSync = () => { throw new Error('synthetic-sensitive-file-path'); };
  assert.throws(() => f.store.set(f.p, 'synthetic-new'), error => errorCode('WRITE_FAILED')(error) && !error.message.includes('synthetic-sensitive'));
  assert.deepEqual(fs.readFileSync(f.file), before); assert.equal(f.store.get(f.p), 'synthetic-first');
  assert.deepEqual(fs.readdirSync(f.directory), [FILE_NAME]);
  assert.throws(() => f.store.delete(f.p.id), errorCode('WRITE_FAILED')); assert.deepEqual(fs.readFileSync(f.file), before);
});

test('write and flush failures preserve previous bytes and remove staging', t => {
  for (const method of ['writeFileSync', 'fsyncSync']) {
    const injected = Object.create(fs), f = fixture(t, { fs: injected }); f.store.set(f.p, 'synthetic-first'); const before = fs.readFileSync(f.file);
    injected[method] = () => { throw new Error('synthetic-disk-error'); };
    assert.throws(() => f.store.set(f.p, 'synthetic-new'), errorCode('WRITE_FAILED'));
    assert.deepEqual(fs.readFileSync(f.file), before); assert.deepEqual(fs.readdirSync(f.directory), [FILE_NAME]);
  }
});

test('a file created during initial publication is preserved instead of overwritten', t => {
  const injected = Object.create(fs), f = fixture(t, { fs: injected });
  injected.linkSync = (source, destination) => { fs.writeFileSync(destination, 'concurrent-synthetic-file'); return fs.linkSync(source, destination); };
  assert.throws(() => f.store.set(f.p, 'synthetic-password'), errorCode('WRITE_FAILED'));
  assert.equal(fs.readFileSync(f.file, 'utf8'), 'concurrent-synthetic-file'); assert.deepEqual(fs.readdirSync(f.directory), [FILE_NAME]);
});

test('a concurrent rewrite while encrypting is detected and preserved', t => {
  const f = fixture(t); f.store.set(f.p, 'synthetic-first');
  const original = f.safeStorage.encryptString;
  f.safeStorage.encryptString = value => { fs.writeFileSync(f.file, 'concurrent-synthetic-file'); return original.call(f.safeStorage, value); };
  assert.throws(() => f.store.set(f.p, 'synthetic-new'), errorCode('WRITE_FAILED'));
  assert.equal(fs.readFileSync(f.file, 'utf8'), 'concurrent-synthetic-file'); assert.deepEqual(fs.readdirSync(f.directory), [FILE_NAME]);
});

test('Windows transient rename locks retry within a fixed budget without changing metadata guards', t => {
  const injected = Object.create(fs), waits = [], f = fixture(t, { fs: injected, retryWait: delay => waits.push(delay) });
  f.store.set(f.p, 'synthetic-first'); let calls = 0;
  injected.renameSync = (source, destination) => {
    if (++calls <= 2) throw Object.assign(new Error('synthetic-sensitive-message'), { code: calls === 1 ? 'EPERM' : 'EACCES' });
    fs.renameSync(source, destination);
  };
  f.store.set(f.p, 'synthetic-new');
  assert.equal(calls, 3); assert.deepEqual(waits, [20, 40]); assert.equal(f.store.get(f.p), 'synthetic-new');
  assert.deepEqual(fs.readdirSync(f.directory), [FILE_NAME]);
});

test('permanent Windows rename locks are bounded and preserve previous bytes with safe diagnostics', t => {
  const injected = Object.create(fs), waits = [], f = fixture(t, { fs: injected, retryWait: delay => waits.push(delay) });
  f.store.set(f.p, 'synthetic-first'); const before = fs.readFileSync(f.file); let calls = 0;
  injected.renameSync = () => { calls++; throw Object.assign(new Error('synthetic-sensitive-message'), { code: 'EPERM' }); };
  assert.throws(() => f.store.set(f.p, 'synthetic-new'), error => errorCode('WRITE_FAILED')(error) && error.storageStep === 'replace' && error.nativeCode === 'EPERM' && !error.message.includes('synthetic-sensitive'));
  assert.equal(calls, 5); assert.deepEqual(waits, [20, 40, 80, 80]); assert.deepEqual(fs.readFileSync(f.file), before);
  assert.deepEqual(fs.readdirSync(f.directory), [FILE_NAME]);
});

test('a replacement during a rename retry is detected rather than overwritten', t => {
  const injected = Object.create(fs), f = fixture(t, { fs: injected, retryWait: () => fs.writeFileSync(f.file, 'concurrent-synthetic-file') });
  f.store.set(f.p, 'synthetic-first'); let calls = 0;
  injected.renameSync = () => { calls++; throw Object.assign(new Error('locked'), { code: 'EBUSY' }); };
  assert.throws(() => f.store.set(f.p, 'synthetic-new'), errorCode('WRITE_FAILED'));
  assert.equal(calls, 1); assert.equal(fs.readFileSync(f.file, 'utf8'), 'concurrent-synthetic-file'); assert.deepEqual(fs.readdirSync(f.directory), [FILE_NAME]);
});

test('transient initial-stage cleanup locks leave a successfully published single-link vault', t => {
  const injected = Object.create(fs), waits = [], f = fixture(t, { fs: injected, retryWait: delay => waits.push(delay) }); let calls = 0;
  injected.unlinkSync = filename => {
    if (filename.endsWith('.tmp') && ++calls === 1) throw Object.assign(new Error('locked'), { code: 'EPERM' });
    fs.unlinkSync(filename);
  };
  f.store.set(f.p, 'synthetic-password'); assert.equal(f.store.get(f.p), 'synthetic-password');
  assert.equal(fs.statSync(f.file).nlink, 1); assert.deepEqual(fs.readdirSync(f.directory), [FILE_NAME]); assert.deepEqual(waits, [20]);
});

test('exhausted initial-stage cleanup rolls back the owned published link and keeps the password unsaved', t => {
  const injected = Object.create(fs), waits = [], f = fixture(t, { fs: injected, retryWait: delay => waits.push(delay) }); let stageCalls = 0;
  injected.unlinkSync = filename => {
    if (filename.endsWith('.tmp') && ++stageCalls <= 5) throw Object.assign(new Error('locked'), { code: 'EPERM' });
    fs.unlinkSync(filename);
  };
  assert.throws(() => f.store.set(f.p, 'synthetic-password'), error => errorCode('WRITE_FAILED')(error) && error.storageStep === 'remove-initial-stage' && error.nativeCode === 'EPERM' && error.rollback === 'completed');
  assert.deepEqual(waits, [20, 40, 80, 80]); assert.equal(f.store.get(f.p), null); assert.deepEqual(fs.readdirSync(f.directory), []);
});

test('initial-publication rollback cannot delete an unrelated file replacing the owned link', t => {
  const injected = Object.create(fs), f = fixture(t, { fs: injected, retryWait: () => {} }); let changed = false;
  injected.unlinkSync = filename => {
    if (filename.endsWith('.tmp') && !changed) {
      changed = true; fs.unlinkSync(f.file); fs.writeFileSync(f.file, 'unrelated-synthetic-file');
      throw Object.assign(new Error('permanent synthetic failure'), { code: 'EIO' });
    }
    fs.unlinkSync(filename);
  };
  assert.throws(() => f.store.set(f.p, 'synthetic-password'), error => errorCode('WRITE_FAILED')(error) && error.rollback === 'blocked' && error.publishedOwnedCopyPossible === false);
  assert.equal(fs.readFileSync(f.file, 'utf8'), 'unrelated-synthetic-file'); assert.deepEqual(fs.readdirSync(f.directory), [FILE_NAME]);
});

test('blocked initial rollback explicitly reports a possible encrypted copy without claiming preservation', t => {
  const injected = Object.create(fs), f = fixture(t, { fs: injected, retryWait: () => {} });
  injected.unlinkSync = () => { throw Object.assign(new Error('synthetic-sensitive-path'), { code: 'EPERM' }); };
  assert.throws(() => f.store.set(f.p, 'synthetic-password'), error => errorCode('WRITE_FAILED')(error) && error.rollback === 'blocked' && error.publishedOwnedCopyPossible === true && /encrypted copy may remain/.test(error.message) && !/preserved|synthetic-sensitive/.test(error.message));
  assert.equal(fs.statSync(f.file).nlink, 2); assert.throws(() => f.store.get(f.p), errorCode('READ_FAILED'));
  // Once the operating-system denial clears, the retry can remove the exact owned
  // staging link; only ciphertext existed on disk throughout the denied interval.
  const stage = fs.readdirSync(f.directory).find(file => file.endsWith('.tmp')); fs.unlinkSync(path.join(f.directory, stage));
  assert.equal(f.store.delete(f.p.id), true); assert.equal(f.store.get(f.p), null);
});

test('malformed file structure is preserved and cannot be silently overwritten or erased', t => {
  const f = fixture(t);
  const malformed = ['{', 'null', '[]', JSON.stringify({ version: 2, records: [] }), JSON.stringify({ version: 1, records: {}, }),
    JSON.stringify({ version: 1, records: [], unexpected: true }), JSON.stringify({ version: 1, records: [{ profileId: 'bad/id', ciphertext: 'AAAA' }] }),
    JSON.stringify({ version: 1, records: [{ profileId: f.p.id, ciphertext: 'AAAA' }, { profileId: f.p.id, ciphertext: 'AAAA' }] })];
  for (const data of malformed) {
    fs.writeFileSync(f.file, data);
    assert.throws(() => f.store.get(f.p), errorCode('READ_FAILED')); assert.throws(() => f.store.set(f.p, 'synthetic-password'), errorCode('READ_FAILED'));
    assert.throws(() => f.store.delete(f.p.id), errorCode('READ_FAILED')); assert.equal(fs.readFileSync(f.file, 'utf8'), data);
  }
});

test('selected invalid or excessive ciphertext remains forgettable without decrypting unrelated entries', t => {
  const f = fixture(t);
  for (const ciphertext of ['', 'AAAA=', '?', false, {}, 'A'.repeat(MAX_CIPHERTEXT_BYTES * 2)]) {
    fs.writeFileSync(f.file, JSON.stringify({ version: 1, records: [{ profileId: f.p.id, ciphertext }] }));
    assert.throws(() => f.store.get(f.p), errorCode('INVALID_RECORD')); assert.equal(f.store.delete(f.p.id), true);
  }
});

test('password and identity inputs are bounded and never create a saved file when invalid', t => {
  const f = fixture(t);
  for (const password of ['', null, {}, 'contains\0null', 'x'.repeat(MAX_PASSWORD_BYTES + 1), '界'.repeat(Math.ceil(MAX_PASSWORD_BYTES / 3))]) {
    assert.throws(() => f.store.set(f.p, password), errorCode('INVALID_PASSWORD')); assert.equal(fs.existsSync(f.file), false);
  }
  for (const p of [null, {}, { ...f.p, auth: 'key' }, { ...f.p, auth: 'agent' }, { ...f.p, id: '../outside' }, { ...f.p, host: 'demo;command' }, { ...f.p, host: 'demo.invalid\n' }, { ...f.p, username: 'bad\nuser' }, { ...f.p, username: 'demoadmin\n' }, { ...f.p, port: 0 }, { ...f.p, port: '22' }]) {
    assert.throws(() => f.store.set(p, 'synthetic-password'), errorCode('INVALID_PROFILE')); assert.equal(fs.existsSync(f.file), false);
  }
  f.store.set(f.p, 'x'.repeat(MAX_PASSWORD_BYTES)); assert.equal(f.store.get(f.p).length, MAX_PASSWORD_BYTES);
});

test('missing safeStorage APIs disable remembering instead of breaking constructor or Forget', t => {
  const f = fixture(t);
  for (const provider of [undefined, null, {}, { isEncryptionAvailable: () => true }]) {
    const store = new PasswordStore(f.directory, provider, { platform: 'win32' });
    assert.equal(store.isAvailable(), false); assert.throws(() => store.set(f.p, 'synthetic-password'), errorCode('UNAVAILABLE')); assert.equal(store.delete(f.p.id), false);
  }
});

test('record count and file size bounds reject excessive storage without altering saved data', t => {
  const f = fixture(t);
  fs.writeFileSync(f.file, JSON.stringify({ version: 1, records: Array.from({ length: MAX_RECORDS }, (_, i) => ({ profileId: `profile-${i}`, ciphertext: 'AAAA' })) }));
  const before = fs.readFileSync(f.file); assert.throws(() => f.store.set(f.p, 'synthetic-password'), errorCode('FULL')); assert.deepEqual(fs.readFileSync(f.file), before);
  fs.writeFileSync(f.file, JSON.stringify({ version: 1, records: Array.from({ length: MAX_RECORDS + 1 }, (_, i) => ({ profileId: `profile-${i}`, ciphertext: 'AAAA' })) }));
  assert.throws(() => f.store.get(f.p), errorCode('READ_FAILED'));
  fs.truncateSync(f.file, MAX_FILE_BYTES + 1); assert.throws(() => f.store.get(f.p), errorCode('READ_FAILED'));
});

test('a growing file is rejected using a bounded read allocation', t => {
  const injected = Object.create(fs), f = fixture(t, { fs: injected }); f.store.set(f.p, 'synthetic-password');
  const size = fs.statSync(f.file).size; let changed = false;
  injected.readSync = (fd, buffer, offset, length, position) => {
    assert.ok(buffer.length <= size + 1);
    if (!changed) { changed = true; fs.appendFileSync(f.file, Buffer.alloc(MAX_FILE_BYTES)); }
    return fs.readSync(fd, buffer, offset, length, position);
  };
  assert.throws(() => f.store.get(f.p), errorCode('READ_FAILED'));
});

test('directory and hardlinked credential files are rejected for read, replacement and deletion', t => {
  const f = fixture(t), other = path.join(f.root, 'unrelated');
  fs.mkdirSync(f.file); assert.throws(() => f.store.get(f.p), errorCode('READ_FAILED')); assert.throws(() => f.store.set(f.p, 'synthetic-password'), errorCode('READ_FAILED')); fs.rmdirSync(f.file);
  fs.writeFileSync(other, 'unrelated-synthetic-data'); fs.linkSync(other, f.file);
  assert.throws(() => f.store.get(f.p), errorCode('READ_FAILED')); assert.throws(() => f.store.delete(f.p.id), errorCode('READ_FAILED'));
  assert.equal(fs.readFileSync(other, 'utf8'), 'unrelated-synthetic-data');
});

test('symlinked credential files cannot read, overwrite or remove an external target', t => {
  const f = fixture(t), other = path.join(f.root, 'unrelated'); fs.writeFileSync(other, 'unrelated-synthetic-data');
  try { fs.symlinkSync(other, f.file, 'file'); } catch (error) { if (error.code === 'EPERM' || error.code === 'EACCES') { t.skip('Creating a file symlink requires Windows permission.'); return; } throw error; }
  assert.throws(() => f.store.get(f.p), errorCode('READ_FAILED')); assert.throws(() => f.store.set(f.p, 'synthetic-password'), errorCode('READ_FAILED')); assert.throws(() => f.store.delete(f.p.id), errorCode('READ_FAILED'));
  assert.equal(fs.readFileSync(other, 'utf8'), 'unrelated-synthetic-data');
});

test('a reparse/junction directory or ancestor cannot redirect encrypted storage', t => {
  const f = fixture(t), outside = path.join(f.root, 'outside'), link = path.join(f.root, 'junction'); fs.mkdirSync(outside);
  fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  for (const directory of [link, path.join(link, 'child')]) {
    if (directory !== link) fs.mkdirSync(path.join(outside, 'child'));
    const store = new PasswordStore(directory, f.safeStorage, { platform: 'win32' });
    assert.throws(() => store.set(f.p, 'synthetic-password'), errorCode('READ_FAILED'));
  }
  assert.equal(fs.existsSync(path.join(outside, FILE_NAME)), false); assert.equal(fs.existsSync(path.join(outside, 'child', FILE_NAME)), false);
});

test('a new selected userData leaf is created under its verified existing parent', t => {
  const f = fixture(t), directory = path.join(f.root, 'new-user-data');
  const store = new PasswordStore(directory, f.safeStorage, { platform: 'win32' });
  assert.equal(store.get(f.p), null); store.set(f.p, 'synthetic-password'); assert.equal(store.get(f.p), 'synthetic-password');
});
