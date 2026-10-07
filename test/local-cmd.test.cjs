'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { EventEmitter } = require('node:events');
const { LocalRemote, installedShells, shellFamily, launchArguments, cmdPromptReady, waitForCmdInput } = require('../src/local-remote.cjs');
const { installWorkbench } = require('../src/workbench.cjs');
const { consoleText } = require('../src/console-text.cjs');
const shell = { id: 'local:cmd', name: 'Command Prompt', family: 'cmd', executable: 'C:\\Windows\\System32\\cmd.exe' };
const tick = () => new Promise(resolve => setImmediate(resolve));
class Pty {
  constructor() { this.events = new EventEmitter(); this.writes = []; this.kills = 0; this.sizes = []; }
  onData(fn) { this.events.on('data', fn); return { dispose: () => this.events.off('data', fn) }; }
  onExit(fn) { this.events.on('exit', fn); return { dispose: () => this.events.off('exit', fn) }; }
  write(text) { this.writes.push(text); }
  resize(cols, rows) { this.sizes.push([cols, rows]); }
  pause() {}
  resume() {}
  kill() { this.kills++; }
}
function dllPty(ready = true) {
  const pty = new Pty(); pty._isReady = ready; pty._deferreds = []; pty.publicKills = 0;
  const input = { destroyed: false, destroy() { this.destroyed = true; } };
  const output = { destroyed: false, destroy() { this.destroyed = true; } }, worker = new EventEmitter(); worker.threadId = 1;
  const connection = { _worker: worker, disposals: 0, dispose() { this.disposals++; } };
  pty._agent = { _useConptyDll: true, _inSocket: input, _outSocket: output, _conoutSocketWorker: connection,
    kill() { pty.kills++; input.destroy(); } };
  pty._close = () => { pty.closed = true; };
  pty.kill = () => { pty.publicKills++; if (!pty._isReady) pty._deferreds.push({ run: () => pty._agent.kill() }); else pty._agent.kill(); };
  return pty;
}
async function fixture(t, options = {}) {
  const ptys = [], spawns = [], r = new LocalRemote(options.shell || shell, {
    home: os.homedir(), spawn: (...args) => { spawns.push(args); const p = new Pty(); ptys.push(p); return p; }, ...options
  });
  t.after(() => r.disconnect()); await r.connect();
  return { r, ptys, spawns };
}
async function open(h, name = 'Command Prompt 1') { const pane = await h.r.create(name); await h.r.open(pane.key); return pane; }

