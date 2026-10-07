'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { generateKeyPairSync } = require('node:crypto');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { StandardRemote } = require('../src/standard-remote.cjs');
const { profile, fingerprint } = require('../src/core.cjs');
const { listDirectory, download, remotePath, downloadName } = require('../src/sftp-browser.cjs');
const { BrowserState } = require('../ui/files.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const config = { id: 'test', name: 'Test', host: 'server.example', username: 'tester', auth: 'password', sessionMode: 'standard' };
class Channel extends EventEmitter {
  constructor() { super(); this.writes = []; this.stderr = new EventEmitter(); this.stderr.pause = this.stderr.resume = () => {}; }
  pause() { this.paused = true; }
  resume() { this.paused = false; }
  close() { if (!this.closed) { this.closed = true; this.emit('close'); } }
  write(bytes, callback) { this.writes.push(Buffer.from(bytes)); queueMicrotask(() => callback()); return true; }
  setWindow(...args) { this.geometry = args; }
}
function standard() {
  const r = new StandardRemote(config); r.connected = true;
  r.client = new EventEmitter(); r.client.end = () => {};
  r.client.shell = (options, cb) => { const s = new Channel(); s.options = options; cb(null, s); };
  return r;
}
test('old profiles default to persistent; unsupported mode is rejected', () => {
  const { sessionMode, ...old } = config;
  assert.equal(profile(old).sessionMode, 'persistent'); assert.equal(profile(config).sessionMode, 'standard');
  assert.throws(() => profile({ ...old, sessionMode: 'automatic' }), /session mode/);
});
test('standard discovery and server-support checks execute no remote command', async () => {
  const r = standard(); r.exec = () => { throw new Error('NO EXEC'); };
  await r.ensureSupport(); assert.deepEqual(await r.discover(), []); r.disconnect();
});
test('standard output is paused before attachment and receives its own view key', async t => {
  const r = standard(); t.after(() => r.disconnect()); const p = await r.create('First');
  const s = r.shells.get(p.key).stream; assert.equal(s.paused, true);
  const output = []; r.on('output', (key, b) => output.push([key, b.toString()]));
  let snapshots = 0; r.on('snapshot', () => snapshots++);
  await r.open(p.key); s.emit('data', Buffer.from('ONLY FIRST'));
  assert.equal(snapshots, 1); assert.deepEqual(output, [[p.key, 'ONLY FIRST']]);
  await r.open(p.key); assert.equal(snapshots, 1, 'opening an existing shell does not reset or relaunch it');
});
test('standard PTY resize sends rows then columns, without shell commands', async t => {
  const r = standard(); t.after(() => r.disconnect()); const p = await r.create('Resize');
  const s = r.shells.get(p.key).stream; await r.resize(p.key, 140, 45);
  assert.deepEqual(s.geometry, [45, 140, 0, 0]); assert.equal(s.writes.length, 0);
});
test('standard messages preserve a long Unicode paste before Enter', async t => {
  const r = standard(); t.after(() => r.disconnect()); const p = await r.create('Ordering'); await r.open(p.key);
  const s = r.shells.get(p.key).stream, message = '😀'.repeat(20000);
  await Promise.all([r.input(p.key, message), r.input(p.key, '\r')]);
  assert.equal(Buffer.concat(s.writes).toString(), message + '\r');
});
test('closing one standard shell closes only its channel; it cannot be restored', async t => {
  const r = standard(); t.after(() => r.disconnect()); const a = await r.create('A'), b = await r.create('B');
  await r.open(a.key); await r.open(b.key);
  const sa = r.shells.get(a.key).stream, sb = r.shells.get(b.key).stream;
  r.closeView(a.key); assert.equal(sa.closed, true); assert.notEqual(sb.closed, true);
  assert.equal(r.activeShellCount(), 1); await assert.rejects(r.open(a.key), /ended/);
  assert.equal(r.panes.length, 1); assert.equal(r.panes[0].key, b.key);
});
test('standard renaming is local only and snapshot requests do not launch commands', async t => {
  const r = standard(); t.after(() => r.disconnect()); const p = await r.create('Before');
  const s = r.shells.get(p.key).stream; await r.rename(p.key, 'After');
  assert.equal(p.sessionName, 'After'); assert.equal(s.writes.length, 0);
  await assert.rejects(r.snapshot(p.key), /no retained server snapshot/);
});
test('standard disconnect discards input waiting behind a pending write', async () => {
  const r = standard(), p = await r.create('Queue'); await r.open(p.key);
  const s = r.shells.get(p.key).stream; s.write = bytes => { s.writes.push(Buffer.from(bytes)); return false; };
  const first = r.input(p.key, 'a'.repeat(50000)), second = r.input(p.key, '\r');
  const results = Promise.allSettled([first, second]); await tick(); r.disconnect();
  assert.ok((await results).every(x => x.status === 'rejected')); assert.equal(Buffer.concat(s.writes).includes(13), false);
});
test('late shell-open callback after disconnect closes only that channel', async () => {
  const r = standard(); let done; r.client.shell = (_opts, cb) => { done = cb; };
  const opening = r.create('Late'); r.disconnect(); const s = new Channel(); done(null, s);
  await assert.rejects(opening, /Console closed while opening/); assert.equal(s.closed, true); assert.equal(r.activeShellCount(), 0);
});
test('standard flow control pauses and resumes the correct channel', async t => {
  const r = standard(); t.after(() => r.disconnect()); const p = await r.create('Flow'); await r.open(p.key);
  const s = r.shells.get(p.key).stream; r.setOutputPaused(p.key, true); assert.equal(s.paused, true);
  r.setOutputPaused(p.key, false); assert.equal(s.paused, false);
});
test('standard session count and input memory are bounded', async t => {
  const r = standard(); t.after(() => r.disconnect());
  for (let i = 0; i < 16; i++) await r.create('Shell ' + i);
  await assert.rejects(r.create('Too many'), /limit 16/);
  const p = r.panes[0]; await r.open(p.key); const record = r.shells.get(p.key); record.pendingBytes = 2 * 1024 * 1024;
  await assert.rejects(r.input(p.key, 'x'), /queue is full/);
});

function attrs(bytes = 5, mode = 0o100600) { return { mode, size: bytes, mtime: 100, isFile() { return (this.mode & 0o170000) === 0o100000; }, isSymbolicLink() { return (this.mode & 0o170000) === 0o120000; } }; }
class SFTP extends EventEmitter {
  constructor() { super(); this.data = Buffer.from('hello'); this.pages = [[{ filename: 'hello.txt', attrs: attrs() }], false]; this.called = []; }
  end() { this.ended = true; }
  realpath(p, cb) { this.called.push(['realpath', p]); cb(null, p === '.' ? '/home/test' : p); }
  opendir(p, cb) { this.called.push(['opendir', p]); cb(null, Buffer.from('dir')); }
  readdir(handle, cb) { assert.ok(Buffer.isBuffer(handle)); cb(null, this.pages.shift() ?? false); }
  close(_handle, cb) { cb(null); }
  lstat(_path, cb) { cb(null, attrs(this.data.length)); }
  open(_path, _flags, cb) { cb(null, Buffer.from('file')); }
  fstat(_handle, cb) { cb(null, attrs(this.data.length)); }
  createReadStream(_path, options) { assert.ok(options.handle); return Readable.from([this.data]); }
}
function temp(t) { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'betterssh-files-test-')); t.after(() => fs.rmSync(p, { recursive: true, force: true })); return p; }
test('SFTP sidecar lists with handles and resolves home without shell commands', async () => {
  const s = new SFTP(); const result = await listDirectory({ sftp: async () => s }, '~');
  assert.equal(result.directory, '/home/test'); assert.equal(result.entries[0].path, '/home/test/hello.txt'); assert.equal(result.entries[0].kind, 'file'); assert.equal(s.ended, true);
});
test('directory listing sorts folders first and rejects hostile entry names', async () => {
  const s = new SFTP(); s.pages = [[{ filename: 'z.txt', attrs: attrs() }, { filename: 'folder', attrs: attrs(0, 0o040700) }, { filename: '../escape', attrs: attrs() }, { filename: '<img onerror=x>', attrs: attrs() }, { filename: 'bad\nname', attrs: attrs() }], false];
  const result = await listDirectory({ sftp: async () => s }, '/');
  assert.equal(result.entries[0].name, 'folder'); assert.equal(result.skipped, 2);
  assert.ok(result.entries.some(e => e.name === '<img onerror=x>'), 'ordinary text is not interpreted as HTML');
});
test('large SFTP directory listing is bounded and marked truncated', async () => {
  const s = new SFTP(); s.pages = [[...Array(10)].map((_, i) => ({ filename: `file${i}`, attrs: attrs() })), false];
  const r = await listDirectory({ sftp: async () => s }, '/', { maxEntries: 3 });
  assert.equal(r.entries.length, 3); assert.equal(r.truncated, true);
});
test('SFTP directory hangs time out and close their channel', async () => {
  const s = new SFTP(); s.opendir = () => {};
  await assert.rejects(listDirectory({ sftp: async () => s }, '/', { timeoutMs: 15 }), /timed out/); assert.equal(s.ended, true);
});
test('SFTP sidecar cancellation aborts directory requests', async () => {
  const s = new SFTP(), controller = new AbortController(); s.opendir = () => {};
  const job = listDirectory({ sftp: async () => s }, '/', { signal: controller.signal }); await tick(); controller.abort();
  await assert.rejects(job); assert.equal(s.ended, true);
});
test('SFTP download publishes exact bytes to a new local file', async t => {
  const s = new SFTP(), target = path.join(temp(t), 'output.txt');
  await download({ sftp: async () => s }, '/remote/hello.txt', target);
  assert.equal(fs.readFileSync(target, 'utf8'), 'hello'); assert.equal(s.ended, true);
  assert.deepEqual(fs.readdirSync(path.dirname(target)), ['output.txt']);
});
test('SFTP download cannot overwrite an existing local target', async t => {
  const s = new SFTP(), target = path.join(temp(t), 'output.txt'); fs.writeFileSync(target, 'original');
  await assert.rejects(download({ sftp: async () => s }, '/hello.txt', target), /No file was overwritten/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'original'); assert.deepEqual(fs.readdirSync(path.dirname(target)), ['output.txt']);
});
test('SFTP download supports empty files', async t => {
  const s = new SFTP(), target = path.join(temp(t), 'empty'); s.data = Buffer.alloc(0);
  await download({ sftp: async () => s }, '/empty', target); assert.equal(fs.statSync(target).size, 0);
});
test('SFTP download rejects symlink targets before reading data', async t => {
  const s = new SFTP(), target = path.join(temp(t), 'output'); s.lstat = (_p, cb) => cb(null, attrs(5, 0o120777));
  await assert.rejects(download({ sftp: async () => s }, '/link', target), /regular files only/); assert.equal(fs.existsSync(target), false);
});
test('a short or oversized download never publishes partial data', async t => {
  for (const data of ['hi', 'far too long']) {
    const s = new SFTP(), target = path.join(temp(t), 'output'); s.createReadStream = () => Readable.from([Buffer.from(data)]);
    await assert.rejects(download({ sftp: async () => s }, '/file', target), /size|data/); assert.equal(fs.existsSync(target), false);
  }
});
test('a changed file during download is rejected', async t => {
  const s = new SFTP(), target = path.join(temp(t), 'output'); let calls = 0;
  s.fstat = (_h, cb) => cb(null, { ...attrs(5), mtime: ++calls === 1 ? 100 : 101 });
  await assert.rejects(download({ sftp: async () => s }, '/file', target), /changed during download/); assert.equal(fs.existsSync(target), false);
});
test('stalled downloads abort, clean owned temp files and leave destination absent', async t => {
  const s = new SFTP(), dir = temp(t), target = path.join(dir, 'output'); s.createReadStream = () => new Readable({ read() {} });
  await assert.rejects(download({ sftp: async () => s }, '/file', target, { idleTimeoutMs: 20 })); assert.equal(fs.existsSync(target), false); assert.deepEqual(fs.readdirSync(dir), []);
});
test('remote paths reject controls and local default names are Windows-safe', () => {
  for (const p of ['abc', '/bad\nfile', '/bad\x00file', '']) assert.throws(() => remotePath(p));
  assert.equal(downloadName('/CON.txt'), 'download-CON.txt'); assert.equal(downloadName('/a:b.txt'), 'a_b.txt');
});
test('late SFTP listing cannot populate a different terminal sidecar', async () => {
  const a = deferred(), b = deferred();
  const api = { cancelFileList: async () => {}, listFiles: key => key === 'a/view' ? a.promise : b.promise };
  const first = new BrowserState(api, { key: 'a/view', profileId: 'a' }), second = new BrowserState(api, { key: 'b/view', profileId: 'b' });
  first.context('A', true); first.show(true); second.context('B', true); second.show(true); first.destroy();
  b.resolve({ directory: '/B', parent: '/', entries: [{ name: 'B', path: '/B/item' }], truncated: false, skipped: 0 }); await tick();
  a.resolve({ directory: '/A', parent: '/', entries: [{ name: 'A', path: '/A/item' }], truncated: false, skipped: 0 }); await tick();
  assert.equal(second.directory, '/B'); assert.equal(second.entries[0].name, 'B'); assert.equal(first.directory, '~'); second.destroy();
});
test('collapsing the sidecar cancels only its own listing but never closes SSH', async () => {
  const wait = deferred(); const cancelled = [];
  const model = new BrowserState({ cancelFileList: async (...args) => { cancelled.push(args); }, listFiles: () => wait.promise }, { key: 'a/view', profileId: 'a' });
  model.context('A', true); model.show(true); model.show(false);
  wait.resolve({ directory: '/late', entries: [] }); await tick();
  assert.equal(model.visible, false); assert.equal(model.directory, '~'); assert.deepEqual(cancelled, [['a/view', model.browserId]]); model.destroy();
});
test('per-pane directory state on the same host is remembered without sending cd commands', async () => {
  const api = { cancelFileList: async () => {}, listFiles: async (_key, _id, directory) => ({ directory, parent: '/', entries: [], skipped: 0, truncated: false }) };
  const a = new BrowserState(api, { key: 'server/a', profileId: 'server' }), b = new BrowserState(api, { key: 'server/b', profileId: 'server' });
  a.context('Server', true); b.context('Server', true); a.show(true); b.show(true); await tick();
  await a.load('/a-work'); await b.load('/b-work'); a.show(false); a.show(true); await tick();
  assert.equal(a.directory, '/a-work'); assert.equal(b.directory, '/b-work'); a.destroy(); b.destroy();
});

