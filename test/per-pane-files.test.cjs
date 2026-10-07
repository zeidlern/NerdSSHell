'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const { BrowserState, panelSize } = require('../ui/files.js');
const { FileListings } = require('../src/file-listings.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function listing(directory = '/home/test') { return { directory, parent: '/', entries: [{ name: 'report.txt', path: directory + '/report.txt', kind: 'file' }], skipped: 0, truncated: false }; }
function model(key, api = {}, browserId) {
  return new BrowserState({ cancelFileList: async () => {}, listFiles: async (_k, _id, p) => listing(p === '~' ? '/home/test' : p), ...api },
    { key, profileId: key.split('/')[0], browserId });
}
async function show(m) { m.context('tester@server.example', true, m.key); m.show(true); await tick(); }

test('browser ownership is immutable and cannot be rebound to a different host', () => {
  const m = model('host/pane');
  assert.throws(() => { m.key = 'other/pane'; }, TypeError);
  assert.throws(() => { m.id = 'other'; }, TypeError);
  assert.throws(() => new BrowserState({}, { key: 'host/pane', profileId: 'other' }));
  m.destroy();
});
test('four browsers including three on the same server retain independent folders and UI settings', async t => {
  const models = ['host/a', 'host/b', 'host/c', 'other/d'].map(key => model(key));
  for (const [i, m] of models.entries()) { await show(m); await m.load('/project-' + i); m.filter = 'filter-' + i; m.hidden = i % 2 === 0; m.setDock(i % 2 ? 'bottom' : 'right'); m.setSize(220 + i * 10); }
  const [a, b] = models; a.show(false); a.show(true); await tick();
  assert.deepEqual(models.map(m => m.directory), ['/project-0', '/project-1', '/project-2', '/project-3']);
  assert.equal(b.visible, true); assert.equal(b.filter, 'filter-1'); assert.equal(b.hidden, false); assert.equal(b.dock, 'bottom'); assert.equal(b.height, 230);
  for (const m of models) m.destroy();
});
test('selection survives collapse/reopen and refresh when the file still exists', async t => {
  const m = model('host/a'); await show(m); m.select('/home/test/report.txt');
  m.show(false); m.show(true); await tick(); assert.equal(m.selectedPath, '/home/test/report.txt');
  await m.load('/another'); assert.equal(m.selectedPath, null); m.destroy();
});
test('a new listing drops a selection that no longer exists', async t => {
  const m = model('host/a'); await show(m); m.select('/home/test/report.txt');
  m.api.listFiles = async () => ({ ...listing(), entries: [] });
  await m.load(m.directory); assert.equal(m.selected(), null); m.destroy();
});

test('filtering out a selected file clears transfer and copy targets without restoring them when the filter clears', async t => {
  const downloads = []; const m = model('host/a', { downloadFile: async (...args) => downloads.push(args) });
  await show(m); m.select('/home/test/report.txt'); m.setFilter('other');
  assert.equal(m.selectedPath, null); assert.equal(m.selected(), null); await m.download(); assert.deepEqual(downloads, []);
  assert.equal(m.selected()?.path || m.directory, '/home/test');
  m.setFilter(''); assert.equal(m.selected(), null);
  m.select('/home/test/report.txt'); m.setFilter('REPORT'); assert.equal(m.selected()?.path, '/home/test/report.txt'); m.destroy();
});

test('turning hidden files off clears a hidden selection and prevents downloading it', async t => {
  const downloads = []; const m = model('host/a', { downloadFile: async (...args) => downloads.push(args),
    listFiles: async () => ({ ...listing(), entries: [{ name: '.secret', path: '/home/test/.secret', kind: 'file' }] }) });
  await show(m); m.setHidden(true); m.select('/home/test/.secret'); assert.equal(m.selected()?.name, '.secret');
  m.setHidden(false); assert.equal(m.selectedPath, null); await m.download(); assert.deepEqual(downloads, []);
  m.select('/home/test/.secret'); assert.equal(m.selected(), null); m.destroy();
});

test('keyboard focus in a terminal or browser activates its owner without moving focus or rebuilding the layout', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../ui/app.js'), 'utf8');
  function node() { const n = new EventTarget(); Object.assign(n, { dataset: {}, children: [], classes: new Set(), setAttribute() {}, append(...children) { this.children.push(...children); } });
    n.classList = { toggle(name, enabled) { if (enabled) n.classes.add(name); else n.classes.delete(name); } }; return n; }
  class Terminal {
    constructor() { this.parser = { registerOscHandler() {} }; }
    loadAddon() {} open() {} onData() {} onBell() {} attachCustomKeyEventHandler() {} attachCustomWheelEventHandler() {}
    focus() { throw new Error('Pane activation must preserve keyboard focus.'); }
  }
  const grid = node(), views = new Map(), state = { activeElement: null }, toolbarOwners = [], dimensions = [], selectionBindings = [];
  const context = vm.createContext({ element: node, button: node, Terminal, FitAddon: { FitAddon: class {} }, SearchAddon: { SearchAddon: class {} },
    ResizeObserver: class { observe() {} }, NerdSSHellFiles: { create: options => ({ owner: options.key }) }, views,
    // This fixture isolates focus/layout; real gesture behavior is covered in selection-copy tests.
    NerdSSHellSelectionCopy: { attach(options) { selectionBindings.push(options); return { dispose() {} }; } },
    profiles: new Map([['host', { name: 'Host' }]]), api: {}, appearance: {}, active: 'host/a', selectedProfile: '',
    label: p => p.key, terminalTheme() {}, waitingIndicator: node, $: () => grid, message() {}, syncFileToggle() {}, renderTabs() {}, renderConnections() {}, syncActiveAttention() {},
    syncFiles() { toolbarOwners.push(context.active); }, updateDimensions() { dimensions.push(context.active); }, remember() {}, dropTarget() {}, dragSource() {},
    render() { throw new Error('Focus must not rearrange visible panes.'); }, window: { NerdSSHellAttention: { attach: () => ({ acknowledge() {}, input() {} }) } }, document: state });
  vm.runInContext(source.slice(source.indexOf('function activateVisiblePane('), source.indexOf('function visibleKeys(')) +
    source.slice(source.indexOf('function createView('), source.indexOf('async function openPane(')), context);
  const a = context.createView({ key: 'host/a', profileId: 'host' }), b = context.createView({ key: 'host/b', profileId: 'host' });
  assert.equal(selectionBindings.length, 2);
  assert.equal(selectionBindings[0].host, a.host); assert.equal(selectionBindings[0].terminal, a.terminal);
  assert.equal(selectionBindings[1].host, b.host); assert.equal(selectionBindings[1].terminal, b.terminal);
  for (const [layout, orientation] of [[1, 'side-by-side'], [2, 'side-by-side'], [2, 'stacked'], [4, 'side-by-side']]) {
    context.layout = layout; context.twoPaneOrientation = orientation; context.active = 'host/a';
    for (const target of [b.host, { browserInput: true, value: '/editing-path', selectionStart: 5 }]) {
      context.active = 'host/a'; state.activeElement = target; b.wrapper.dispatchEvent(new Event('focusin'));
      assert.equal(context.active, 'host/b'); assert.equal(context.selectedProfile, 'host'); assert.equal(state.activeElement, target);
      assert.equal(context.layout, layout); assert.equal(context.twoPaneOrientation, orientation);
      assert.equal(b.wrapper.classes.has('focused'), true); assert.equal(a.wrapper.classes.has('focused'), false);
      assert.equal(toolbarOwners.at(-1), 'host/b'); assert.equal(dimensions.at(-1), 'host/b');
    }
  }
  a.wrapper.dispatchEvent(new Event('pointerdown')); assert.equal(context.active, 'host/a');
});
test('refresh/collapse cancellation uses the owning pane plus its unique browser token', async t => {
  const wait = deferred(), cancels = [];
  const a = model('same/a', { listFiles: () => wait.promise, cancelFileList: async (...args) => cancels.push(args) }, 'browser-a');
  const b = model('same/b'); a.context('A', true); a.show(true); await show(b); a.show(false);
  wait.resolve(listing('/late')); await tick();
  assert.deepEqual(cancels, [['same/a', 'browser-a']]); assert.equal(a.directory, '~'); assert.equal(b.directory, '/home/test');
  a.destroy(); b.destroy();
});
test('a stale older directory response cannot replace newer navigation', async t => {
  const waits = [deferred(), deferred()]; let next = 0;
  const m = model('host/a', { listFiles: () => waits[next++].promise });
  m.context('Host', true); m.show(true); const latest = m.load('/latest');
  waits[1].resolve(listing('/latest')); await latest; waits[0].resolve(listing('/old')); await tick();
  assert.equal(m.directory, '/latest'); m.destroy();
});
test('disconnect invalidates pending results while preserving each browser location', async t => {
  const m = model('host/a'); await show(m); await m.load('/work'); const wait = deferred();
  m.api.listFiles = () => wait.promise; const request = m.load('/secret'); m.context('Host', false);
  wait.resolve(listing('/secret')); await request; assert.equal(m.directory, '/work'); assert.equal(m.connected, false); m.destroy();
});
test('disposed browser cannot request files or mutate a reopened view', async t => {
  const wait = deferred(); const old = model('host/a', { listFiles: () => wait.promise });
  old.context('Host', true); old.show(true); old.destroy();
  const current = model('host/a'); await show(current); assert.notEqual(old.browserId, current.browserId);
  wait.resolve(listing('/stale')); await tick(); old.show(true); assert.equal(current.directory, '/home/test'); assert.equal(old.directory, '~'); current.destroy();
});
test('uploads capture owner and destination and finish even after their browser collapses', async t => {
  const wait = deferred(), actions = [];
  const m = model('host/a', { browserUpload: (...args) => { actions.push(args); return wait.promise; } }); await show(m); await m.load('/chosen');
  const transfer = m.upload(['synthetic-file']); m.show(false); m.directory = '/later'; wait.resolve(['/chosen/synthetic-file']); await transfer;
  assert.deepEqual(actions, [['host/a', '/chosen', ['synthetic-file']]]); assert.equal(m.directory, '/later'); m.destroy();
});
test('downloads capture the file path from the correct same-host pane', async t => {
  const actions = [], wait = deferred(); const api = { downloadFile: (...args) => { actions.push(args); return wait.promise; } };
  const a = model('host/a', api), b = model('host/b', api); await show(a); await show(b); await a.load('/alpha'); await b.load('/beta');
  b.select('/beta/report.txt'); const done = b.download(); b.show(false); a.select('/alpha/report.txt'); wait.resolve('/local/new.txt'); await done;
  assert.deepEqual(actions, [['host/b', '/beta/report.txt']]); a.destroy(); b.destroy();
});
test('hidden/disconnected/disposed browsers do not start transfers', async t => {
  let calls = 0; const m = model('host/a', { browserUpload: async () => calls++, downloadFile: async () => calls++ });
  await show(m); m.select('/home/test/report.txt'); m.show(false); await m.upload(); await m.download(); m.destroy(); await m.upload(); assert.equal(calls, 0);
});
test('independent width and height preferences survive dock changes', () => {
  const m = model('host/a'); m.setSize(310); m.setDock('bottom'); m.setSize(200); m.setDock('right'); assert.equal(m.width, 310); assert.equal(m.height, 200);
  assert.throws(() => m.setDock('left')); m.destroy();
});
test('splitter sizing keeps terminal space and stays finite at narrow/hidden sizes', () => {
  for (const available of [0, 1, 100, 300, 800, 1500]) {
    const actual = panelSize(300, available); assert.ok(Number.isFinite(actual) && actual >= 0 && actual <= available * .65 + 1);
  }
  assert.equal(panelSize(300, NaN), 0); assert.equal(panelSize(300, 800), 300);
});
function owner(key, browserId, valid = () => true) { return { key, browserId, profileId: key.split('/')[0], valid }; }
test('main listing registry allows same-host requests concurrently without cross-cancellation', async t => {
  const reg = new FileListings(), a = deferred(), b = deferred(); let signalA, signalB;
  const first = reg.run(owner('host/a', 'a'), signal => { signalA = signal; return a.promise; });
  const second = reg.run(owner('host/b', 'b'), signal => { signalB = signal; return b.promise; });
  reg.cancel('host/a', 'a'); assert.equal(signalA.aborted, true); assert.equal(signalB.aborted, false);
  a.resolve('a'); b.resolve('b'); await assert.rejects(first); assert.equal(await second, 'b'); assert.equal(reg.pending.size, 0);
});
test('an old browser cancel cannot abort a new browser with the same terminal key', async t => {
  const reg = new FileListings(), a = deferred(), b = deferred(); let currentSignal;
  const old = reg.run(owner('host/a', 'old'), () => a.promise); const current = reg.run(owner('host/a', 'new'), signal => { currentSignal = signal; return b.promise; });
  reg.cancel('host/a', 'old'); reg.cancel('other/a', 'new'); assert.equal(currentSignal.aborted, false);
  a.resolve(); b.resolve('new'); await assert.rejects(old); assert.equal(await current, 'new');
});
test('listing result is rejected after owner view or connection replacement', async t => {
  const reg = new FileListings(), wait = deferred(); let valid = true;
  const p = reg.run(owner('host/a', 'a', () => valid), () => wait.promise); valid = false; wait.resolve('bad'); await assert.rejects(p, /changed/);
});
test('listing limits include superseded requests until cleanup completes', async t => {
  const reg = new FileListings(2), a = deferred(), b = deferred();
  const first = reg.run(owner('host/a', 'a'), () => a.promise); const second = reg.run(owner('host/a', 'a'), () => b.promise);
  await assert.rejects(reg.run(owner('host/b', 'b'), async () => 'unexpected'), /Too many/);
  assert.equal(reg.pending.size, 2); a.resolve(); await assert.rejects(first); b.resolve('current'); assert.equal(await second, 'current');
  assert.equal(await reg.run(owner('host/b', 'b'), async () => 'works'), 'works');
});
test('closing one pane cancels only that pane; disconnect cancels all its host listings', async t => {
  const reg = new FileListings(), waits = [deferred(), deferred(), deferred()], signals = [];
  const keys = ['host/a', 'host/b', 'other/c'];
  const requests = keys.map((key, i) => reg.run(owner(key, String(i)), signal => { signals.push(signal); return waits[i].promise; }));
  reg.cancelView('host/a'); assert.deepEqual(signals.map(s => s.aborted), [true, false, false]);
  reg.cancelProfile('host'); assert.deepEqual(signals.map(s => s.aborted), [true, true, false]);
  waits.forEach((w, i) => w.resolve(i)); const done = await Promise.allSettled(requests); assert.deepEqual(done.map(x => x.status), ['rejected', 'rejected', 'fulfilled']);
});
test('invalid browser identities and cross-owner token reuse are rejected', async t => {
  const reg = new FileListings(), wait = deferred(); const pending = reg.run(owner('host/a', 'one'), () => wait.promise);
  await assert.rejects(reg.run(owner('host/b', 'one'), async () => 'wrong'), /different session/);
  for (const value of ['', '../bad', '\n', 'x'.repeat(81)]) await assert.rejects(reg.run(owner('host/a', value), async () => 'wrong'), /identity/);
  wait.resolve(); await pending;
});