test('Command Prompt resolves only the Windows system executable and ignores COMSPEC and PATH', () => {
  const probes = [], result = installedShells({ platform: 'win32', env: { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files', COMSPEC: 'C:\\untrusted\\cmd.exe', PATH: 'C:\\untrusted' }, exists: candidate => { probes.push(candidate); return candidate === shell.executable; } });
  assert.deepEqual(result, [shell]);
  assert.equal(probes.length, 3); assert.ok(probes.every(candidate => !candidate.includes('untrusted')));
  assert.deepEqual(installedShells({ platform: 'linux', exists: () => { throw Error('Must not probe'); } }), []);
});

test('local shell family and administrator identity cannot be chosen from display names or arbitrary IDs', () => {
  assert.equal(shellFamily('local:cmd'), 'cmd'); assert.equal(shellFamily('local:pwsh'), 'powershell');
  for (const id of ['', null, {}, 'local:cmd /k evil', 'cmd.exe', 'local:cmd-admin', 'remote']) assert.throws(() => shellFamily(id), /supported local shell/);
  for (const value of [{ ...shell, id: 'local:cmd-admin' }, { ...shell, administrator: true }, { ...shell, baseId: 'local:pwsh' }]) assert.throws(() => new LocalRemote(value), /identity|supported local shell/);
  const r = new LocalRemote({ ...shell, family: 'powershell' });
  assert.equal(r.profile.shellFamily, 'cmd'); assert.equal(r.shell.family, 'cmd'); r.disconnect();
});

test('CMD uses fixed AutoRun-disabled arguments with no reviewed text or PowerShell bootstrap', () => {
  for (const command of [undefined, 'echo "literal & quoted"', 'set "VALUE=one"\necho %VALUE%', 'echo C:\\Folder With Spaces\\']) assert.deepEqual(launchArguments(command, 'local:cmd'), ['/d']);
  assert.deepEqual(launchArguments(undefined, 'local:pwsh').slice(0, 4), ['-NoLogo', '-NoProfile', '-NoExit', '-EncodedCommand']);
  assert.throws(() => launchArguments('x'.repeat(8193), 'local:cmd'), /8 KiB/);
  assert.throws(() => launchArguments('x'.repeat(8192), 'local:cmd'), /8,191/);
  assert.throws(() => launchArguments('echo \x1b[31m', 'local:cmd'), /terminal controls/);
});

test('first CMD panes and snapshots carry local shell metadata and retain it after rename/discovery', async t => {
  const h = await fixture(t), emitted = [], snapshots = [];
  h.r.on('panes', list => emitted.push(JSON.parse(JSON.stringify(list))));
  h.r.on('snapshot', (_key, snapshot) => snapshots.push(snapshot));
  const pane = await open(h), first = emitted.find(list => list.length)[0];
  for (const value of [first, snapshots[0], pane, h.r.profile]) {
    assert.equal(value.local, true); assert.equal(value.sessionType, 'local'); assert.equal(value.persistent, false);
    assert.equal(value.shellId, 'local:cmd'); assert.equal(value.shellFamily, 'cmd'); assert.equal(value.administrator, false);
  }
  assert.equal(first.command, 'Command Prompt'); assert.equal(first.standard, true, 'Legacy flag preserves shared nonpersistent lifetime');
  const token = pane.sessionToken; await h.r.rename(pane.key, 'Release tools'); await h.r.discover();
  assert.equal(pane.sessionToken, token); assert.equal(pane.sessionName, 'Release tools'); assert.equal(emitted.at(-1)[0].sessionType, 'local');
});

test('ordinary CMD folder is native cwd data and default prompt is process-local', async t => {
  const directory = path.join(os.tmpdir(), 'Folder %VALUE% ! & 日本語'), prior = process.env.PROMPT;
  const h = await fixture(t, { home: directory }); await open(h);
  assert.equal(h.spawns[0][0], shell.executable); assert.deepEqual(h.spawns[0][1], ['/d']);
  assert.equal(h.spawns[0][2].cwd, directory); assert.equal(h.spawns[0][2].env.PROMPT, '$P$G');
  assert.equal(h.spawns[0][2].useConpty, true); assert.equal(h.spawns[0][2].useConptyDll, true);
  assert.equal(process.env.PROMPT, prior); assert.equal(h.r.profile.record, false);
});

test('CMD discovery never launches a console or resumes an ended process', async t => {
  const h = await fixture(t); await h.r.discover(); assert.equal(h.spawns.length, 0);
  const pane = await open(h); await h.r.connect(); await h.r.discover(); assert.equal(h.spawns.length, 1);
  h.r.closeView(pane.key); await h.r.discover(); await assert.rejects(h.r.open(pane.key), /ended/);
  assert.equal(h.spawns.length, 1); h.r.disconnect(); await assert.rejects(h.r.connect(), /closed/);
});

test('CMD Unicode, Enter, Ctrl+C and resize stay ordered on the owning console', async t => {
  const h = await fixture(t), first = await open(h), second = await open(h, 'Command Prompt 2');
  await Promise.all([h.r.input(first.key, 'echo 漢字😀'), h.r.input(first.key, '\r')]);
  await h.r.input(first.key, '\x03'); await h.r.resize(first.key, 92, 28);
  assert.deepEqual(h.ptys[0].writes, ['echo 漢字😀', '\r', '\x03']); assert.deepEqual(h.ptys[0].sizes, [[92, 28]]);
  assert.deepEqual(h.ptys[1].writes, []); assert.deepEqual(h.ptys[1].sizes, []);
  const pending = h.r.input(first.key, 'DO_NOT_REPLAY\r'); h.r.closeView(first.key);
  await assert.rejects(pending, /discarded|connected|closed/); assert.equal(h.ptys[0].kills, 1); assert.equal(h.ptys[1].kills, 0);
  await h.r.input(second.key, 'dir\r'); assert.deepEqual(h.ptys[1].writes, ['dir\r']);
});

test('natural CMD exit drains output, cleans listeners and leaves a sibling running', async t => {
  const h = await fixture(t), first = await open(h); await open(h, 'Command Prompt 2'); const seen = [];
  h.r.on('output', (key, bytes) => seen.push([key, bytes.toString()]));
  h.ptys[0].events.emit('data', 'CMD_FINAL_😀\r\n'); h.ptys[0].events.emit('exit', { exitCode: 0 }); await tick(); await tick();
  assert.deepEqual(seen, [[first.key, 'CMD_FINAL_😀\r\n']]); assert.equal(h.ptys[0].kills, 0); assert.equal(h.ptys[1].kills, 0);
  assert.equal(h.ptys[0].events.listenerCount('data'), 0); assert.equal(h.ptys[0].events.listenerCount('exit'), 0);
  assert.equal(h.r.activeShellCount(), 1); await assert.rejects(h.r.sftp(), /SFTP belongs to remote/);
});

test('DLL natural exit drains a paused final output before disposing only its owned worker and input', async t => {
  const ptys = [], h = await fixture(t, { spawn: () => { const p = dllPty(); ptys.push(p); return p; } });
  const first = await open(h), second = await open(h, 'Command Prompt 2'), seen = [];
  h.r.on('output', (key, bytes) => seen.push([key, bytes.toString()])); h.r.setOutputPaused(first.key, true);
  const tail = 'x'.repeat(65536) + '\r\nCMD_FINAL_😀\r\n';
  ptys[0].events.emit('data', tail); ptys[0].events.emit('exit', { exitCode: 7 }); await tick();
  assert.deepEqual(seen, []); assert.equal(h.r.activeShellCount(), 2);
  assert.equal(ptys[0]._agent._conoutSocketWorker.disposals, 0); assert.equal(ptys[0]._agent._inSocket.destroyed, false);
  h.r.setOutputPaused(first.key, false); await tick(); await tick();
  assert.deepEqual(seen, [[first.key, tail]]); assert.equal(ptys[0].kills, 0);
  assert.equal(ptys[0]._agent._conoutSocketWorker.disposals, 1); assert.equal(ptys[0]._agent._inSocket.destroyed, true);
  assert.equal(ptys[1]._agent._conoutSocketWorker.disposals, 0); assert.equal(ptys[1]._agent._inSocket.destroyed, false);
  assert.equal(h.r.activeShellCount(), 1); await h.r.input(second.key, 'echo SIBLING\r');
  assert.deepEqual(ptys[1].writes, ['echo SIBLING\r']); h.r.closeView(first.key);
  assert.equal(ptys[0]._agent._conoutSocketWorker.disposals, 1);
});

test('DLL quiet explicit close releases its transport once without waiting for later output or touching a sibling', async t => {
  const ptys = [], h = await fixture(t, { spawn: () => { const p = dllPty(); ptys.push(p); return p; } });
  const first = await open(h); await open(h, 'Command Prompt 2');
  h.r.closeView(first.key); h.r.closeView(first.key); await tick();
  assert.equal(ptys[0].kills, 1); assert.equal(ptys[0]._agent._inSocket.destroyed, true);
  assert.equal(ptys[0]._agent._conoutSocketWorker.disposals, 1);
  assert.equal(ptys[1].kills, 0); assert.equal(ptys[1]._agent._inSocket.destroyed, false);
  assert.equal(ptys[1]._agent._conoutSocketWorker.disposals, 0);
});

test('DLL close before first output terminates its owned native agent and discards deferred operations', async t => {
  const p = dllPty(false), h = await fixture(t, { spawn: () => p }), pane = await open(h);
  p._deferreds.push({ run() { throw Error('Cancelled startup operation must not run'); } });
  h.r.closeView(pane.key); await tick();
  assert.equal(p.publicKills, 0, 'The public kill would defer forever without first output');
  assert.equal(p.kills, 1); assert.equal(p.closed, true); assert.deepEqual(p._deferreds, []);
  assert.equal(p._agent._inSocket.destroyed, true); assert.equal(p._agent._conoutSocketWorker.disposals, 1);
  assert.equal(p._agent._outSocket.destroyed, false, 'Keep the worker drain grace before releasing its output socket');
  const worker = p._agent._conoutSocketWorker._worker; worker.threadId = -1; worker.emit('exit');
  assert.equal(p._agent._outSocket.destroyed, true, 'An unconnected output socket also gets explicitly released');
  p.events.emit('data', 'C:\\Fixture>'); assert.equal(p.kills, 1);
});

test('DLL early-close worker completion destroys the captured output socket and leaves sibling transports intact', async t => {
  const ptys = [dllPty(false), dllPty()], h = await fixture(t, { spawn: () => ptys.shift() });
  const firstPty = ptys[0], siblingPty = ptys[1], first = await open(h); await open(h, 'Command Prompt 2');
  const output = firstPty._agent._outSocket, worker = firstPty._agent._conoutSocketWorker._worker;
  firstPty._agent._outSocket = siblingPty._agent._outSocket;
  h.r.closeView(first.key); await tick();
  assert.equal(output.destroyed, false); assert.equal(siblingPty._agent._outSocket.destroyed, false);
  worker.threadId = -1; worker.emit('exit');
  assert.equal(output.destroyed, true); assert.equal(worker.listenerCount('exit'), 0);
  assert.equal(siblingPty._agent._outSocket.destroyed, false); assert.equal(siblingPty._agent._inSocket.destroyed, false);
  assert.equal(siblingPty._agent._conoutSocketWorker.disposals, 0); assert.equal(siblingPty.kills, 0);
});

test('DLL-specific cleanup leaves system ConPTY and other transports to their public lifecycle', async t => {
  for (const useDll of [false, undefined]) {
    const p = dllPty(); p._agent._useConptyDll = useDll;
    const h = await fixture(t, { spawn: () => p }), pane = await open(h); h.r.closeView(pane.key); await tick();
    assert.equal(p.publicKills, 1); assert.equal(p.kills, 1); assert.equal(p._agent._conoutSocketWorker.disposals, 0);
  }
});

test('reviewed CMD text waits for its own fragmented prompt, is not argv, and retains multiline input', async t => {
  const h = await fixture(t), seen = []; let checks = 0;
  const command = 'set "VALUE=one & two"\r\necho "%VALUE%"\nfor %i in (1 2) do @echo %i';
  const pending = h.r.createTask('Reviewed CMD', command, { validate() { checks++; } });
  assert.equal(h.spawns.length, 1); assert.deepEqual(h.spawns[0][1], ['/d']); assert.deepEqual(h.ptys[0].writes, []);
  h.ptys[0].events.emit('data', 'Windows\r\n\x1b[32mC:\\Fix'); assert.deepEqual(h.ptys[0].writes, []);
  h.ptys[0].events.emit('data', 'ture>\x1b[0m'); const pane = await pending;
  assert.deepEqual(h.ptys[0].writes, ['set "VALUE=one & two"\recho "%VALUE%"\rfor %i in (1 2) do @echo %i\r']);
  assert.equal(checks, 2); assert.equal(h.ptys[0].events.listenerCount('data'), 1, 'Only channel listener remains');
  h.r.on('output', (_key, bytes) => seen.push(bytes.toString())); await h.r.open(pane.key); await tick();
  assert.equal(seen.join(''), 'Windows\r\n\x1b[32mC:\\Fixture>\x1b[0m');
});

test('closing a pending CMD task discards startup text even when the prompt later arrives', async t => {
  const h = await fixture(t), pending = h.r.createTask('Closed CMD', 'echo DO_NOT_RUN');
  const rejection = assert.rejects(pending, /closed/); h.r.closeView([...h.r.shells.keys()][0]); await rejection; await tick();
  assert.equal(h.ptys[0].kills, 1, 'Cancellation immediately closes the owned pending PTY, without waiting for a prompt');
  assert.equal(h.ptys[0].events.listenerCount('data'), 0); assert.equal(h.ptys[0].events.listenerCount('exit'), 0);
  h.ptys[0].events.emit('data', 'C:\\Fixture>'); await tick();
  assert.deepEqual(h.ptys[0].writes, []); assert.equal(h.ptys[0].kills, 1); assert.equal(h.r.activeShellCount(), 0);
});

test('ending a sibling does not cancel a different CMD task waiting for its prompt', async t => {
  const h = await fixture(t), first = await open(h), pending = h.r.createTask('Independent CMD', 'echo CURRENT');
  h.r.closeView(first.key); await tick(); assert.equal(h.ptys[1].kills, 0); assert.deepEqual(h.ptys[1].writes, []);
  h.ptys[1].events.emit('data', 'C:\\Fixture>'); const pane = await pending;
  assert.deepEqual(h.ptys[1].writes, ['echo CURRENT\r']); assert.equal(pane.local, true); assert.equal(h.r.activeShellCount(), 1);
});

test('a review that becomes stale during CMD readiness closes only its new console', async t => {
  const h = await fixture(t), existing = await open(h); let valid = true;
  const pending = h.r.createTask('Stale CMD', 'echo DO_NOT_RUN', { validate() { if (!valid) throw Error('Stale command review'); } });
  const rejected = assert.rejects(pending, /Stale command review/); valid = false; h.ptys[1].events.emit('data', 'C:\\Fixture>'); await rejected;
  assert.deepEqual(h.ptys[1].writes, []); assert.equal(h.ptys[1].kills, 1); assert.equal(h.ptys[0].kills, 0);
  assert.equal((await h.r.open(existing.key)).sessionToken, existing.sessionToken);
});

test('CMD readiness timeout and early exit dispose observers without submitting input', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const p = new Pty(), pending = waitForCmdInput(p, 100); const rejected = assert.rejects(pending, /No startup command was sent/);
  p.events.emit('data', 'Unfinished prompt'); t.mock.timers.tick(100); await rejected;
  assert.equal(p.events.listenerCount('data'), 0); assert.equal(p.events.listenerCount('exit'), 0); assert.deepEqual(p.writes, []);
  const early = waitForCmdInput(p, 100); const ended = assert.rejects(early, /ended before startup/); p.events.emit('exit', {}); await ended;
  assert.equal(p.events.listenerCount('data'), 0); assert.equal(p.events.listenerCount('exit'), 0);
  assert.equal(cmdPromptReady('C:\\Fixture>'), true); assert.equal(cmdPromptReady('PS C:\\Fixture> '), false);
});

test('console text preserves visible markers and prompts between separate ST and BEL OSC titles', () => {
  const visible = '\r\nCMD_VALUE_one\r\nC:\\Fixture>';
  for (const first of ['\x1b\\', '\x07']) for (const last of ['\x1b\\', '\x07']) {
    const raw = '\x1b]0;first title' + first + visible + '\x1b]0;last title' + last + '\x1b[0m';
    assert.equal(consoleText(raw), visible); assert.equal(cmdPromptReady(raw), true);
  }
});

test('CMD readiness handles split OSC terminators without accepting hidden title payloads as prompts', async () => {
  const p = new Pty(), pending = waitForCmdInput(p, 1000); let ready = false, raw = '';
  pending.then(() => { ready = true; });
  const data = chunk => { raw += chunk; p.events.emit('data', chunk); };
  data('\x1b]0;hidden\r\nC:\\NotReady>'); await tick();
  assert.equal(consoleText(raw), ''); assert.equal(ready, false);
  data('\x1b'); await tick(); assert.equal(ready, false);
  data('\\\r\nCMD_SPLIT_one\r\nC:\\Fixture'); await tick(); assert.equal(ready, false);
  data('>\x1b]0;second title\x1b'); data('\\'); await pending;
  assert.equal(consoleText(raw), '\r\nCMD_SPLIT_one\r\nC:\\Fixture>');
  assert.deepEqual(p.writes, []); assert.equal(p.events.listenerCount('data'), 0);
});

test('administrator CMD passes only its fixed shell ID and publishes elevation metadata', async t => {
  const p = new Pty(), calls = []; p.readyForInput = async () => { throw Error('An ordinary launch needs no startup input'); };
  const h = await fixture(t, { shell: { ...shell, id: 'local:cmd-admin', baseId: 'local:cmd', administrator: true }, elevatedSpawn: async id => { calls.push(id); return p; } });
  const events = []; h.r.on('panes', list => events.push(JSON.parse(JSON.stringify(list)))); const pane = await open(h);
  assert.deepEqual(calls, ['local:cmd']); assert.equal(h.spawns.length, 0); assert.deepEqual(p.writes, []);
  assert.equal(pane.administrator, true); assert.equal(h.r.profile.administrator, true); assert.equal(pane.shellId, 'local:cmd');
  assert.equal(events.find(list => list.length)[0].sessionType, 'local'); assert.equal(events.find(list => list.length)[0].administrator, true);
});

test('administrator CMD review is validated after UAC and keeps multiline commands in the owned console', async t => {
  const p = new Pty(); p.readyForInput = async () => {}; let resolve, valid = true;
  const h = await fixture(t, { shell: { ...shell, id: 'local:cmd-admin', baseId: 'local:cmd', administrator: true }, elevatedSpawn: () => new Promise(r => { resolve = r; }) });
  const pending = h.r.createTask('CMD administrator task', 'set "VALUE=one"\necho %VALUE%', { validate() { if (!valid) throw Error('Review expired'); } });
  resolve(p); const pane = await pending;
  assert.deepEqual(p.writes, ['set "VALUE=one"\recho %VALUE%\r']); assert.equal(pane.administrator, true);
  const stale = new Pty(); stale.readyForInput = async () => { valid = false; };
  h.r.elevatedSpawn = async () => stale;
  await assert.rejects(h.r.createTask('Expired', 'echo DO_NOT_RUN', { validate() { if (!valid) throw Error('Review expired'); } }), /Review expired/);
  assert.deepEqual(stale.writes, []); assert.equal(stale.kills, 1); assert.equal(p.kills, 0);
});

test('CMD controls and oversized reviewed commands fail before process launch or UAC', async t => {
  let elevatedCalls = 0;
  for (const administrator of [false, true]) {
    const h = await fixture(t, { shell: administrator ? { ...shell, id: 'local:cmd-admin', baseId: 'local:cmd', administrator: true } : shell,
      elevatedSpawn: async () => { elevatedCalls++; throw Error('Unexpected UAC'); } });
    for (const command of ['echo \x1bX', 'x'.repeat(8193), 'x'.repeat(8192)]) await assert.rejects(h.r.createTask('Rejected', command), /controls|8 KiB|8,191/);
    assert.equal(h.spawns.length, 0); assert.equal(h.r.activeShellCount(), 0);
  }
  assert.equal(elevatedCalls, 0);
});

test('administrator CMD never converts a picked folder into executable command text', async t => {
  let calls = 0;
  const h = await fixture(t, { shell: { ...shell, id: 'local:cmd-admin', baseId: 'local:cmd', administrator: true }, home: 'C:\\Folder %UNTRUSTED% ! & literal',
    elevatedSpawn: async () => { calls++; throw Error('Unexpected UAC'); } });
  await assert.rejects(h.r.create('Command Prompt 1'), /account home/); assert.equal(calls, 0);
});

function workbenchFixture(t) {
  const handlers = {}, connections = new Map(), launches = [], events = [];
  const shells = [shell, { id: 'local:powershell', name: 'Windows PowerShell', family: 'powershell', executable: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' }];
  let available = shells, picked = { canceled: true }, saves = 0;
  const store = { data: { profiles: [] }, save() { saves++; } };
  const workbench = installWorkbench({ handle: (name, fn) => { handlers[name] = fn; }, connections, getStore: () => store,
    app: { isPackaged: false, getVersion: () => 'fixture' }, getWindow: () => ({}),
    dialog: { showOpenDialog: async () => typeof picked === 'function' ? picked() : picked, showMessageBox: async () => ({ response: 0 }) },
    emit: (type, data) => events.push({ type, data: JSON.parse(JSON.stringify(data)) }), queueOutput() {}, discardOutput() {}, output: { flush() {} },
    forKey: key => connections.get(key.split('/')[0]), shellProvider: () => available,
    localFactory: (selected, options) => new LocalRemote(selected, { ...options, home: os.homedir(), spawn: (...args) => { launches.push(args); return new Pty(); }, elevatedSpawn: async id => { launches.push(['administrator', id]); return new Pty(); } }) });
  t.after(() => { for (const r of connections.values()) r.remote.disconnect(); });
  return { handlers, connections, workbench, launches, events, store, saves: () => saves, choose(result) { picked = result; }, shells(value) { available = value; } };
}

test('workbench numbers CMD and PowerShell independently while administrator tabs share their shell counter', async t => {
  const h = workbenchFixture(t);
  const first = await h.handlers.localOpen('local:cmd'), power = await h.handlers.localOpen('local:powershell'), second = await h.workbench.openAdministrator('local:cmd');
  assert.equal(first.pane.sessionName, 'Command Prompt 1'); assert.equal(power.pane.sessionName, 'PowerShell 1'); assert.equal(second.pane.sessionName, 'Command Prompt 2');
  assert.equal(second.pane.shellId, 'local:cmd'); assert.equal(second.pane.administrator, true);
  h.connections.get('local:cmd').remote.closeView(first.pane.key);
  assert.equal((await h.handlers.localOpen('local:cmd')).pane.sessionName, 'Command Prompt 3');
  const cmdTargets = h.handlers.workbenchContext().targets.filter(target => target.shell === 'cmd');
  assert.deepEqual(cmdTargets.map(target => target.id), ['local:cmd', 'local:cmd-admin']);
  assert.ok(cmdTargets.every(target => target.local && target.shellId === 'local:cmd'));
  assert.equal(h.saves(), 0); assert.deepEqual(h.store.data.profiles, []);
});

test('CMD picker cancellation and a shell removed during the picker never start a process', async t => {
  const h = workbenchFixture(t); assert.equal(await h.handlers.localOpen('local:cmd', true), null); assert.equal(h.launches.length, 0);
  let resolve; h.choose(() => new Promise(r => { resolve = r; })); const pending = h.handlers.localOpen('local:cmd', true);
  h.shells([]); resolve({ canceled: false, filePaths: [os.homedir()] }); await assert.rejects(pending, /not available/); assert.equal(h.launches.length, 0);
});

test('workbench CMD shell type controls recipes and custom command review', async t => {
  const h = workbenchFixture(t), result = await h.handlers.localOpen('local:cmd'); await h.connections.get('local:cmd').remote.open(result.pane.key);
  const info = h.handlers.paneActions(result.pane.key); assert.equal(info.platform.shell, 'cmd');
  const plan = h.handlers.workbenchReview('local:cmd', { key: result.pane.key, code: 'echo "literal & current"' });
  assert.equal(plan.shell, 'cmd'); h.handlers.workbenchCancelReview(plan.token);
  for (const id of ['local:cmd /k bad', 'local:cmd;echo bad', 'C:\\cmd.exe', {}, ['local:cmd']]) await assert.rejects(h.handlers.localOpen(id));
  assert.equal(h.launches.length, 1);
});

if (process.platform === 'win32') for (const administrator of [false, true]) test((administrator ? 'native bridge fixture' : 'native ordinary ConPTY') + ' CMD supports multiline, quotes, Unicode, caret and grouped interactive commands', { timeout: 90000 }, async t => {
  const { spawn } = require('node:child_process'), { spawnElevatedPty } = require('../src/elevated-pty.cjs');
  const nativeFixture = administrator ? require('../scripts/lib/native-broker-fixture.cjs').createNativeBrokerFixture() : null;
  const found = installedShells().find(value => value.id === 'local:cmd'); assert.ok(found);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nerdsshell-cmd-native-'));
  const folder = path.join(directory, 'Folder %literal% ! & 日本語'); fs.mkdirSync(folder);
  const local = administrator ? { ...found, id: 'local:cmd-admin', baseId: 'local:cmd', administrator: true } : found;
  const ptys = [], brokers = []; let output = '', phase = 'startup';
  const observe = pty => {
    const worker = pty._agent?._conoutSocketWorker?._worker;
    if (!administrator) assert.ok(worker && pty._agent._useConptyDll === true, 'Native fixture must observe the actual pinned DLL worker');
    const owned = { pty, worker, exited: false, workerExited: worker?.threadId === -1 };
    owned.subscription = pty.onExit(event => { owned.exited = true; owned.exitCode = event.exitCode; });
    worker?.once('exit', () => { owned.workerExited = true; }); ptys.push(owned); return pty;
  };
  const r = new LocalRemote(local, { home: administrator ? os.homedir() : folder,
    spawn: (...args) => observe(require('node-pty').spawn(...args)),
    elevatedSpawn: async id => observe(await spawnElevatedPty(id, { execute: (executable, args, options) => {
      const script = Buffer.from(args[4], 'base64').toString('utf16le'); assert.match(script, /\[BetterSSH\.ElevatedConsole\]::Broker\(/);
      const changed = [...args]; changed[4] = Buffer.from(script.replace('[BetterSSH.ElevatedConsole]::Broker(', '[BetterSSH.ElevatedConsole]::BrokerFixture('), 'utf16le').toString('base64');
      const child = spawn(executable, changed, { ...options, env: nativeFixture.environment(options.env) }), owned = { child, closed: false, stderr: '', frames: require('../scripts/lib/native-broker-fixture.cjs').observeFixtureFrames(child) }; brokers.push(owned);
      child.once('close', code => { owned.closed = true; owned.exitCode = code; });
      child.stderr.on('data', bytes => { owned.stderr = (owned.stderr + bytes.toString()).slice(-2048); }); return child;
    } })) });
  r.on('output', (_key, bytes) => { output = (output + bytes.toString()).slice(-65536); });
  const plain = () => consoleText(output);
  const diagnostic = () => JSON.stringify({ phase, administrator, activeShells: r.activeShellCount(),
    ptys: ptys.map(({ pty, worker, exited, exitCode, workerExited }) => ({ pid: pty.pid, ready: pty._isReady, exited, exitCode, workerExited,
      workerId: worker?.threadId, inputDestroyed: pty._agent?._inSocket.destroyed, outputDestroyed: pty._agent?._outSocket.destroyed,
      startupRawTail: pty.promptText?.slice(-3000) })),
    brokers: brokers.map(({ child, closed, exitCode, stderr, frames }) => ({ pid: child.pid, closed, exitCode, stderr, fixtureFailure: frames.failure, fixtureFrameError: frames.error })),
    outputTail: plain().slice(-3000), rawOutputTail: output.slice(-3000), resources: process.getActiveResourcesInfo().slice(0, 24) });
  const until = async (label, condition, timeout = 20000) => {
    phase = label; const deadline = Date.now() + timeout;
    while (!condition() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(condition(), `Native CMD ${label}: ${diagnostic()}`);
  };
  const transportsClosed = () => ptys.every(({ pty, worker, workerExited }) => !worker ||
    (workerExited && worker.threadId === -1 && pty._agent._inSocket.destroyed && pty._agent._outSocket.destroyed)) && brokers.every(owned => owned.closed);
  const launch = async (name, code) => {
    phase = `startup ${name}`;
    try { const pane = await r.createTask(name, code); await r.open(pane.key); return pane; }
    catch (error) { throw new Error(`Native CMD ${phase}: ${error.message}; ${diagnostic()}`, { cause: error }); }
  };
  t.after(async () => {
    r.disconnect();
    // EOF also cancels a fixture broker that has not completed its handshake.
    for (const { child, closed } of brokers) if (!closed && !child.stdin.destroyed) child.stdin.end();
    try { await until('owned transport cleanup', transportsClosed, 10000); }
    finally {
      for (const owned of ptys) owned.subscription.dispose();
      for (const owned of brokers) owned.frames.dispose();
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      await nativeFixture?.dispose();
    }
  });
  t.diagnostic(`Native CMD ${administrator ? 'broker fixture' : 'ordinary DLL'}: starting disposable acceptance`);
  await r.connect();
  const code = 'set "NERDSSH_CMD_VALUE=one"\necho CMD_VALUE_%NERDSSH_CMD_VALUE%\nset "NERDSSH_CMD_QUOTED=two & three é漢字😀"\necho "CMD_QUOTED_%NERDSSH_CMD_QUOTED%"\necho CMD_CARET_^\nCONTINUED\nfor %i in (1 2) do (\necho CMD_LOOP_%i\n)';
  const pane = await launch('Synthetic CMD acceptance', code);
  for (const marker of ['CMD_VALUE_one', 'CMD_QUOTED_two & three é漢字😀', 'CMD_CARET_CONTINUED', 'CMD_LOOP_1', 'CMD_LOOP_2']) await until(`output ${marker}`, () => plain().includes(marker));
  if (!administrator) assert.ok(plain().includes(folder), `Picked folder is preserved literally in the prompt: ${diagnostic()}`);
  assert.equal(pane.shellFamily, 'cmd'); assert.equal(pane.administrator, administrator);
  await r.input(pane.key, 'exit 7\r'); await until('natural shell exit', () => r.activeShellCount() === 0);
  await until('natural exit releases its worker/input or broker', transportsClosed, 10000);
  assert.ok(plain().includes('CMD_LOOP_2'), 'Native exit preserves output');
  const quiet = await launch('Synthetic CMD close', 'set "NERDSSH_CMD_CLOSE=ready"\necho CMD_CLOSE_%NERDSSH_CMD_CLOSE%');
  await until('quiet close readiness', () => plain().includes('CMD_CLOSE_ready')); r.closeView(quiet.key);
  await until('explicit close releases its worker/input or broker', transportsClosed, 10000);
  if (!administrator) {
    phase = 'close before first output';
    const early = await r.create('Synthetic CMD early close'), owned = ptys.at(-1);
    assert.equal(owned.pty._isReady, false, `Fixture closes before node-pty receives first output: ${diagnostic()}`);
    r.closeView(early.key); await until('early close releases its worker/input', transportsClosed, 10000);
  }
  t.diagnostic(`Native CMD ${administrator ? 'broker fixture' : 'ordinary DLL'}: natural exit and explicit close released all owned transports`);
});
