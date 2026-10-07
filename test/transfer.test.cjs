'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Writable } = require('node:stream');
const { upload } = require('../src/transfer.cjs');

function missing() { const error = new Error('No such file'); error.code = 2; return error; }
function fixture(t, sftp) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nerdsshell-transfer-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const local = path.join(dir, 'test.txt'); fs.writeFileSync(local, 'synthetic transfer data\n');
  const remote = { profile: { uploadDirectory: '/upload' }, sftp: async () => sftp };
  return { local, remote };
}
function fakeSftp(overrides = {}) {
  return {
    ended: 0, writes: 0, linked: 0, renamed: 0, removed: 0,
    end() { this.ended++; },
    realpath(_path, callback) { callback(null, '/home/test'); },
    lstat(file, callback) {
      if (file === '/upload') callback(null, { isDirectory: () => true, isSymbolicLink: () => false });
      else callback(missing());
    },
    createWriteStream() { this.writes++; return new Writable({ write(_chunk, _encoding, callback) { callback(); } }); },
    ext_openssh_hardlink(_temp, _target, callback) { this.linked++; callback(null); },
    ext_openssh_rename(_temp, _target, callback) { this.renamed++; callback(null); },
    unlink(_file, callback) { this.removed++; callback(null); },
    ...overrides,
  };
}

test('opening SFTP times out before any stream and closes a late channel', async t => {
  let deliver; const sftp = fakeSftp();
  const { local, remote } = fixture(t, sftp);
  remote.sftp = () => new Promise(resolve => { deliver = resolve; });
  await assert.rejects(upload(remote, [local], { timeoutMs: 15 }), /SFTP channel timed out/);
  deliver(sftp);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sftp.ended, 1);
  assert.equal(sftp.writes, 0);
});

test('a hung SFTP metadata call times out and closes the channel', async t => {
  const sftp = fakeSftp({ realpath() {} });
  const { local, remote } = fixture(t, sftp);
  await assert.rejects(upload(remote, [local], { timeoutMs: 15 }), /realpath timed out/);
  assert.ok(sftp.ended >= 1);
  assert.equal(sftp.writes, 0);
});

test('cancellation while inspecting a target prevents streaming', async t => {
  const controller = new AbortController();
  const sftp = fakeSftp({ lstat(file, callback) {
    if (file === '/upload') callback(null, { isDirectory: () => true });
  } });
  const { local, remote } = fixture(t, sftp);
  const pending = upload(remote, [local], { signal: controller.signal, timeoutMs: 1000 });
  setImmediate(() => controller.abort(new Error('Synthetic cancellation')));
  await assert.rejects(pending, /Synthetic cancellation/);
  assert.equal(sftp.writes, 0);
  assert.ok(sftp.ended >= 1);
});

test('symlinked upload directory is rejected before writing', async t => {
  const sftp = fakeSftp({ lstat(_file, callback) {
    callback(null, { isDirectory: () => false, isSymbolicLink: () => true });
  } });
  const { local, remote } = fixture(t, sftp);
  await assert.rejects(upload(remote, [local]), /symbolic link/);
  assert.equal(sftp.writes, 0);
});

test('new upload uses exclusive hardlink publishing, not an overwrite-capable rename', async t => {
  const sftp = fakeSftp(); const { local, remote } = fixture(t, sftp);
  const result = await upload(remote, [local]);
  assert.deepEqual(result, ['/upload/test.txt']);
  assert.equal(sftp.linked, 1); assert.equal(sftp.renamed, 0);
  assert.equal(sftp.removed, 1);
});

test('concurrent creation of a target cannot be overwritten', async t => {
  const sftp = fakeSftp({ ext_openssh_hardlink(_temp, _target, callback) {
    const error = new Error('Target exists'); error.code = 11; callback(error);
  } });
  const { local, remote } = fixture(t, sftp);
  await assert.rejects(upload(remote, [local]), /Target exists/);
  assert.equal(sftp.renamed, 0);
  assert.equal(sftp.removed, 1, 'only the temporary upload is removed');
});

test('unsupported exclusive publishing fails without falling back to rename', async t => {
  const sftp = fakeSftp({ ext_openssh_hardlink(_temp, _target, callback) {
    const error = new Error('Unsupported'); error.code = 8; callback(error);
  } });
  const { local, remote } = fixture(t, sftp);
  await assert.rejects(upload(remote, [local]), /lacks exclusive file publishing/);
  assert.equal(sftp.renamed, 0);
});

test('stalled SFTP streaming is cancelled by the idle timeout', async t => {
  const sftp = fakeSftp({ createWriteStream() {
    this.writes++;
    return new Writable({ write() {} });
  } });
  const { local, remote } = fixture(t, sftp);
  await assert.rejects(upload(remote, [local], { idleTimeoutMs: 15, timeoutMs: 15 }), /stalled|abort/i);
  assert.ok(sftp.ended >= 1);
  assert.equal(sftp.linked, 0);
});
