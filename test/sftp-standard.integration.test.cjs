'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { StandardRemote } = require('../src/standard-remote.cjs');
const { listDirectory, download } = require('../src/sftp-browser.cjs');
const { upload } = require('../src/transfer.cjs');

test('real OpenSSH: standard PTY and its SFTP sidecar browse, download, upload without tmux', { skip: !process.env.NERDSSHELL_TEST_KEY, timeout: 60000 }, async t => {
  const host = process.env.NERDSSHELL_TEST_HOST || '127.0.0.1';
  if (host !== '127.0.0.1') throw new Error('This test only supports the disposable loopback fixture.');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nerdsshell-sftp-ci-'));
  const local = fs.mkdtempSync(path.join(os.tmpdir(), 'nerdsshell-download-ci-'));
  const source = path.join(directory, "file 'quotes'.txt"); fs.writeFileSync(source, 'SFTP round trip 😀\n');
  fs.mkdirSync(path.join(directory, 'folder')); fs.symlinkSync(source, path.join(directory, 'link'));
  const port = Number(process.env.NERDSSHELL_TEST_PORT || 22222);
  const pub = fs.readFileSync(process.env.NERDSSHELL_TEST_HOST_KEY + '.pub', 'utf8').trim().split(/\s+/);
  const remote = new StandardRemote({ id: 'standard-ci', name: 'Disposable standard SSH', host, port,
    username: process.env.NERDSSHELL_TEST_USER || os.userInfo().username, auth: 'key', keyPath: process.env.NERDSSHELL_TEST_KEY },
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

test('real OpenSSH: terminal baud modes are observable per PTY and tmux owns separate speeds', { skip: !process.env.NERDSSHELL_TEST_KEY, timeout: 30000 }, async t => {
  const { Client } = require('ssh2');
  const host = process.env.NERDSSHELL_TEST_HOST || '127.0.0.1';
  if (host !== '127.0.0.1') throw new Error('This test only supports the disposable loopback fixture.');
  const client = new Client(), port = Number(process.env.NERDSSHELL_TEST_PORT || 22222);
  const publicKey = fs.readFileSync(process.env.NERDSSHELL_TEST_HOST_KEY + '.pub', 'utf8').trim().split(/\s+/)[1];
  const expected = Buffer.from(publicKey, 'base64');
  const socket = 'nerdsshell-baud-' + process.pid;
  const exec = (command, pty) => new Promise((resolve, reject) => {
    client.exec(command, pty ? { pty } : {}, (error, channel) => {
      if (error) return reject(error);
      const out = [], err = [];
      channel.on('data', bytes => out.push(bytes)); channel.stderr.on('data', bytes => err.push(bytes));
      channel.on('error', reject); channel.on('close', code => code === 0 ? resolve(Buffer.concat(out).toString().trim()) : reject(new Error(Buffer.concat(err).toString() || 'Fixture command failed.')));
    });
  });
  t.after(async () => { try { await exec(`tmux -L ${socket} kill-server`); } catch {} client.end(); });
  await new Promise((resolve, reject) => {
    client.once('ready', resolve); client.once('error', reject);
    client.connect({ host, port, username: process.env.NERDSSHELL_TEST_USER || os.userInfo().username,
      privateKey: fs.readFileSync(process.env.NERDSSHELL_TEST_KEY), hostVerifier: key => expected.equals(key) });
  });
  const pty = rate => ({ term: 'xterm-256color', rows: 36, cols: 120, modes: { TTY_OP_ISPEED: rate, TTY_OP_OSPEED: rate } });
  assert.equal(await exec('stty speed', pty(9600)), '9600');
  assert.equal(await exec('stty speed', pty(115200)), '115200');
  const normal = await exec('stty speed', { term: 'xterm-256color', rows: 36, cols: 120 });
  assert.equal(normal, '38400', 'Omitted modes retain the disposable OpenSSH Linux default.');
  await exec(`tmux -L ${socket} new-session -d -s baud 'sleep 30'`);
  const paneTty = await exec(`tmux -L ${socket} display-message -p -t baud '#{pane_tty}'`);
  assert.match(paneTty, /^\/dev\/pts\/\d+$/);
  assert.equal(await exec(`stty -F ${paneTty} speed`, pty(9600)), normal, 'The SSH PTY speed does not change the independent tmux pane.');
  const shared = await Promise.all([exec('stty speed; sleep 0.1; stty speed', pty(9600)), exec('stty speed; sleep 0.1; stty speed', pty(115200))]);
  assert.deepEqual(shared.map(value => value.split(/\s+/)), [['9600', '9600'], ['115200', '115200']], 'One transport supports independent concurrent PTYs.');
});

test('real OpenSSH: NerdSSHell saved profile, new-window override and task baud values become Linux PTY speeds', { skip: !process.env.NERDSSHELL_TEST_KEY, timeout: 30000 }, async t => {
  const host = process.env.NERDSSHELL_TEST_HOST || '127.0.0.1';
  if (host !== '127.0.0.1') throw new Error('This test only supports the disposable loopback fixture.');
  const port = Number(process.env.NERDSSHELL_TEST_PORT || 22222);
  const pub = fs.readFileSync(process.env.NERDSSHELL_TEST_HOST_KEY + '.pub', 'utf8').trim().split(/\s+/);
  const remote = new StandardRemote({ id: 'baud-application-ci', name: 'Disposable terminal baud', host, port,
    username: process.env.NERDSSHELL_TEST_USER || os.userInfo().username, auth: 'key', keyPath: process.env.NERDSSHELL_TEST_KEY, terminalBaud: 9600 },
    { knownHosts: `[${host}]:${port} ${pub[0]} ${pub[1]}\n`, ask: async () => { throw new Error('Test must not prompt or install software.'); } });
  t.after(() => remote.disconnect()); await remote.connect();
  const output = new Map(); remote.on('output', (key, bytes) => output.set(key, (output.get(key) || '') + bytes.toString()));
  const readSpeed = async pane => {
    await remote.open(pane.key);
    const until = Date.now() + 10000;
    while (Date.now() < until) {
      const match = /(?:^|[\r\n])(\d+)(?:[\r\n]|$)/.exec(output.get(pane.key) || '');
      if (match) return Number(match[1]);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Owned disposable PTY did not publish its terminal speed.');
  };
  const first = await remote.create('Saved profile', 'stty speed; sleep 1');
  const second = await remote.create('New window override', 'stty speed; sleep 1', 115200);
  assert.deepEqual(await Promise.all([readSpeed(first), readSpeed(second)]), [9600, 115200]);
  const normal = await remote.create('Server default', 'stty speed; sleep 1', 0); assert.equal(await readSpeed(normal), 38400);
  const task = await remote.createTask('Inherited task speed', 'stty speed; sleep 1'); assert.equal(await readSpeed(task), 9600);
});
