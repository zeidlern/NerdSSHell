'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { StandardRemote } = require('../src/standard-remote.cjs');
const { listDirectory, download } = require('../src/sftp-browser.cjs');
const { upload } = require('../src/transfer.cjs');

test('real OpenSSH: standard PTY and its SFTP sidecar browse, download, upload without tmux', { skip: !process.env.BETTERSSH_TEST_KEY, timeout: 60000 }, async t => {
  const host = process.env.BETTERSSH_TEST_HOST || '127.0.0.1';
  if (host !== '127.0.0.1') throw new Error('This test only supports the disposable loopback fixture.');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'betterssh-sftp-ci-'));
  const local = fs.mkdtempSync(path.join(os.tmpdir(), 'betterssh-download-ci-'));
  const source = path.join(directory, "file 'quotes'.txt"); fs.writeFileSync(source, 'SFTP round trip 😀\n');
  fs.mkdirSync(path.join(directory, 'folder')); fs.symlinkSync(source, path.join(directory, 'link'));
  const port = Number(process.env.BETTERSSH_TEST_PORT || 22222);
  const pub = fs.readFileSync(process.env.BETTERSSH_TEST_HOST_KEY + '.pub', 'utf8').trim().split(/\s+/);
  const remote = new StandardRemote({ id: 'standard-ci', name: 'Disposable standard SSH', host, port,
    username: process.env.BETTERSSH_TEST_USER || os.userInfo().username, auth: 'key', keyPath: process.env.BETTERSSH_TEST_KEY },
    { knownHosts: `[${host}]:${port} ${pub[0]} ${pub[1]}\n`, ask: async () => { throw new Error('Test must not prompt or install software.'); } });
  t.after(() => { remote.disconnect(); fs.rmSync(directory, { recursive: true, force: true }); fs.rmSync(local, { recursive: true, force: true }); });
  remote.exec = () => { throw new Error('Standard mode must not execute tmux or other helper commands.'); };
  await remote.connect(); const pane = await remote.create('Plain shell'); await remote.open(pane.key); await remote.resize(pane.key, 110, 35);
  const listing = await listDirectory(remote, directory);
  assert.ok(listing.entries.some(e => e.name === 'folder' && e.kind === 'directory'));
  assert.ok(listing.entries.some(e => e.name === 'link' && e.kind === 'link'));
  const target = path.join(local, 'download.txt'); await download(remote, source, target);
  assert.equal(fs.readFileSync(target, 'utf8'), fs.readFileSync(source, 'utf8'));
  await assert.rejects(download(remote, source, target), /No file was overwritten/);
  await assert.rejects(download(remote, path.join(directory, 'link'), path.join(local, 'bad')), /regular files only/);
  const up = path.join(local, 'upload.txt'); fs.writeFileSync(up, 'upload to the browsed directory');
  await upload(remote, [up], { directory, confirmOverwrite: async () => false });
  assert.equal(fs.readFileSync(path.join(directory, 'upload.txt'), 'utf8'), 'upload to the browsed directory');
  assert.equal(remote.activeShellCount(), 1, 'file operations must not close the terminal');
  remote.closeView(pane.key); assert.equal(remote.activeShellCount(), 0); await assert.rejects(remote.open(pane.key), /ended/);
});