function harness(t) {
  const handlers = new Map(), requests = [], transfers = [], dialogs = [], app = new EventEmitter();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'nerdsshell-pane-main-'));
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  Object.assign(app, { isPackaged: true, setPath() {}, commandLine: { getSwitchValue: () => data }, requestSingleInstanceLock: () => true, whenReady: () => new Promise(() => {}), quit() {}, getPath: () => data, getVersion: () => 'test' });
  const frame = { url: 'nerdsshell://app/ui/index.html' }, webContents = { mainFrame: frame, send() {} };
  const window = { webContents, isDestroyed: () => false }, req = createRequire(path.resolve(__dirname, '../src/main.cjs')), mod = { exports: {} };
  const electron = { app, BrowserWindow() {}, ipcMain: { handle: (n, fn) => handlers.set(n, fn) }, protocol: { registerSchemesAsPrivileged() {} },
    dialog: { showMessageBox: async () => ({ response: 1 }), showSaveDialog: () => { const d = deferred(); dialogs.push(d); return d.promise; } } };
  const context = { require: name => name === 'electron' ? electron : name === './sftp-browser.cjs' ? {
    ...req(name), listDirectory: (remote, dir, options) => { const wait = deferred(); requests.push({ remote, dir, ...options, wait }); return wait.promise; },
    download: async (remote, source, target) => { transfers.push({ remote, source, target }); return target; }
  } : req(name), module: mod, __dirname: path.resolve(__dirname, '../src'), process, Buffer, console, setTimeout, clearTimeout, AbortController, Response, URL };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../src/main.cjs'), 'utf8') + '\nmodule.exports={ setup(s,w){store=s;window=w;registerIPC();},connections,fileListings };', context);
  const main = mod.exports; const p = { id: 'host', name: 'Host', username: 'test', host: 'host.example', sessionMode: 'persistent' };
  const views = new Map([['host/a', { active: true }], ['host/b', { active: true }]]);
  const remote = { profile: p, connected: true, views, pane: key => { if (!views.has(key)) throw new Error('missing pane'); return {}; }, closeView: key => views.delete(key) };
  main.setup({ data: { profiles: [p], pins: {} }, save() {} }, window); main.connections.set('host', { profile: p, remote });
  return { main, remote, views, requests, transfers, dialogs, invoke: (name, ...args) => handlers.get('nerdsshell:' + name)({ sender: webContents, senderFrame: frame }, ...args) };
}
test('actual IPC wiring uses pane keys and isolates cancel on same-host browsers', async t => {
  const h = harness(t); const a = h.invoke('listFiles', 'host/a', 'a', '/alpha'), b = h.invoke('listFiles', 'host/b', 'b', '/beta');
  await tick(); await h.invoke('cancelFileList', 'host/a', 'a');
  assert.equal(h.requests[0].signal.aborted, true); assert.equal(h.requests[1].signal.aborted, false);
  h.requests[0].wait.resolve(listing('/alpha')); h.requests[1].wait.resolve(listing('/beta'));
  await assert.rejects(a); assert.equal((await b).directory, '/beta');
});
test('actual IPC drops a directory response after the pane view is replaced', async t => {
  const h = harness(t); const result = h.invoke('listFiles', 'host/a', 'a', '/');
  await tick(); h.views.set('host/a', { active: true }); h.requests[0].wait.resolve(listing()); await assert.rejects(result, /changed/);
});
test('actual view close cancels its listing without closing the sibling browser', async t => {
  const h = harness(t); const a = h.invoke('listFiles', 'host/a', 'a', '/alpha'), b = h.invoke('listFiles', 'host/b', 'b', '/beta');
  await tick(); await h.invoke('close', 'host/a'); assert.equal(h.requests[0].signal.aborted, true); assert.equal(h.requests[1].signal.aborted, false);
  h.requests[0].wait.resolve(listing()); h.requests[1].wait.resolve(listing('/beta')); await assert.rejects(a); await b;
});
test('native download dialog cannot redirect a transfer after its owner closes', async t => {
  const h = harness(t); const download = h.invoke('downloadFile', 'host/a', '/alpha/report.txt');
  await tick(); h.views.delete('host/a'); h.dialogs[0].resolve({ canceled: false, filePath: '/synthetic/new.txt' });
  await assert.rejects(download, /changed/); assert.equal(h.transfers.length, 0);
});
test('native download keeps original server and source when another pane gains focus', async t => {
  const h = harness(t); const download = h.invoke('downloadFile', 'host/b', '/beta/report.txt');
  await tick(); h.views.set('host/a', { active: true }); h.dialogs[0].resolve({ canceled: false, filePath: '/synthetic/new.txt' });
  assert.equal(await download, '/synthetic/new.txt'); assert.equal(h.transfers[0].remote, h.remote); assert.equal(h.transfers[0].source, '/beta/report.txt');
});

