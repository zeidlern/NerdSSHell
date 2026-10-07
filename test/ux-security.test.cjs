'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const { installDesktopTools } = require('../src/desktop-tools.cjs');
const { spawnElevatedPty, bootstrap } = require('../src/elevated-pty.cjs');
async function fixture(t, RemoteClass) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nerdsshell-ux-security-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const handlers = new Map(), native = [], app = new EventEmitter(); let window;
  Object.assign(app, { isPackaged: true, setPath() {}, commandLine: { getSwitchValue: () => directory }, requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(),
    getPath: () => directory, getVersion: () => 'synthetic', quit() {}, exit() {} });
  class Window extends EventEmitter {
    constructor() { super(); window = this; this.webContents = new EventEmitter();
      this.webContents.mainFrame = { url: 'nerdsshell://app/ui/index.html' }; this.webContents.send = () => {};
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.session = { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} };
    }
    isDestroyed() { return false; } loadURL() { return Promise.resolve(); }
  }
  const dialog = { showMessageBox: async () => { native.push('message'); return { response: 1 }; },
    showOpenDialog: async () => { native.push('open'); return { canceled: true }; },
    showSaveDialog: async () => { native.push('save'); return { canceled: true }; }, showErrorBox: (_title, message) => { throw Error(message); } };
  const electron = { app, BrowserWindow: Window, ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    protocol: { registerSchemesAsPrivileged() {}, handle() {} }, dialog, clipboard: {}, Menu: { setApplicationMenu() {} }, shell: {}, net: {} };
  const filename = path.resolve(__dirname, '../src/main.cjs'), req = createRequire(filename), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\nmodule.exports={getStore:()=>store,getConnections:()=>connections};', {
    require: name => name === 'electron' ? electron : name === './mixed-remote.cjs' && RemoteClass ? { MixedRemote: RemoteClass } : name === './desktop-tools.cjs'
      ? { installDesktopTools: options => installDesktopTools({ ...options, adminLaunch: async () => { native.push('admin'); return { cancelled: true }; } }) } : req(name),
    module, __dirname: path.dirname(filename), process, Buffer, console, setTimeout, clearTimeout, AbortController, Response, URL
  });
  await new Promise(resolve => setImmediate(resolve));
  return { app, native, store: module.exports.getStore(), connections: module.exports.getConnections(), window, handlers,
    event: () => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame }) };
}

test('actual main IPC refuses new open/create resources at capacity and preserves an existing reconnect', async t => {
  const h = await fixture(t), calls = [], { MAX_OPEN_VIEWS } = require('../src/session-limits.cjs');
  const panes = Array.from({ length: MAX_OPEN_VIEWS + 1 }, (_, i) => ({ key: 'fixture/pane-' + i }));
  const remote = { connected: true, closing: false, profile: { id: 'fixture' },
    views: new Map(panes.slice(0, MAX_OPEN_VIEWS).map(p => [p.key, { active: true }])),
    pane: key => panes.find(p => p.key === key), open: key => { calls.push(['open', key]); return Promise.resolve(); },
    createSession: () => { calls.push(['create']); return Promise.resolve(); } };
  h.connections.set('fixture', { profile: remote.profile, remote });
  const open = h.handlers.get('nerdsshell:open'), create = h.handlers.get('nerdsshell:create');
  await assert.rejects(open(h.event(), 'fixture/pane-' + MAX_OPEN_VIEWS), /limit 64/);
  await assert.rejects(create(h.event(), 'fixture', 'Synthetic', true), /limit 64/);
  assert.deepEqual(calls, []);
  await open(h.event(), 'fixture/pane-0'); assert.deepEqual(calls, [['open', 'fixture/pane-0']]);
  const state = await h.handlers.get('nerdsshell:state')(h.event()); assert.equal(state.sessionLimits.maxOpenViews, MAX_OPEN_VIEWS);
});