test('real loopback SSH standard mode works on a server that rejects every exec request', { timeout: 15000 }, async t => {
  const { Server } = require('ssh2');
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs1' });
  let executions = 0, shells = 0, pty, peer; const received = [];
  const server = new Server({ hostKeys: [key] }, client => {
    peer = client; client.on('error', () => {});
    client.on('authentication', ctx => ctx.method === 'password' && ctx.password === 'synthetic' ? ctx.accept() : ctx.reject());
    client.on('ready', () => client.on('session', accept => {
      const session = accept(); session.on('pty', (acceptPty, _reject, info) => { pty = info; acceptPty(); });
      session.on('exec', (_accept, reject) => { executions++; reject(); });
      session.on('shell', acceptShell => { shells++; const stream = acceptShell(); stream.write('STANDARD_READY'); stream.on('data', b => { received.push(Buffer.from(b)); stream.write(b); }); });
      session.on('window-change', acceptWindow => acceptWindow?.());
    }));
  });
  server.on('error', () => {}); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const r = new StandardRemote({ ...config, host: '127.0.0.1', port: server.address().port }, { secrets: { password: 'synthetic' }, knownHosts: '', trust: async ({ fingerprint: fp }) => fp === fingerprint(require('ssh2').utils.parseKey(key).getPublicSSH()) });
  t.after(() => { r.disconnect(); peer?.end(); server.close(); });
  await r.connect(); assert.equal(executions, 0); assert.equal(shells, 0);
  const p = await r.create('Real standard'); const output = []; r.on('output', (_key, b) => output.push(b.toString())); await r.open(p.key);
  await Promise.all([r.input(p.key, 'X'.repeat(700)), r.input(p.key, '\r')]);
  for (let i = 0; i < 100 && Buffer.concat(received).length < 701; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(Buffer.concat(received).toString(), 'X'.repeat(700) + '\r');
  assert.equal(executions, 0); assert.equal(shells, 1); assert.equal(pty.term, 'xterm-256color');
  assert.match(output.join(''), /STANDARD_READY/); r.closeView(p.key); await assert.rejects(r.open(p.key), /ended/);
});

function mainHarness(MixedClass) {
  const vm = require('node:vm'), { createRequire } = require('node:module');
  const handlers = new Map(), events = [], app = new EventEmitter(); let response = 1, quits = 0;
  Object.assign(app, { requestSingleInstanceLock: () => true, whenReady: () => new Promise(() => {}), quit: () => { quits++; }, getPath: () => os.tmpdir(), getVersion: () => 'test' });
  const frame = { url: 'betterssh://app/ui/index.html' }, webContents = { mainFrame: frame, send: (_ch, value) => events.push(value) };
  const window = { webContents, isDestroyed: () => false };
  const electron = { app, BrowserWindow() {}, ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    protocol: { registerSchemesAsPrivileged() {} }, dialog: { showMessageBox: async () => ({ response }) }, clipboard: {}, Menu: {}, shell: {}, net: {} };
  const req = createRequire(path.resolve(__dirname, '../src/main.cjs')), mod = { exports: {} };
  const context = { require: name => name === 'electron' ? electron : name === './mixed-remote.cjs' && MixedClass ? { MixedRemote: MixedClass } : req(name), module: mod, __dirname: path.resolve(__dirname, '../src'),
    process, Buffer, console, setTimeout, clearTimeout, AbortController, Response, URL };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../src/main.cjs'), 'utf8') + '\nmodule.exports={ setup(s,w){store=s;window=w;registerIPC();},connect,connections,output,queueOutput,standardCount};', context);
  const main = mod.exports; main.setup({ data: { profiles: [profile(config)], pins: {} }, save() {} }, window);
  return { main, events, app, respond: value => { response = value; }, quits: () => quits,
    invoke: (name, ...args) => handlers.get('betterssh:' + name)({ sender: webContents, senderFrame: frame }, ...args) };
}
test('main requires confirmation before closing a standard shell; Cancel preserves it', async t => {
  const h = mainHarness(), r = standard(); t.after(() => r.disconnect()); const p = await r.create('Confirm'); await r.open(p.key);
  h.main.connections.set('test', { profile: profile(config), remote: r });
  assert.equal(await h.invoke('close', p.key), false); assert.equal(r.activeShellCount(), 1);
  h.respond(0); assert.equal(await h.invoke('close', p.key), true); assert.equal(r.activeShellCount(), 0);
});
test('main Standard transport loss releases credentials and cannot schedule replacement shells', async t => {
  let created = 0, clientEnded = 0;
  class FixtureRemote extends require('../src/mixed-remote.cjs').MixedRemote {
    constructor(settings, options) {
      super(settings, options);
      this.client = new EventEmitter(); this.client.end = () => clientEnded++;
      this.client.shell = (_options, done) => { created++; done(null, new Channel()); };
    }
    async connect() { this.connected = true; await this.ensureSupport(); return []; }
  }
  const h = mainHarness(FixtureRemote);
  await h.main.connect('test', { password: 'synthetic-only' });
  const r = h.main.connections.get('test'), remote = r.remote;
  t.after(() => remote.disconnect());
  assert.equal(created, 1); assert.equal(remote.secrets.password, 'synthetic-only');
  remote.connected = false; remote.emit('disconnected', new Error('Synthetic transport loss'));
  assert.equal(r.state, 'disconnected'); assert.equal(r.wanted, false);
  assert.equal(Object.keys(r.secrets).length, 0); assert.deepEqual(remote.secrets, {});
  assert.equal(remote.client, null); assert.equal(clientEnded, 1);
  assert.equal(remote.activeShellCount(), 0); assert.equal(r.timer, undefined);
  await tick(); assert.equal(created, 1);
});
test('main requires confirmation on standard disconnect and quit', async t => {
  const h = mainHarness(), r = standard(); t.after(() => r.disconnect()); await r.create('Confirm');
  h.main.connections.set('test', { profile: profile(config), remote: r });
  assert.equal(await h.invoke('disconnect', 'test'), false); assert.equal(r.connected, true);
  h.app.emit('before-quit', { preventDefault() {} }); await tick(); assert.equal(h.quits(), 0); assert.equal(r.connected, true);
  h.respond(0); h.app.emit('before-quit', { preventDefault() {} }); await tick(); assert.equal(h.quits(), 1); assert.equal(r.connected, false);
});
test('main standard-output acknowledgement resumes flow without touching another pane', async t => {
  const h = mainHarness(), r = standard(); t.after(() => r.disconnect()); const p = await r.create('Flow'); await r.open(p.key);
  const stream = r.shells.get(p.key).stream; h.main.connections.set('test', { profile: profile(config), remote: r });
  h.main.queueOutput(p.key, Buffer.alloc(40000, 65)); assert.equal(stream.paused, true);
  const event = h.events.find(e => e.type === 'output'); assert.ok(event);
  await h.invoke('ack', p.key, event.epoch, event.sequence); assert.equal(stream.paused, false);
  h.main.output.discard(p.key);
});
test('main rejects directory results when the authenticated connection changes', async () => {
  const h = mainHarness(), s = new SFTP(); let done;
  s.readdir = (_h, cb) => { done = cb; };
  const view = { active: true };
  const remote = { profile: profile(config), connected: true, views: new Map([['test/view', view]]), pane: () => ({}), sftp: async () => s };
  h.main.connections.set('test', { remote, profile: remote.profile }); const listing = h.invoke('listFiles', 'test/view', 'browser-instance', '/'); await tick();
  h.main.connections.set('test', { remote: { ...remote }, profile: remote.profile }); done(null, false);
  await assert.rejects(listing, /session changed/);
});