test('real loopback SSH: two pane browsers share authentication but cancel independent SFTP channels', { timeout: 15000 }, async t => {
  const { Server, utils } = require('ssh2');
  const { generateKeyPairSync } = require('node:crypto');
  const { StandardRemote } = require('../src/standard-remote.cjs');
  const { fingerprint } = require('../src/core.cjs');
  const { listDirectory } = require('../src/sftp-browser.cjs');
  const hostKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs1' });
  const fileAttrs = { mode: 0o100644, size: 3, uid: 1, gid: 1, atime: 100, mtime: 100 };
  const dirAttrs = { ...fileAttrs, mode: 0o040755, size: 0 };
  let peer, logins = 0, sftpChannels = 0, executions = 0;
  const slowStarted = deferred();
  const server = new Server({ hostKeys: [hostKey] }, client => {
    peer = client; logins++; client.on('error', () => {});
    client.on('authentication', ctx => ctx.method === 'password' && ctx.password === 'synthetic-only' ? ctx.accept() : ctx.reject());
    client.on('ready', () => client.on('session', accept => {
      const session = accept();
      session.on('exec', (_accept, reject) => { executions++; reject(); });
      session.on('pty', acceptPty => acceptPty());
      session.on('shell', acceptShell => { const stream = acceptShell(); stream.on('error', () => {}); stream.write('test shell\r\n'); });
      session.on('sftp', acceptSftp => {
        const s = acceptSftp(); sftpChannels++; let directory, listed = false; s.on('error', () => {});
        s.on('REALPATH', (id, value) => { const name = value === '.' ? '/home/test' : value; s.name(id, [{ filename: name, longname: name, attrs: dirAttrs }]); });
        s.on('OPENDIR', (id, value) => { directory = value; s.handle(id, Buffer.from('handle')); });
        s.on('READDIR', id => {
          if (directory === '/slow') { slowStarted.resolve(); return; }
          if (directory === '/denied') { s.status(id, utils.sftp.STATUS_CODE.PERMISSION_DENIED); return; }
          if (listed) s.status(id, utils.sftp.STATUS_CODE.EOF);
          else { listed = true; s.name(id, [{ filename: 'marker.txt', longname: 'marker.txt', attrs: fileAttrs }]); }
        });
        s.on('CLOSE', id => s.status(id, utils.sftp.STATUS_CODE.OK));
      });
    }));
  });
  server.on('error', () => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const remote = new StandardRemote({ id: 'loopback', name: 'Test', host: '127.0.0.1', port: server.address().port, username: 'test', auth: 'password', sessionMode: 'standard' },
    { secrets: { password: 'synthetic-only' }, knownHosts: '', trust: async ({ fingerprint: fp }) => fp === fingerprint(utils.parseKey(hostKey).getPublicSSH()) });
  t.after(() => { remote.disconnect(); peer?.end(); server.close(); });
  await remote.connect();
  const a = await remote.create('A'), b = await remote.create('B'); await remote.open(a.key); await remote.open(b.key);
  const reg = new FileListings();
  const first = reg.run(owner(a.key, 'first', () => remote.connected), signal => listDirectory(remote, '/slow', { signal })); first.catch(() => {});
  await slowStarted.promise;
  const second = reg.run(owner(b.key, 'second', () => remote.connected), signal => listDirectory(remote, '/beta', { signal }));
  reg.cancel(a.key, 'first');
  await assert.rejects(first);
  const result = await second; assert.equal(result.directory, '/beta'); assert.equal(result.entries[0].path, '/beta/marker.txt');
  assert.equal(remote.connected, true); assert.equal(remote.activeShellCount(), 2); assert.equal(logins, 1); assert.equal(sftpChannels, 2); assert.equal(executions, 0);
  await assert.rejects(listDirectory(remote, '/denied'), error => error.code === 3, 'only READDIR EOF is treated as completion, not permission errors');
});