test('oversized hostile discovery stops automatic reconnect and clears retry credentials in actual main', async t => {
  const { parsePanes } = require('../src/core.cjs'), { MAX_DISCOVERED_PANES } = require('../src/session-limits.cjs');
  class HostileDiscovery extends EventEmitter {
    constructor(profile) { super(); this.profile = profile; this.panes = []; }
    async connect() {
      this.connected = true;
      return parsePanes(('$0\tFixture\t@0\t0\tShell\t%0\t0\t120\t36\t0\t11111111-2222-4333-8444-555555555555\t1\tbash\n').repeat(MAX_DISCOVERED_PANES + 1));
    }
    disconnect() { this.connected = false; this.closing = true; }
  }
  const h = await fixture(t, HostileDiscovery);
  h.store.putProfile({ id: 'hostile', host: 'synthetic.invalid', username: 'tester', auth: 'agent', sessionMode: 'persistent' });
  await assert.rejects(h.handlers.get('nerdsshell:connect')(h.event(), 'hostile'), error => error.code === 'NERDSSHELL_RESOURCE_LIMIT');
  const runtime = h.connections.get('hostile');
  assert.equal(runtime.wanted, false); assert.equal(runtime.timer, undefined);
  assert.equal(runtime.state, 'disconnected'); assert.deepEqual(Object.keys(runtime.secrets), []);
});
test('all new UX IPC paths reject foreign senders, same-URL subframes and navigated main frames before I/O', async t => {
  const h = await fixture(t), cases = [
    ['publicLink', ['manual']], ['savePreferences', [{}]], ['sessionAttention', ['fixture/pane', {}]], ['activeSession', ['fixture/pane']],
    ['paneActionRun', ['fixture/pane', { target: 'synthetic', actionId: 'system.info', bracketedPaste: false }]],
    ['localAdminOpen', ['local:powershell']], ['scratchpadDirty', [true]], ['scratchpadRead', []], ['scratchpadSave', ['synthetic note']],
    ['actionConfiguration', []], ['actionConfigurationSave', [{ custom: [], favoritesByOS: {} }]], ['actionNewId', []],
    ['actionTemplates', ['Windows']], ['actionPreview', ['Windows', 'system.disk', '']], ['paneActions', ['fixture/pane']],
    ['localFilesList', ['fixture/pane', 'browser', '~']], ['localFilesChoose', ['fixture/pane', 'browser']],
    ['localFilesUpload', ['fixture/pane', 'browser', 'C:\\synthetic.txt', '/synthetic']],
    ['localFilesDownload', ['fixture/pane', 'browser', '/synthetic.txt']],
    ['workbenchContext', []], ['workbenchActions', ['local:powershell']], ['workbenchDetect', ['fixture']],
    ['workbenchTemplate', ['local:powershell', 'system.disk', '']], ['workbenchReview', ['local:powershell', { code: 'Write-Output SYNTHETIC' }]],
    ['workbenchRun', ['synthetic-token']], ['inputLock', ['fixture/pane', true]], ['workbenchDiagnostics', []]
  ];
  const before = JSON.stringify(h.store.data);
  for (const [name, args] of cases) {
    const invoke = h.handlers.get('nerdsshell:' + name); assert.equal(typeof invoke, 'function', name);
    await assert.rejects(invoke({ ...h.event(), sender: {} }, ...args), /Untrusted request/, name + ' foreign sender');
    await assert.rejects(invoke({ ...h.event(), senderFrame: { url: h.window.webContents.mainFrame.url } }, ...args), /Untrusted request/, name + ' subframe');
    h.window.webContents.mainFrame.url = 'https://untrusted.invalid/';
    try { await assert.rejects(invoke(h.event(), ...args), /Untrusted request/, name + ' navigation'); }
    finally { h.window.webContents.mainFrame.url = 'nerdsshell://app/ui/index.html'; }
    h.window.webContents.mainFrame.url = 'betterssh://app/ui/index.html';
    try { await assert.rejects(invoke(h.event(), ...args), /Untrusted request/, name + ' retired origin'); }
    finally { h.window.webContents.mainFrame.url = 'nerdsshell://app/ui/index.html'; }
    assert.equal(h.handlers.has('betterssh:' + name), false, name + ' retired IPC channel');
  }
  assert.deepEqual(h.native, []); assert.equal(JSON.stringify(h.store.data), before); assert.equal(h.app.nerdsshellScratchpadDirty, undefined);
  const diagnostic = await h.handlers.get('nerdsshell:workbenchDiagnostics')(h.event());
  assert.equal(diagnostic.connections.length, 0, 'The real application main frame retains its intended API');
});
test('UAC helper rejects hostile executable IDs and does not accept renderer command text', async () => {
  const calls = [], deps = { sourceFile: 'missing-helper', execute: (...args) => { calls.push(args); throw Error('Native execution is forbidden in this test'); } };
  for (const id of [null, {}, ['local:powershell'], 'local:powershell;malicious', 'C:\\malicious.exe']) {
    await assert.rejects(spawnElevatedPty(id, deps), /supported administrator shell/);
    assert.throws(() => bootstrap(path.resolve('fixture.cs'), 'a'.repeat(64), id), /Invalid administrator/);
  }
  assert.equal(calls.length, 0);
  const script = bootstrap(path.resolve('fixture.cs'), 'a'.repeat(64), 'local:powershell');
  assert.match(script, /::Broker\(/); assert.doesNotMatch(script, /Invoke-Expression|ExecutionPolicy|Credential|Write-Output/);
  assert.throws(() => bootstrap(path.resolve('fixture.cs'), "'; Write-Output UNREVIEWED #", 'local:powershell'), /Invalid administrator/);
});
