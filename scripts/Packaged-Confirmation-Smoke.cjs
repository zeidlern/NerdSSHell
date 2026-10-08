'use strict';
// Fresh Windows acceptance of the exact ASAR confirmation/paste path.
// This fixture never reads, saves, restores or writes the Windows clipboard.
// It runs the unmodified ASAR main/UI/preload under an owned Electron SDK process,
// with a memory-only clipboard dependency and hidden owned BrowserWindows.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const physicalFs = process.versions.electron ? require('original-fs') : fs;
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash, generateKeyPairSync } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const options = new Map();
let fixtureRuntime = false;
for (let index = 2; index < process.argv.length; index++) {
  const name = process.argv[index];
  if (name === '--fixture-runtime') { fixtureRuntime = true; continue; }
  if (name.startsWith('--user-data-dir=')) continue;
  const value = process.argv[++index];
  if (!['--asar', '--runtime', '--output', '--data'].includes(name) || options.has(name) || !value || !path.isAbsolute(value)) throw new Error('Fixture arguments must be unique absolute paths.');
  options.set(name, value);
}
const asar = physicalFs.realpathSync.native(options.get('--asar') || path.join(root, 'dist', 'win-unpacked', 'resources', 'app.asar'));
// Use the locked package's supported loader; it checksum-verifies and installs
// the development SDK on demand when a fresh CI install has no executable yet.
const runtime = fs.realpathSync.native(options.get('--runtime') || (process.versions.electron ? process.execPath : require('electron')));
const temporaryRoot = fs.realpathSync.native(os.tmpdir());
const samePath = (first, second) => process.platform === 'win32' ? path.resolve(first).toLowerCase() === path.resolve(second).toLowerCase() : path.resolve(first) === path.resolve(second);
const output = path.resolve(options.get('--output') || path.join(root, '.local', 'packaged-confirmation'));
assert.ok(physicalFs.statSync(asar).isFile() && path.basename(asar) === 'app.asar', 'Choose an existing app.asar.');
assert.ok(fs.statSync(runtime).isFile() && path.basename(runtime).toLowerCase() === 'electron.exe', 'Choose an Electron SDK executable.');
const digest = filename => createHash('sha256').update(physicalFs.readFileSync(filename)).digest('hex');
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const literal = value => JSON.stringify(value).replace(/[<>\u2028\u2029]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
function ownedDataDirectory() {
  const directory = options.get('--data');
  assert.ok(directory && path.basename(directory).startsWith('nerdsshell-confirmation-'), 'Data must be an owned disposable fixture directory.');
  assert.ok(fs.lstatSync(directory).isDirectory() && !fs.lstatSync(directory).isSymbolicLink(), 'Data must be an ordinary directory.');
  const resolved = fs.realpathSync.native(directory);
  assert.ok(samePath(path.dirname(resolved), temporaryRoot), 'Data must be a direct child of the canonical temporary root.');
  return resolved;
}
async function launch() {
  if (process.platform !== 'win32') throw new Error('This acceptance fixture requires Windows.');
  const directory = fs.mkdtempSync(path.join(temporaryRoot, 'nerdsshell-confirmation-'));
  const resolved = fs.realpathSync.native(directory);
  const args = [__filename, '--fixture-runtime', '--asar', asar, '--runtime', runtime, '--output', output, '--data', resolved, '--user-data-dir=' + resolved];
  // Node owns this exact child handle; there is no process-name or global cleanup.
  const child = spawn(runtime, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let timedOut = false, timeout;
  const quotePowerShell = value => "'" + value.replaceAll("'", "''") + "'";
  const processHelper = command => new Promise((resolve, reject) => {
    const helper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; helper.stdout.on('data', bytes => { stdout += bytes; }); helper.stderr.resume();
    helper.once('error', () => reject(new Error('Owned process identity helper could not launch.')));
    helper.once('exit', code => code === 0 ? resolve(stdout.trim()) : reject(new Error('Owned process identity helper failed.')));
  });
  child.stdout.on('data', bytes => process.stdout.write(bytes));
  // Electron can print synthetic UI/password/protocol data in an error. Do not forward it.
  child.stderr.resume();
  let code;
  const exited = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  try {
    assert.ok(Number.isInteger(child.pid) && child.pid > 0, 'Only the spawned runtime may be inspected.');
    const owner = JSON.parse(await processHelper('$ErrorActionPreference=\'Stop\'; $p=Get-Process -Id ' + child.pid + '; @{path=$p.Path;ticks=$p.StartTime.ToUniversalTime().Ticks.ToString()}|ConvertTo-Json -Compress'));
    assert.equal(fs.realpathSync.native(owner.path), runtime);
    assert.ok(/^\d+$/.test(owner.ticks));
    timeout = setTimeout(() => {
      timedOut = true;
      // Start-time and executable checks fail closed on PID reuse.
      processHelper('$ErrorActionPreference=\'Stop\'; $p=Get-Process -Id ' + child.pid + ' -ErrorAction SilentlyContinue; if($null -ne $p){if($p.StartTime.ToUniversalTime().Ticks.ToString() -ne ' + quotePowerShell(owner.ticks) + ' -or [IO.Path]::GetFullPath($p.Path) -ne ' + quotePowerShell(runtime) + '){throw \'Owned runtime identity changed.\'}; Stop-Process -InputObject $p -Force}').catch(() => console.error('Owned runtime identity check prevented timeout cleanup.'));
    }, 180000);
    code = await exited;
    if (timedOut || code !== 0) throw new Error('Owned confirmation fixture failed; inspect its sanitized results.json.');
  } finally {
    clearTimeout(timeout);
    assert.ok(child.exitCode !== null || child.signalCode !== null, 'Owned runtime must stop before deleting its data.');
    assert.equal(fs.realpathSync.native(resolved), resolved);
    assert.ok(samePath(path.dirname(resolved), temporaryRoot) && path.basename(resolved).startsWith('nerdsshell-confirmation-') && !fs.lstatSync(resolved).isSymbolicLink(), 'Cleanup is confined to the exact owned temporary directory.');
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 4, retryDelay: 300 });
    const filename = path.join(output, 'results.json');
    if (fs.existsSync(filename)) {
      const report = JSON.parse(fs.readFileSync(filename, 'utf8'));
      report.ownedRuntimeStopped = true; report.temporaryDataRemoved = true;
      fs.writeFileSync(filename, JSON.stringify(report, null, 2) + '\n');
    }
  }
}
async function runFixture() {
  if (process.platform !== 'win32' || !process.versions.electron || fs.realpathSync.native(process.execPath) !== runtime) throw new Error('Fixture mode requires its recorded Windows Electron SDK.');
  const { app, BrowserWindow, dialog } = require('electron');
  const electron = require('electron');
  const { createRequire, Module } = require('node:module');
  const vm = require('node:vm');
  const directory = ownedDataDirectory(), mainPath = path.join(asar, 'src', 'main.cjs');
  const packedRequire = createRequire(mainPath), metadata = packedRequire('../package.json');
  const { Server, utils } = packedRequire('ssh2');
  const { profile, fingerprint } = packedRequire('./core.cjs');
  const { StateStore } = packedRequire('./storage.cjs');
  const { PROBE } = packedRequire('./action-catalog.cjs');
  const peers = new Set(), streams = new Map(), windows = new Set(), suppliedWindowOptions = new WeakMap();
  let server, memoryClipboard = '', nativeMessages = 0, clipboardReads = 0, clipboardWrites = 0;
  const metrics = { connections: 0, acceptedPasswords: 0, shells: 0, closedShells: 0, unexpectedExec: 0, inspections: 0, receivedBytes: 0 };
  const report = { status: 'running', scope: 'Exact unmodified ASAR main, modules, UI and preload under the Electron SDK with memory-only clipboard and hidden owned windows; not the fused packaged executable or physical clipboard.', runtime: process.versions.electron, node: process.versions.node, platform: process.platform, architecture: process.arch, appVersion: metadata.version, asarSha256: digest(asar), runtimeSha256: digest(runtime), runtimePID: process.pid, runtimeExecutable: runtime, asarFile: asar, checks: [], metrics };
  const packageExe = path.join(path.dirname(path.dirname(asar)), 'NerdSSHell.exe');
  if (fs.existsSync(packageExe)) { report.packagedExecutable = packageExe; report.packagedExecutableSha256 = digest(packageExe); }
  fs.mkdirSync(output, { recursive: true });
  const persist = () => fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  const check = (name, value = true) => {
    if (value !== true) { const error = new Error('Fixture assertion failed.'); error.fixtureStep = name; throw error; }
    report.checks.push(name); persist(); console.log(name);
  };
  const password = 'synthetic-confirmation-loopback-only';
  const hostKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
  let nextShell = 0;
  let evaluate, wait, send;
  try {
    assert.equal(process.versions.electron, '44.5.1', 'Acceptance uses the current pinned Electron SDK.');
    check('Canonical Windows temporary root directly owns the disposable fixture directory', samePath(path.dirname(directory), temporaryRoot));
    server = new Server({ hostKeys: [hostKey] }, peer => {
      peers.add(peer); metrics.connections++; peer.on('error', () => {}); peer.on('close', () => peers.delete(peer));
      peer.on('authentication', context => {
        if (context.method === 'password' && context.username === 'fixture' && context.password === password) { metrics.acceptedPasswords++; context.accept(); }
        else context.reject(['password']);
      });
      peer.on('ready', () => peer.on('session', accept => {
        const session = accept();
        session.on('pty', acceptPty => acceptPty());
        session.on('window-change', acceptChange => acceptChange?.());
        session.on('exec', (_accept, reject, info) => { if (info.command === PROBE) metrics.inspections++; else metrics.unexpectedExec++; reject(); });
        session.on('sftp', (_accept, reject) => reject());
        session.on('shell', acceptShell => {
          const stream = acceptShell(), id = ++nextShell;
          const record = { id, stream, input: '' }; streams.set(id, record); metrics.shells++;
          stream.on('error', () => {});
          stream.on('close', () => metrics.closedShells++);
          stream.on('data', bytes => { metrics.receivedBytes += bytes.length; record.input += bytes.toString('utf8'); stream.write(bytes.toString('utf8').replace(/\r/g, '\r\n')); });
          stream.write('DISPOSABLE CONFIRMATION ECHO SHELL ' + id + '\r\n');
        });
      }));
    });
    server.on('error', () => {});
    // Main must register its privileged protocol synchronously before Electron readiness.
    // A generated high loopback port lets settings be written without yielding first.
    const port = require('node:crypto').randomInt(49152, 65535);
    const listening = new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    const store = new StateStore(directory);
    store.data.profiles = [profile({ id: 'fixture-confirmation', name: 'Confirmation acceptance fixture', host: '127.0.0.1', port, username: 'fixture', auth: 'password', rememberPassword: false, sessionMode: 'standard', autoConnect: false, record: false, scrollback: 1000 })];
    store.data.pins['127.0.0.1:' + port] = fingerprint(utils.parseKey(hostKey).getPublicSSH());
    store.data.notifications = { enabled: false, desktop: false, audio: false, visual: false };
    store.save();
    app.commandLine.appendSwitch('user-data-dir', directory);
    app.setPath('userData', directory);
    class OwnedHiddenWindow extends BrowserWindow {
      constructor(original) {
        super({ ...original, show: false });
        suppliedWindowOptions.set(this, original); windows.add(this); this.once('closed', () => windows.delete(this));
      }
    }
    // Failing native message boxes are a fixture guard, never auto-approval.
    const guardedDialog = new Proxy(dialog, { get(target, key) {
      if (['showMessageBox', 'showMessageBoxSync', 'showErrorBox'].includes(key)) return () => { nativeMessages++; throw new Error('Unexpected native message box in shared confirmation acceptance.'); };
      const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    const fixtureElectron = { ...electron, BrowserWindow: OwnedHiddenWindow, dialog: guardedDialog, clipboard: Object.freeze({
      readText() { clipboardReads++; return memoryClipboard; },
      writeText(value) { clipboardWrites++; memoryClipboard = String(value); }
    }) };
    const shim = name => name === 'electron' ? fixtureElectron : packedRequire(name);
    shim.resolve = packedRequire.resolve; shim.cache = packedRequire.cache;
    const mainModule = new Module(mainPath);
    mainModule.filename = mainPath; mainModule.paths = Module._nodeModulePaths(path.dirname(mainPath));
    const source = fs.readFileSync(mainPath, 'utf8');
    report.mainSourceSha256 = createHash('sha256').update(source).digest('hex');
    report.exactCurrentSourceASARFiles = {};
    for (const file of ['src/main.cjs', 'src/dialog-policy.cjs', 'src/preload.cjs', 'ui/app.js', 'ui/index.html', 'ui/style.css']) {
      const current = fs.readFileSync(path.join(root, file)), packaged = fs.readFileSync(path.join(asar, file));
      assert.deepEqual(packaged, current, 'Acceptance must use the exact current source ASAR bytes.');
      report.exactCurrentSourceASARFiles[file] = createHash('sha256').update(packaged).digest('hex');
    }
    // Execute the exact source, with its ASAR filename and relative module root.
    vm.runInThisContext(Module.wrap(source), { filename: mainPath }).call(mainModule.exports, mainModule.exports, shim, mainModule, mainPath, path.dirname(mainPath));
    mainModule.loaded = true;
    await listening;
    for (let attempt = 0; attempt < 200 && !windows.size; attempt++) await delay(50);
    assert.equal(windows.size, 1, 'Main creates one owned window.');
    const window = [...windows][0], wc = window.webContents;
    for (let attempt = 0; attempt < 200 && wc.getURL() !== 'nerdsshell://app/ui/index.html'; attempt++) await delay(50);
    assert.equal(wc.getURL(), 'nerdsshell://app/ui/index.html');
    wc.debugger.attach('1.3');
    send = (method, params = {}) => wc.debugger.sendCommand(method, params);
    evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) {
        const error = new Error('Owned ASAR UI evaluation failed.');
        error.debuggerException = { line: result.exceptionDetails.lineNumber, column: result.exceptionDetails.columnNumber, className: result.exceptionDetails.exception?.className };
        throw error;
      }
      return result.result.value;
    };
    wait = async (expression, label) => {
      for (let attempt = 0; attempt < 200; attempt++) { if (await evaluate(expression)) return; await delay(50); }
      const error = new Error('Owned ASAR UI wait failed.'); error.fixtureStep = label; throw error;
    };
    await send('Runtime.enable'); await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await wait("typeof profiles!=='undefined'&&profiles.has('fixture-confirmation')", 'Disposable profile initializes');
    report.initialWindowFeatures = { visible: window.isVisible(), sandbox: wc.getLastWebPreferences().sandbox, contextIsolation: wc.getLastWebPreferences().contextIsolation, nodeIntegration: wc.getLastWebPreferences().nodeIntegration, suppliedPreload: suppliedWindowOptions.get(window).webPreferences.preload };
    check('Exact ASAR main serves ASAR UI with its sandboxed isolated preload', !window.isVisible() && wc.getLastWebPreferences().sandbox === true && wc.getLastWebPreferences().contextIsolation === true && wc.getLastWebPreferences().nodeIntegration === false && suppliedWindowOptions.get(window).webPreferences.preload === path.join(asar, 'src', 'preload.cjs'));
    report.sdkHostAppVersion = app.getVersion();
    check('Actual preload/main state uses only the isolated generated profile', await evaluate('(async()=>{const s=await api.state();return s.profiles.length===1&&s.profiles[0].id==="fixture-confirmation"&&s.dataDirectory.toLowerCase()===' + literal(directory.toLowerCase()) + '&&s.version===' + literal(app.getVersion()) + ';})()'));
    const point = selector => evaluate('(()=>{const e=document.querySelector(' + literal(selector) + ');const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()');
    const mouse = (type, position) => send('Input.dispatchMouseEvent', { type, ...position, button: 'left', clickCount: 1 });
    const click = async selector => { const position = await point(selector); await mouse('mousePressed', position); await mouse('mouseReleased', position); };
    const key = async (name, code, virtual, modifiers = 0) => {
      for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: name, code, windowsVirtualKeyCode: virtual, modifiers, ...(name === 'Enter' && type === 'keyDown' ? { text: '\r', unmodifiedText: '\r' } : {}) });
    };
    const terminalText = '(view=>{const b=view.terminal.buffer.active;let s="";for(let i=0;i<b.length;i++){const l=b.getLine(i);if(l)s+=(l.isWrapped?"":"\\n")+l.translateToString(!b.getLine(i+1)?.isWrapped);}return s;})';
    await evaluate('window.__confirmationTasks={};window.__confirmationEvents=[];api.onEvent(e=>{if(e.type==="prompt")__confirmationEvents.push({id:e.id,kind:e.kind});});window.__confirmationConnect={done:false};connectProfile("fixture-confirmation").then(()=>__confirmationConnect={done:true,ok:true},()=>__confirmationConnect={done:true,ok:false});true');
    await wait("$('promptDialog').open&&$('promptValue').type==='password'&&!$('promptValue').hidden", 'Synthetic SSH password prompt appears');
    await evaluate("$('promptValue').value=" + literal(password) + ';true');
    await click('#promptAccept');
    await wait('__confirmationConnect.done&&__confirmationConnect.ok&&[...views.values()].some(v=>v.ready)', 'Verified real loopback shell attaches');
    const originalKey = await evaluate('[...views.keys()][0]');
    const shell1 = streams.get(1);
    await wait(terminalText + '(views.get(' + literal(originalKey) + ')).includes("DISPOSABLE CONFIRMATION ECHO SHELL 1")', 'Loopback banner reaches original renderer');
    check('One generated pinned loopback transport authenticates and opens its echo-only shell', metrics.acceptedPasswords === 1 && metrics.shells === 1 && peers.size === 1 && await evaluate(terminalText + '(views.get(' + literal(originalKey) + ')).includes("DISPOSABLE CONFIRMATION ECHO SHELL 1")'));
    const taskState = name => '__confirmationTasks[' + literal(name) + ']';
    const begin = async (name, text, destination = originalKey) => {
      memoryClipboard = text;
      await evaluate(taskState(name) + '={done:false};paste(' + literal(destination) + ').then(()=>{'+ taskState(name) + '={done:true,ok:true};},()=>{' + taskState(name) + '={done:true,ok:false};});true');
    };
    const prompt = async label => {
      await wait("$('promptDialog').open&&promptKind==='confirmation'", label + ' opens a shared confirmation');
      check(label + ': actual Windows parent remains OS-enabled while confirmation is visible', window.isEnabled());
      check(label + ': affirmative then Cancel are real usable buttons, Cancel is focused', await evaluate("!$('promptAccept').disabled&&!$('cancelPrompt').disabled&&$('promptAccept').textContent==='Continue'&&$('cancelPrompt').textContent==='Cancel'&&$('promptAccept').getBoundingClientRect().left<$('cancelPrompt').getBoundingClientRect().left&&document.activeElement===$('cancelPrompt')&&$('promptValue').hidden&&$('promptRememberField').hidden"));
    };
    const settled = name => wait(taskState(name) + '.done&&' + taskState(name) + '.ok', name + ' resolves through real paste IPC');
    const noInput = async (label, before) => { await delay(120); check(label, metrics.receivedBytes === before); };
    const accepted = async (label, record, before, expected) => {
      for (let attempt = 0; attempt < 200 && record.input.length < before.length + expected.length; attempt++) await delay(25);
      await delay(120);
      check(label + ': echo server receives approved text in its original shell exactly once', record.input === before + expected);
      check(label + ': approved text appears in the original terminal', await evaluate(terminalText + '(views.get(' + literal(originalKey) + ')).includes(' + literal(expected.split('\r')[0]) + ')'));
    };
    report.phase = 'Multiline pointer and keyboard';
    const pointerText = 'FIXTURE POINTER FIRST\nFIXTURE POINTER SECOND', normalizedPointer = pointerText.replace(/\n/g, '\r');
    let before = shell1.input;
    await begin('pointer', pointerText); await prompt('Pointer approval');
    check('Confirmation body displays the generated multiline clipboard text', await evaluate("$('promptMessage').textContent.includes(" + literal(pointerText) + ')'));
    await click('#promptAccept'); await settled('pointer'); await accepted('Pointer Continue', shell1, before, normalizedPointer);
    await wait("!$('promptDialog').open", 'Pointer approval closes');
    const cancelBytes = metrics.receivedBytes;
    await begin('cancel', 'FIXTURE CANCEL FIRST\nFIXTURE CANCEL SECOND'); await prompt('Pointer cancellation');
    await click('#cancelPrompt'); await settled('cancel'); await noInput('Pointer Cancel sends zero input', cancelBytes);
    await begin('escape', 'FIXTURE ESCAPE FIRST\nFIXTURE ESCAPE SECOND'); await prompt('Escape cancellation');
    await key('Escape', 'Escape', 27); await settled('escape'); await noInput('Actual Escape sends zero input', cancelBytes);
    await begin('default', 'FIXTURE ENTER FIRST\nFIXTURE ENTER SECOND'); await prompt('Default Enter cancellation');
    await key('Enter', 'Enter', 13); await settled('default'); await noInput('Default focused Cancel and Enter send zero input', cancelBytes);
    await begin('keyboard', 'FIXTURE KEYBOARD FIRST\nFIXTURE KEYBOARD SECOND'); await prompt('Keyboard approval');
    await key('Tab', 'Tab', 9, 8);
    check('Actual Shift+Tab reaches affirmative from Cancel', await evaluate("document.activeElement===$('promptAccept')"));
    await key('Tab', 'Tab', 9);
    check('Actual Tab returns from affirmative to Cancel', await evaluate("document.activeElement===$('cancelPrompt')"));
    await key('Tab', 'Tab', 9, 8);
    before = shell1.input;
    await key('Enter', 'Enter', 13); await settled('keyboard'); await accepted('Keyboard Continue', shell1, before, 'FIXTURE KEYBOARD FIRST\rFIXTURE KEYBOARD SECOND');
    report.phase = 'Backdrop and serialization';
    const backdropBytes = metrics.receivedBytes;
    await begin('backdrop', 'FIXTURE BACKDROP FIRST\nFIXTURE BACKDROP SECOND'); await prompt('Backdrop guard');
    const background = await point('#preferences');
    await mouse('mousePressed', background); await mouse('mouseReleased', background); await delay(100);
    check('Outside click keeps confirmation pending without Preferences clickthrough', await evaluate("$('promptDialog').open&&!$('preferencesDialog').open&&!" + taskState('backdrop') + '.done'));
    await noInput('Outside click sends zero terminal input', backdropBytes);
    await click('#cancelPrompt'); await settled('backdrop');
    await begin('queued-first', 'FIXTURE QUEUE ONE\nFIXTURE QUEUE ONE END'); await prompt('First serialized request');
    const firstId = await evaluate('promptId'), eventCount = await evaluate('__confirmationEvents.length');
    await begin('queued-second', 'FIXTURE QUEUE TWO\nFIXTURE QUEUE TWO END'); await delay(100);
    check('Second actual paste request waits behind the first displayed prompt', await evaluate('promptId===' + literal(firstId) + '&&__confirmationEvents.length===' + eventCount + '&&!' + taskState('queued-second') + '.done'));
    before = shell1.input;
    await click('#promptAccept'); await settled('queued-first');
    await accepted('First serialized approval', shell1, before, 'FIXTURE QUEUE ONE\rFIXTURE QUEUE ONE END');
    await wait("$('promptDialog').open&&promptId!==" + literal(firstId), 'Second serialized request becomes visible');
    check('Second serialized request preserves its captured clipboard text', await evaluate("$('promptMessage').textContent.includes('FIXTURE QUEUE TWO')&&document.activeElement===$('cancelPrompt')"));
    const queueBytes = metrics.receivedBytes;
    const repeatedClick = await point('#promptAccept');
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...repeatedClick, button: 'left', clickCount: 2 });
    await delay(100);
    check('Trailing double-click cannot approve the next queued confirmation', await evaluate("$('promptDialog').open&&!" + taskState('queued-second') + '.done') && metrics.receivedBytes === queueBytes);
    await click('#cancelPrompt'); await settled('queued-second'); await noInput('Canceling queued second paste sends zero additional input', queueBytes);
    report.phase = 'Stale destinations';
    await begin('ended-replacement', 'FIXTURE STALE OLD\nFIXTURE STALE OLD END'); await prompt('Original shell replacement');
    const staleBytes = metrics.receivedBytes;
    // End only the server fixture's own echo channel, then explicitly open a new shell.
    shell1.stream.exit(0); shell1.stream.end();
    await wait('views.get(' + literal(originalKey) + ')&&!views.get(' + literal(originalKey) + ').ready', 'Ended original renderer becomes unavailable');
    const replacementKey = await evaluate('(async()=>{const p=await api.create("fixture-confirmation","Fixture replacement",false);panes.set(p.key,p);await openPane(p.key,true);return p.key;})()');
    await wait('views.get(' + literal(replacementKey) + ').ready', 'Replacement shell explicitly attaches');
    check('Replacement has a fresh stable key and the old prompt remains pending', replacementKey !== originalKey && metrics.shells === 2 && await evaluate("$('promptDialog').open&&active===" + literal(replacementKey)));
    await click('#promptAccept'); await settled('ended-replacement');
    await noInput('Approving ended original destination sends nothing to original or replacement shell', staleBytes);
    check('Replacement echo channel has received no stale input', streams.get(2).input === '');
    await begin('disconnect', 'FIXTURE DISCONNECT FIRST\nFIXTURE DISCONNECT SECOND', replacementKey); await prompt('Transport loss');
    const disconnectBytes = metrics.receivedBytes;
    for (const peer of peers) peer._sock?.destroy();
    await wait('!views.get(' + literal(replacementKey) + ').ready&&statuses.get("fixture-confirmation").state==="disconnected"', 'Owned transport loss invalidates destination');
    if (await evaluate("$('promptDialog').open")) await click('#promptAccept');
    await settled('disconnect'); await noInput('Approval after disconnect sends zero terminal input', disconnectBytes);
    check('Disconnect does not reconnect or silently create a replacement shell', metrics.connections === 1 && metrics.shells === 2);
    check('Every confirmation used app-owned interaction and no native message box', nativeMessages === 0);
    check('Clipboard dependency is strictly memory-only and writes were unnecessary', clipboardReads >= 10 && clipboardWrites === 0);
    check('Loopback fixture accepted only bounded OS probes and no remote task command', metrics.unexpectedExec === 0);
    report.memoryClipboardReads = clipboardReads; report.memoryClipboardWrites = clipboardWrites; report.systemClipboardReads = 0; report.systemClipboardWrites = 0; report.physicalClipboardTested = false; report.nativeMessageBoxes = nativeMessages;
    report.phase = 'Completed'; report.status = 'passed'; persist();
    console.log('Exact-ASAR confirmation acceptance passed (' + report.checks.length + ' checks).');
  } catch (error) {
    report.status = 'failed'; report.failure = { phase: report.phase || 'Initialization', step: error.fixtureStep || null, type: error.name, code: typeof error.code === 'string' ? error.code : null, debuggerException: error.debuggerException || null };
    if (evaluate) {
      try { report.failure.ui = await evaluate('({promptOpen:$("promptDialog").open,promptKind,focused:document.activeElement?.id,profileCount:profiles.size,viewCount:views.size})'); } catch {}
    }
    persist(); console.log('Exact-ASAR confirmation acceptance failed: ' + JSON.stringify(report.failure));
  } finally {
    for (const window of [...windows]) { try { if (window.webContents.debugger.isAttached()) window.webContents.debugger.detach(); window.destroy(); } catch {} }
    for (const peer of peers) peer._sock?.destroy();
    for (let attempt = 0; attempt < 40 && peers.size; attempt++) await delay(25);
    if (server) await new Promise(resolve => server.close(resolve));
    report.ownedPeersClosed = peers.size === 0; report.ownedWindowsDestroyed = windows.size === 0;
    if (!report.ownedPeersClosed || !report.ownedWindowsDestroyed) report.status = 'failed';
    persist();
    app.exit(report.status === 'passed' ? 0 : 1);
  }
}
if (fixtureRuntime) runFixture().catch(() => require('electron').app.exit(1));
else launch().catch(error => { console.error(error.message); process.exitCode = 1; });

