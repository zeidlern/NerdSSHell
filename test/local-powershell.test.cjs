'use strict';
// Phase 2: local consoles only. All processes/dialogs here are fakes; native acceptance is separate.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { LocalRemote, installedShells, launchArguments } = require('../src/local-remote.cjs');
const { installWorkbench } = require('../src/workbench.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const shell = { id: 'local:powershell', name: 'Windows PowerShell', executable: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' };
class Pty {
  constructor() { this.events = new EventEmitter(); this.writes = []; this.kills = 0; this.sizes = []; this.pauses = 0; this.resumes = 0; }
  onData(fn) { this.events.on('data', fn); return { dispose: () => this.events.off('data', fn) }; }
  onExit(fn) { this.events.on('exit', fn); return { dispose: () => this.events.off('exit', fn) }; }
  write(s) { this.writes.push(s); }
  resize(cols, rows) { this.sizes.push([cols, rows]); }
  pause() { this.pauses++; }
  resume() { this.resumes++; }
  kill() { this.kills++; }
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'betterssh-local-phase2-'));
  const handlers = {}, connections = new Map(), spawns = [], terminals = [], events = [], dialogs = [];
  let shells = [shell], dialogResult = { canceled: true }, saves = 0;
  const store = { data: {}, save() { saves++; } };
  const workbench = installWorkbench({
    handle: (name, fn) => { handlers[name] = fn; }, connections, getStore: () => store,
    app: { isPackaged: false, getVersion: () => 'fixture' }, getWindow: () => ({}),
    dialog: { showOpenDialog: async (_w, options) => { dialogs.push(options); return typeof dialogResult === 'function' ? dialogResult() : dialogResult; }, showMessageBox: async () => ({ response: 0 }) },
    emit: (type, data) => events.push({ type, ...data }), queueOutput() {}, discardOutput() {}, output: { flush() {} },
    forKey: key => connections.get(key.split('/')[0]), shellProvider: () => shells,
    localFactory: (selected, options) => new LocalRemote(selected, { ...options, home: root, spawn: (...args) => { spawns.push(args); const p = new Pty(); terminals.push(p); return p; } })
  });
  t.after(() => { for (const r of connections.values()) r.remote.disconnect(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, handlers, connections, spawns, terminals, events, dialogs, store, workbench,
    setDialog(result) { dialogResult = result; }, setShells(value) { shells = value; }, saves: () => saves };
}
async function open(h, folder = false) {
  const result = await h.handlers.localOpen(shell.id, folder);
  if (result) await h.connections.get(shell.id).remote.open(result.pane.key);
  return result;
}

test('discovery returns only installed fixed-path shell choices, without PATH lookup', () => {
  const attempted = [];
  const result = installedShells({ platform: 'win32', env: { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files', PATH: 'C:\\untrusted' }, exists: p => { attempted.push(p); return p === shell.executable; } });
  assert.deepEqual(result, [{ ...shell, family: 'powershell' }]);
  assert.equal(attempted.length, 3); assert.ok(attempted.every(p => !p.includes('untrusted')));
  assert.deepEqual(installedShells({ platform: 'win32', env: {}, exists: () => false }), []);
});
test('ordinary local opening uses the selected executable, home and no elevation/policy flags', async t => {
  const h = fixture(t), result = await open(h);
  assert.equal(result.pane.local, true); assert.equal(result.profile.sessionMode, 'standard');
  assert.equal(result.profile.record, false); assert.match(result.profile.name, /This PC.*Windows PowerShell/);
  assert.equal(h.spawns[0][0], shell.executable);
  assert.deepEqual(h.spawns[0][1], launchArguments());
  assert.equal(h.spawns[0][2].cwd, h.root);
  assert.equal(h.spawns[0][2].useConpty, true); assert.equal(h.spawns[0][2].useConptyDll, true);
  assert.deepEqual(launchArguments().slice(0, 4), ['-NoLogo', '-NoProfile', '-NoExit', '-EncodedCommand']);
  assert.equal(h.saves(), 0); assert.equal(h.store.data.profiles, undefined);
});
test('cancelled folder picker starts no process and creates no local connection', async t => {
  const h = fixture(t); assert.equal(await open(h, true), null);
  assert.equal(h.spawns.length, 0); assert.equal(h.connections.size, 0);
  assert.deepEqual(h.dialogs[0].properties, ['openDirectory']);
});

test('local consoles have numbered names without reusing a closed console name', async t => {
  const h = fixture(t);
  assert.equal(await open(h, true), null);
  const first = await open(h), second = await open(h);
  assert.equal(first.pane.sessionName, 'PowerShell 1');
  assert.equal(second.pane.sessionName, 'PowerShell 2');
  h.connections.get(shell.id).remote.closeView(first.pane.key);
  assert.equal((await open(h)).pane.sessionName, 'PowerShell 3');
});

test('concurrent local console launches reserve distinct numbered names', async t => {
  const h = fixture(t), results = await Promise.all([open(h), open(h), open(h)]);
  assert.deepEqual(results.map(r => r.pane.sessionName).sort(), ['PowerShell 1', 'PowerShell 2', 'PowerShell 3']);
  assert.equal(new Set(results.map(r => r.pane.key)).size, 3);
});

test('embedded administrator startup validates its captured review after UAC before sending text', async t => {
  const pty = new Pty(); pty.readyForInput = async () => {};
  let resolve, valid = true;
  const remote = new LocalRemote({ ...shell, id: shell.id + '-admin', baseId: shell.id, administrator: true }, { elevatedSpawn: () => new Promise(r => { resolve = r; }), home: os.homedir() });
  t.after(() => remote.disconnect()); await remote.connect();
  const pending = remote.createTask('Reviewed admin task', "Write-Output 'DO_NOT_RUN'", { validate() { if (!valid) throw new Error('Captured review changed'); } });
  const observed = assert.rejects(pending, /Captured review changed/);
  valid = false; resolve(pty); await observed;
  assert.deepEqual(pty.writes, []); assert.equal(pty.kills, 1); assert.equal(remote.activeShellCount(), 0);
});

test('closing the app during UAC discards startup text and cleans the returned administrator PTY', async t => {
  const pty = new Pty(); pty.readyForInput = async () => {};
  let resolve;
  const remote = new LocalRemote({ ...shell, id: shell.id + '-admin', baseId: shell.id, administrator: true }, { elevatedSpawn: () => new Promise(r => { resolve = r; }), home: os.homedir() });
  t.after(() => remote.disconnect()); await remote.connect();
  const pending = remote.createTask('Cancelled admin task', "Write-Output 'DO_NOT_RUN'");
  const observed = assert.rejects(pending, /closed/); remote.disconnect(); await observed;
  resolve(pty); await tick(); await tick();
  assert.deepEqual(pty.writes, []); assert.equal(pty.kills, 1);
});

test('ending only the opening administrator console during UAC discards its startup command', async t => {
  const pty = new Pty(); pty.readyForInput = async () => {};
  let resolve;
  const remote = new LocalRemote({ ...shell, id: shell.id + '-admin', baseId: shell.id, administrator: true }, { elevatedSpawn: () => new Promise(r => { resolve = r; }), home: os.homedir() });
  t.after(() => remote.disconnect()); await remote.connect();
  const pending = remote.createTask('Opening admin task', "Write-Output 'DO_NOT_RUN'");
  const observed = assert.rejects(pending, /closed/);
  remote.closeView([...remote.shells.keys()][0]); await observed;
  resolve(pty); await tick(); await tick();
  assert.deepEqual(pty.writes, []); assert.equal(pty.kills, 1); assert.equal(remote.connected, true);
});

test('concurrent administrator launches retain separate review validators and command bodies', async t => {
  const waits = [], ptys = [new Pty(), new Pty()]; ptys.forEach(p => { p.readyForInput = async () => {}; });
  const remote = new LocalRemote({ ...shell, id: shell.id + '-admin', baseId: shell.id, administrator: true }, { elevatedSpawn: () => new Promise(r => waits.push(r)), home: os.homedir() });
  t.after(() => remote.disconnect()); await remote.connect();
  const rejected = remote.createTask('Stale', "Write-Output 'STALE'", { validate() { throw new Error('Stale source'); } });
  const observed = assert.rejects(rejected, /Stale source/);
  const accepted = remote.createTask('Current', "Write-Output 'CURRENT'", { validate() {} });
  waits[1](ptys[1]); const pane = await accepted; waits[0](ptys[0]); await observed;
  assert.deepEqual(ptys[0].writes, []); assert.deepEqual(ptys[1].writes, ["Write-Output 'CURRENT'\r"]);
  assert.equal(pane.administrator, true); assert.equal(remote.activeShellCount(), 1);
});
test('picked folder with spaces, apostrophe and Unicode is passed as cwd, never shell syntax', async t => {
  const h = fixture(t), folder = path.join(h.root, "Folder's & 日本語"); fs.mkdirSync(folder);
  h.setDialog({ canceled: false, filePaths: [folder] }); await open(h, true); await open(h);
  assert.equal(h.spawns[0][2].cwd, folder); assert.equal(h.spawns[1][2].cwd, h.root);
  assert.deepEqual(h.spawns[0][1], launchArguments());
  assert.equal(h.connections.get(shell.id).remote.home, h.root); assert.equal(h.saves(), 0);
});
test('concurrent launches keep their picked folders independent', async t => {
  const h = fixture(t), folders = ['one', 'two'].map(n => path.join(h.root, n)); folders.forEach(p => fs.mkdirSync(p));
  let index = 0; h.setDialog(() => ({ canceled: false, filePaths: [folders[index++]] }));
  const results = await Promise.all([open(h, true), open(h, true)]);
  const remote = h.connections.get(shell.id).remote;
  // First-use connection setup may reorder completion; verify folder ownership, not scheduling.
  results.forEach((result, i) => { const pty = remote.shells.get(result.pane.key).stream.pty; assert.equal(h.spawns[h.terminals.indexOf(pty)][2].cwd, folders[i]); });
  assert.equal(remote.home, h.root);
});
test('a shell removed while the folder dialog is open is not launched', async t => {
  const h = fixture(t); let resolve;
  h.setDialog(() => new Promise(r => { resolve = r; }));
  const pending = open(h, true); h.setShells([]); resolve({ canceled: false, filePaths: [h.root] });
  await assert.rejects(pending, /not available/); assert.equal(h.spawns.length, 0);
});
test('a nonexistent folder cannot silently fall back to the home directory', async t => {
  const h = fixture(t); h.setDialog({ canceled: false, filePaths: [path.join(h.root, 'missing')] });
  await assert.rejects(open(h, true)); assert.equal(h.spawns.length, 0);
});
test('local opening rejects remote targets and invalid picker choices', async t => {
  const h = fixture(t); await assert.rejects(h.handlers.localOpen('remote-missing'), /Connect/);
  await assert.rejects(h.handlers.localOpen(shell.id, 'true'), /Invalid folder choice/);
  assert.equal(h.spawns.length, 0);
});
test('maximum-size mixed Unicode paste stays exact and finishes before Enter', async t => {
  const h = fixture(t), result = await open(h), r = h.connections.get(shell.id).remote;
  const text = 'a'.repeat(65529) + '漢😀'; assert.equal(Buffer.byteLength(text), 65536);
  await Promise.all([r.input(result.pane.key, text), r.input(result.pane.key, '\r')]);
  assert.deepEqual(h.terminals[0].writes, [text, '\r']);
});
test('resize and Ctrl+C are delivered only to the owning local console', async t => {
  const h = fixture(t), first = await open(h), second = await open(h), r = h.connections.get(shell.id).remote;
  await r.resize(first.pane.key, 91, 31); await r.input(first.pane.key, '\x03');
  assert.deepEqual(h.terminals[0].sizes, [[91, 31]]); assert.deepEqual(h.terminals[0].writes, ['\x03']);
  assert.deepEqual(h.terminals[1].sizes, []); assert.deepEqual(h.terminals[1].writes, []);
  assert.equal(r.activeShellCount(), 2); assert.notEqual(first.pane.key, second.pane.key);
});
test('closing before deferred input runs discards the entire pending submission', async t => {
  const h = fixture(t), result = await open(h), r = h.connections.get(shell.id).remote;
  const pending = r.input(result.pane.key, 'DO_NOT_SEND\r'); r.closeView(result.pane.key);
  await assert.rejects(pending, /discarded|connected|closed/i); assert.deepEqual(h.terminals[0].writes, []);
  assert.equal(h.terminals[0].kills, 1);
});
test('natural local exit drains final output, removes listeners and does not kill a sibling', async t => {
  const h = fixture(t), first = await open(h); await open(h); const r = h.connections.get(shell.id).remote, received = [];
  r.on('output', (key, bytes) => received.push([key, bytes.toString()]));
  h.terminals[0].events.emit('data', 'LAST_LOCAL_LINE\r\n'); h.terminals[0].events.emit('exit', { exitCode: 0 });
  await tick(); await tick();
  assert.deepEqual(received, [[first.pane.key, 'LAST_LOCAL_LINE\r\n']]);
  assert.equal(h.terminals[0].kills, 0); assert.equal(h.terminals[1].kills, 0);
  assert.equal(h.terminals[0].events.listenerCount('data'), 0); assert.equal(h.terminals[0].events.listenerCount('exit'), 0);
  await assert.rejects(r.open(first.pane.key), /ended/); assert.equal(r.activeShellCount(), 1);
});
test('local console count is bounded and a new console after closure gets a new identity', async t => {
  const h = fixture(t), first = await open(h), r = h.connections.get(shell.id).remote;
  for (let i = 1; i < 16; i++) await open(h);
  await assert.rejects(open(h), /limit 16/); assert.equal(h.spawns.length, 16);
  r.closeView(first.pane.key); const replacement = await open(h);
  assert.notEqual(replacement.pane.key, first.pane.key); assert.equal(r.activeShellCount(), 16);
});
test('local consoles refuse SFTP and never become saved remote profiles', async t => {
  const h = fixture(t), result = await open(h), r = h.connections.get(shell.id).remote;
  await assert.rejects(r.sftp(), /Explorer/);
  assert.equal(h.handlers.workbenchContext().targets.filter(x => x.id === shell.id).length, 1);
  assert.equal(result.profile.local, true); assert.equal(h.saves(), 0);
});

function mainHarness() {
  const vm = require('node:vm'), { createRequire } = require('node:module');
  const handlers = new Map(), messages = [], app = new EventEmitter(); let response = 1, quits = 0;
  Object.assign(app, { requestSingleInstanceLock: () => true, whenReady: () => new Promise(() => {}), quit() { quits++; }, getPath: () => os.tmpdir(), getVersion: () => 'fixture' });
  const frame = { url: 'betterssh://app/ui/index.html' }, webContents = { mainFrame: frame, send() {} }, window = { webContents, isDestroyed: () => false };
  const electron = { app, BrowserWindow() {}, ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    protocol: { registerSchemesAsPrivileged() {} }, dialog: { showMessageBox: async (_w, options) => { messages.push(options); return { response }; } }, clipboard: {}, Menu: {}, shell: {}, net: {} };
  const filename = path.resolve(__dirname, '../src/main.cjs'), req = createRequire(filename), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\nmodule.exports={setup(s,w){store=s;window=w;registerIPC();},connections};', {
    require: name => name === 'electron' ? electron : req(name), module, __dirname: path.dirname(filename),
    process, Buffer, console, setTimeout, clearTimeout, AbortController, Response, URL
  });
  module.exports.setup({ data: { profiles: [], pins: {} }, save() {} }, window);
  return { main: module.exports, messages, app, respond(v) { response = v; }, quits: () => quits,
    invoke: (name, ...args) => handlers.get('betterssh:' + name)({ sender: webContents, senderFrame: frame }, ...args) };
}
test('actual main IPC asks before closing a live LOCAL console; Cancel preserves it', async t => {
  const h = fixture(t), result = await open(h), main = mainHarness(), runtime = h.connections.get(shell.id);
  main.main.connections.set(shell.id, runtime);
  assert.equal(await main.invoke('close', result.pane.key), false);
  assert.equal(runtime.remote.activeShellCount(), 1); assert.equal(h.terminals[0].kills, 0);
  assert.equal(main.messages[0].title, 'End local session?'); assert.equal(main.messages[0].defaultId, 1); assert.equal(main.messages[0].buttons.at(-1), 'Cancel');
  main.respond(0); assert.equal(await main.invoke('close', result.pane.key), true);
  assert.equal(h.terminals[0].kills, 1); assert.equal(runtime.remote.activeShellCount(), 0);
});
test('actual main quit and disconnect confirmation include local consoles', async t => {
  const h = fixture(t); await open(h); const main = mainHarness(), runtime = h.connections.get(shell.id);
  main.main.connections.set(shell.id, runtime);
  assert.equal(await main.invoke('disconnect', shell.id), false); assert.equal(h.terminals[0].kills, 0);
  main.app.emit('before-quit', { preventDefault() {} }); await tick();
  assert.equal(main.quits(), 0); assert.equal(runtime.remote.connected, true);
  main.respond(0); main.app.emit('before-quit', { preventDefault() {} }); await tick(); await tick();
  assert.equal(main.quits(), 1); assert.equal(runtime.remote.connected, false); assert.equal(h.terminals[0].kills, 1);
});
