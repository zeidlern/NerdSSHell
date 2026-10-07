'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const { installDesktopTools } = require('../src/desktop-tools.cjs');
const { spawnElevatedPty, bootstrap } = require('../src/elevated-pty.cjs');
async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'betterssh-ux-security-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const handlers = new Map(), native = [], app = new EventEmitter(); let window;
  Object.assign(app, { isPackaged: true, requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(),
    getPath: () => directory, getVersion: () => 'synthetic', quit() {}, exit() {} });
  class Window extends EventEmitter {
    constructor() { super(); window = this; this.webContents = new EventEmitter();
      this.webContents.mainFrame = { url: 'betterssh://app/ui/index.html' }; this.webContents.send = () => {};
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
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\nmodule.exports={getStore:()=>store};', {
    require: name => name === 'electron' ? electron : name === './desktop-tools.cjs'
      ? { installDesktopTools: options => installDesktopTools({ ...options, adminLaunch: async () => { native.push('admin'); return { cancelled: true }; } }) } : req(name),
    module, __dirname: path.dirname(filename), process, Buffer, console, setTimeout, clearTimeout, AbortController, Response, URL
  });
  await new Promise(resolve => setImmediate(resolve));
  return { app, native, store: module.exports.getStore(), window, handlers,
    event: () => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame }) };
}
test('all new UX IPC paths reject foreign senders, same-URL subframes and navigated main frames before I/O', async t => {
  const h = await fixture(t), cases = [
    ['savePreferences', [{}]], ['sessionAttention', ['fixture/pane', {}]], ['activeSession', ['fixture/pane']],
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
    const invoke = h.handlers.get('betterssh:' + name); assert.equal(typeof invoke, 'function', name);
    await assert.rejects(invoke({ ...h.event(), sender: {} }, ...args), /Untrusted request/, name + ' foreign sender');
    await assert.rejects(invoke({ ...h.event(), senderFrame: { url: h.window.webContents.mainFrame.url } }, ...args), /Untrusted request/, name + ' subframe');
    h.window.webContents.mainFrame.url = 'https://untrusted.invalid/';
    try { await assert.rejects(invoke(h.event(), ...args), /Untrusted request/, name + ' navigation'); }
    finally { h.window.webContents.mainFrame.url = 'betterssh://app/ui/index.html'; }
  }
  assert.deepEqual(h.native, []); assert.equal(JSON.stringify(h.store.data), before); assert.equal(h.app.bettersshScratchpadDirty, undefined);
  const diagnostic = await h.handlers.get('betterssh:workbenchDiagnostics')(h.event());
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
