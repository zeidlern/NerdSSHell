'use strict';
// Native Windows acceptance of remembered SSH passwords in an owned packaged app.
// Only generated loopback SSH peers and explicit disposable user data are touched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { generateKeyPairSync, createHash } = require('node:crypto');
const { Server, utils } = require('ssh2');
const { profile, fingerprint } = require('../src/core.cjs');
const { StateStore } = require('../src/storage.cjs');
const { FILE_NAME } = require('../src/password-store.cjs');
const { PROBE } = require('../src/action-catalog.cjs');
const root = path.resolve(__dirname, '..'), metadata = require('../package.json');
const options = new Map();
for (let index = 2; index < process.argv.length; index++) {
  const name = process.argv[index], value = process.argv[++index];
  if (!['--exe', '--output'].includes(name) || options.has(name) || !value || !path.isAbsolute(value)) throw new Error('Use --exe and --output once each, with absolute paths.');
  options.set(name, value);
}
const exe = fs.realpathSync.native(options.get('--exe') || path.join(root, 'dist', 'win-unpacked', 'NerdSSHell.exe'));
if (!fs.statSync(exe).isFile() || path.basename(exe).toLowerCase() !== 'nerdsshell.exe') throw new Error('--exe must select an existing NerdSSHell.exe.');
const output = path.resolve(options.get('--output') || path.join(root, '.local', 'packaged-password'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nerdsshell-password-'));
const createdTemporary = fs.realpathSync.native(temporary), fixtureId = 'fixture-password';
const firstPassword = 'synthetic-remember-fixture-only', replacementPassword = 'synthetic-replacement-fixture-only', invalidPassword = 'synthetic-rejected-fixture-only';
let acceptedPassword = firstPassword, server, ws, control, currentOwner;
const owners = [], peers = new Set();
const metrics = { connections: 0, acceptedPasswords: 0, rejectedPasswords: 0, shells: 0, closedShells: 0, echoedInputs: 0, inspections: 0, unexpectedExec: 0 };
const report = { status: 'running', expectedVersion: metadata.version, checks: [], metrics, ownedAppPIDs: [] };
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
// Debugger string literals contain no raw HTML delimiters or Unicode line separators.
const literal = value => JSON.stringify(value).replace(/[<>\u2028\u2029]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
const quotePowerShell = value => "'" + value.replaceAll("'", "''") + "'";
function persistReport() { fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2)); }
function check(name, value = true) {
  if (value !== true) { const error = new Error(name); error.fixtureStep = name; throw error; }
  report.checks.push(name); persistReport(); console.log(name);
}
async function powershell(command, timeout = 15000) {
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.on('data', bytes => { stdout += bytes; });
  // Never publish process output: a failure must not dump command arguments or UI data.
  child.stderr.resume();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Owned process helper timed out.')); }, timeout);
    child.once('error', () => { clearTimeout(timer); reject(new Error('Owned process helper could not launch.')); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve(stdout.trim()) : reject(new Error('Owned process helper failed.')); });
  });
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } }
async function stopOwner(owner) {
  if (!owner || !alive(owner.pid)) return;
  assert.ok(owners.includes(owner) && Number.isInteger(owner.pid) && owner.pid > 0, 'Only a recorded owned process can be stopped.');
  // PID reuse cannot authorize stopping another user's process.
  await powershell(`$ErrorActionPreference='Stop'; $p=Get-Process -Id ${owner.pid} -ErrorAction SilentlyContinue; if($null -ne $p){if($p.StartTime.ToUniversalTime().Ticks.ToString() -ne ${quotePowerShell(owner.startedTicks)} -or [IO.Path]::GetFullPath($p.Path) -ne ${quotePowerShell(exe)}){throw 'Owned process identity changed.'}; Stop-Process -InputObject $p -Force}`);
}
async function freePort() {
  const socket = net.createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return port;
}
async function createFixture() {
  const hostKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs1' });
  server = new Server({ hostKeys: [hostKey] }, client => {
    peers.add(client); metrics.connections++; client.on('error', () => {}); client.on('close', () => peers.delete(client));
    client.on('authentication', context => {
      if (context.method === 'password' && context.username === 'fixture' && context.password === acceptedPassword) { metrics.acceptedPasswords++; context.accept(); }
      else { if (context.method === 'password') metrics.rejectedPasswords++; context.reject(['password']); }
    });
    client.on('ready', () => client.on('session', accept => {
      const session = accept(); session.on('pty', acceptPty => acceptPty());
      session.on('window-change', acceptChange => acceptChange?.());
      session.on('exec', (_accept, reject, info) => { if (info.command === PROBE) metrics.inspections++; else metrics.unexpectedExec++; reject(); });
      session.on('shell', acceptShell => {
        const stream = acceptShell(); metrics.shells++; stream.on('error', () => {}); stream.on('close', () => metrics.closedShells++);
        stream.write('DISPOSABLE PASSWORD ACCEPTANCE SHELL\r\n');
        stream.on('data', bytes => { metrics.echoedInputs++; stream.write(bytes); });
      });
      session.on('sftp', (_accept, reject) => reject());
    }));
  });
  server.on('error', () => {}); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port, store = new StateStore(temporary);
  store.data.profiles = [profile({ id: fixtureId, name: 'Password acceptance fixture', host: '127.0.0.1', port, username: 'fixture', auth: 'password', rememberPassword: false, sessionMode: 'standard', autoConnect: false, record: false, scrollback: 1000 })];
  store.data.pins[`127.0.0.1:${port}`] = fingerprint(utils.parseKey(hostKey).getPublicSSH()); store.save();
}
async function connectDebugger(url, port) {
  const parsed = new URL(url);
  assert.ok(parsed.protocol === 'ws:' && parsed.hostname === '127.0.0.1' && Number(parsed.port) === port && parsed.pathname.startsWith('/devtools/page/'), 'Only the owned loopback debugger can be used.');
  ws = new WebSocket(url); await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.close(); reject(new Error('Owned debugger handshake timed out.')); }, 10000);
    ws.onopen = () => { clearTimeout(timer); resolve(); }; ws.onerror = () => { clearTimeout(timer); reject(new Error('Owned debugger handshake failed.')); };
  });
  let nextId = 1; const pending = new Map();
  ws.onmessage = event => {
    const message = JSON.parse(event.data), task = pending.get(message.id); if (!task) return;
    pending.delete(message.id); clearTimeout(task.timer);
    message.error ? task.reject(new Error('Owned debugger command failed.')) : task.resolve(message.result);
  };
  ws.onclose = () => { for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('Owned debugger closed.')); } pending.clear(); };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++, timer = setTimeout(() => { pending.delete(id); reject(new Error('Owned debugger command timed out.')); }, 25000);
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      const details = result.exceptionDetails, error = new Error('Packaged UI evaluation failed.');
      error.debuggerException = {
        className: /^[A-Za-z_][A-Za-z0-9_]{0,80}$/.test(details.exception?.className || '') ? details.exception.className : null,
        line: Number.isInteger(details.lineNumber) ? details.lineNumber : null,
        column: Number.isInteger(details.columnNumber) ? details.columnNumber : null
      };
      throw error;
    }
    return result.result.value;
  };
  const wait = async (expression, name) => {
    for (let count = 0; count < 200; count++) {
      try { if (await evaluate(expression)) return; } catch (error) { error.fixtureStep = name; throw error; }
      await delay(100);
    }
    const error = new Error(name); error.fixtureStep = name; throw error;
  };
  await send('Runtime.enable'); await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  return { send, evaluate, wait };
}
async function launch() {
  const port = await freePort();
  const args = [quotePowerShell('"--user-data-dir=' + temporary + '"'), quotePowerShell('--remote-debugging-port=' + port), "'--remote-debugging-address=127.0.0.1'"];
  const result = await powershell(`$ErrorActionPreference='Stop'; $p=Start-Process -FilePath ${quotePowerShell(exe)} -ArgumentList @(${args.join(',')}) -WindowStyle Hidden -PassThru; @{pid=$p.Id;startedTicks=$p.StartTime.ToUniversalTime().Ticks.ToString()}|ConvertTo-Json -Compress`);
  const owner = JSON.parse(result); assert.ok(Number.isInteger(owner.pid) && owner.pid > 0 && /^\d+$/.test(owner.startedTicks), 'Owned app launch must report its process identity.');
  owners.push(owner); currentOwner = owner; report.ownedAppPIDs.push(owner.pid); persistReport();
  const deadline = Date.now() + 25000; let page;
  while (Date.now() < deadline) {
    try { const list = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) })).json(); page = list.find(item => item.type === 'page' && item.url === 'nerdsshell://app/ui/index.html'); if (page) break; } catch {}
    await delay(100);
  }
  if (!page) throw new Error('Owned packaged UI did not become available.');
  control = await connectDebugger(page.webSocketDebuggerUrl, port);
  await control.wait(`typeof profiles!=='undefined'&&profiles.size===1&&profiles.has(${literal(fixtureId)})`, 'Disposable profile did not initialize.');
  check('Owned app uses the expected packaged version and explicit disposable data directory', await control.evaluate(`(async()=>{const state=await api.state();return state.version===${literal(metadata.version)}&&state.dataDirectory.toLowerCase()===${literal(temporary.toLowerCase())}&&state.profiles.length===1&&state.profiles[0].id===${literal(fixtureId)};})()`));
  await control.evaluate(`window.__passwordSmokePromptCount=0;api.onEvent(event=>{if(event.type==='prompt')window.__passwordSmokePromptCount++;});true`);
}
function vaultRecords() {
  const filename = path.join(temporary, FILE_NAME); if (!fs.existsSync(filename)) return [];
  const stat = fs.lstatSync(filename); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size < 2 * 1024 * 1024, 'Credential output must be a bounded regular file.');
  const data = JSON.parse(fs.readFileSync(filename, 'utf8')); assert.ok(data.version === 1 && Array.isArray(data.records), 'Credential output must have the expected format.'); return data.records;
}
async function privacyCheck(label) {
  const passwords = [firstPassword, replacementPassword, invalidPassword];
  const privateFiles = ['settings.json', 'settings.json.backup', FILE_NAME].filter(filename => fs.existsSync(path.join(temporary, filename)));
  check(label + ': settings and credential files contain no plaintext or unencrypted base64 password markers', privateFiles.every(filename => {
    const bytes = fs.readFileSync(path.join(temporary, filename));
    return passwords.every(password => !bytes.includes(Buffer.from(password)) && !bytes.includes(Buffer.from(Buffer.from(password).toString('base64'))));
  }));
  check(label + ': renderer state exposes no password or ciphertext', await control.evaluate(`(async()=>{const text=JSON.stringify(await api.state());return !/"(?:password|ciphertext|secrets)":/.test(text)&&${literal(passwords)}.every(value=>!text.includes(value));})()`));
}
async function beginConnect() {
  await control.evaluate(`window.__passwordSmokeResult={done:false,ok:false};connectProfile(${literal(fixtureId)}).then(()=>{window.__passwordSmokeResult={done:true,ok:true};},()=>{window.__passwordSmokeResult={done:true,ok:false};});true`);
}
async function waitPrompt(label) {
  await control.wait(`$('promptDialog').open`, label);
  check('Only the SSH login password prompt offers remembering', await control.evaluate(`!$('promptRememberField').hidden&&$('promptValue').type==='password'&&promptProfileId===${literal(fixtureId)}`));
}
async function answer(password, remember) {
  await control.evaluate(`$('promptValue').value=${literal(password)};$('promptRemember').checked=${literal(remember)};$('promptForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));true`);
}
async function expectConnect(success, label) {
  await control.wait('window.__passwordSmokeResult.done', label);
  check(label, await control.evaluate(`window.__passwordSmokeResult.ok===${literal(success)}`));
  if (success) await control.wait(`[...views.values()].some(view=>view.ready&&view.pane.profileId===${literal(fixtureId)})&&statuses.get(${literal(fixtureId)})?.state==='connected'`, 'Owned shell did not become live.');
}
async function dropNetwork(label) {
  for (const peer of peers) peer.end();
  await control.wait(`statuses.get(${literal(fixtureId)})?.state==='disconnected'&&[...views.values()].filter(view=>view.pane.profileId===${literal(fixtureId)}).every(view=>!view.ready)`, 'Owned transport loss did not reach renderer state.');
  await control.wait(`!$('promptDialog').open`, 'A disconnected transport left a prompt open.');
  for (let count = 0; count < 100 && peers.size; count++) await delay(50);
  check(label, peers.size === 0);
}
async function closeApp() {
  await dropNetwork('Owned Standard transport is closed before app quit, avoiding native closure dialogs');
  try { await control.send('Browser.close'); } catch {} // Closing its debugger is expected during quit.
  for (let count = 0; count < 100 && alive(currentOwner.pid); count++) await delay(100);
  check('Owned packaged app exited normally before any relaunch', !alive(currentOwner.pid));
  ws?.close(); control = null; currentOwner = null;
}
async function main() {
  if (process.platform !== 'win32') throw new Error('Native password acceptance requires Windows.');
  assert.ok(!output.startsWith(path.resolve(temporary) + path.sep) && output !== path.resolve(temporary), 'Reports must be outside disposable user data.');
  report.executableSha256 = createHash('sha256').update(fs.readFileSync(exe)).digest('hex');
  report.asarSha256 = createHash('sha256').update(fs.readFileSync(path.join(path.dirname(exe), 'resources', 'app.asar'))).digest('hex');
  report.phase = 'First opt-in login'; persistReport(); await createFixture(); await launch();
  check('Existing and new password profiles default to not remembering', await control.evaluate(`profiles.get(${literal(fixtureId)}).rememberPassword===false`));
  await control.evaluate(`editConnection(profiles.get(${literal(fixtureId)}));true`);
  check('Connection editor exposes an unchecked opt-in password preference without a plaintext password field', await control.evaluate(`!$('rememberPasswordField').hidden&&!$('connectionForm').elements.rememberPassword.checked&&!$('connectionForm').elements.password`));
  await control.evaluate(`$('cancelConnection').click();true`);
  await beginConnect(); await waitPrompt('First login prompt did not open.');
  check('First login prompt defaults to not remembering', await control.evaluate(`!$('promptRemember').checked`));
  await answer(firstPassword, true); await expectConnect(true, 'Opt-in login authenticates through the actual packaged SSH transport');
  check('Successful login writes one Windows-encrypted credential record', vaultRecords().length === 1 && vaultRecords()[0].profileId === fixtureId && typeof vaultRecords()[0].ciphertext === 'string');
  check('Submitting a login clears password and consent from the renderer form', await control.evaluate(`$('promptValue').value===''&&!$('promptRemember').checked&&!$('promptDialog').open`));
  await privacyCheck('First login'); await closeApp();

  report.phase = 'Restart and native DPAPI readback'; persistReport(); await launch();
  check('Remember preference survives a genuine packaged app restart', await control.evaluate(`profiles.get(${literal(fixtureId)}).rememberPassword===true`));
  await beginConnect(); await expectConnect(true, 'Restarted app authenticates using its saved DPAPI-protected password');
  check('Restarted app needs no authentication prompt', await control.evaluate('window.__passwordSmokePromptCount===0'));
  await privacyCheck('Restarted login');

  report.phase = 'Forget while connected'; persistReport();
  const closedBeforeForget = metrics.closedShells, echoedBeforeForget = metrics.echoedInputs;
  check('Password connection controls expose Forget password', await control.evaluate(`[...$('connections').querySelectorAll('button')].some(button=>button.textContent==='Forget password')`));
  await control.evaluate(`[...$('connections').querySelectorAll('button')].find(button=>button.textContent==='Forget password').click();true`);
  await control.wait(`profiles.get(${literal(fixtureId)}).rememberPassword===false`, 'Forget did not update the renderer preference.');
  check('Forget removes the stored credential', vaultRecords().length === 0);
  check('Forget leaves its live SSH shell intact', metrics.closedShells === closedBeforeForget && await control.evaluate(`statuses.get(${literal(fixtureId)})?.state==='connected'&&[...views.values()].some(view=>view.ready&&view.pane.profileId===${literal(fixtureId)})`));
  const echoMarker = 'FORGET_LEAVES_OWNED_SHELL_RUNNING';
  await control.evaluate(`api.input([...views.values()].find(view=>view.ready&&view.pane.profileId===${literal(fixtureId)}).pane.key,${literal(echoMarker + '\r')})`);
  await control.wait(`[...views.values()].some(view=>view.ready&&view.pane.profileId===${literal(fixtureId)}&&Array.from({length:view.terminal.buffer.active.length},(_,index)=>view.terminal.buffer.active.getLine(index)?.translateToString(true)||'').join(${literal('\n')}).includes(${literal(echoMarker)}))`, 'Forgotten-password shell did not echo fresh input.');
  check('Forgotten-password shell still accepts fresh input', metrics.echoedInputs > echoedBeforeForget && metrics.closedShells === closedBeforeForget);
  await privacyCheck('Forget'); await dropNetwork('Owned network loss clears the active transport after Forget');

  report.phase = 'Declined consent and rejected password'; persistReport();
  await beginConnect(); await waitPrompt('Reconnect after Forget did not prompt again.');
  check('Forget turns remembering off for the next login', await control.evaluate(`!$('promptRemember').checked`));
  await answer(firstPassword, false); await expectConnect(true, 'Declined consent still permits password authentication');
  check('Declined consent saves no credential', vaultRecords().length === 0); await dropNetwork('Owned declined-consent connection closes cleanly');
  await beginConnect(); await waitPrompt('Invalid-password attempt did not prompt.');
  const rejectedBefore = metrics.rejectedPasswords;
  await answer(invalidPassword, true); await expectConnect(false, 'An invalid password fails authentication through the packaged SSH transport');
  check('Invalid login is rejected by the fixture and never saved', metrics.rejectedPasswords > rejectedBefore && vaultRecords().length === 0);
  await privacyCheck('Invalid login');

  report.phase = 'Saved password rejection and fresh replacement'; persistReport();
  await beginConnect(); await waitPrompt('Valid replacement attempt did not prompt.');
  await answer(firstPassword, true); await expectConnect(true, 'A valid password can be remembered after an unsuccessful attempt');
  check('Only successful authentication restores the saved record', vaultRecords().length === 1);
  await dropNetwork('Owned transport closes before testing a changed server password');
  acceptedPassword = replacementPassword;
  const promptsBeforeRejection = await control.evaluate('window.__passwordSmokePromptCount'), previousRejected = metrics.rejectedPasswords;
  await beginConnect(); await expectConnect(false, 'A server-rejected saved password fails without creating a shell');
  check('Rejected saved password is attempted without prompting and then evicted', metrics.rejectedPasswords > previousRejected && vaultRecords().length === 0 && await control.evaluate(`window.__passwordSmokePromptCount===${literal(promptsBeforeRejection)}`));
  await beginConnect(); await waitPrompt('Evicted saved password did not permit a fresh prompt.');
  await answer(replacementPassword, true); await expectConnect(true, 'A fresh prompt accepts and remembers the server replacement password');
  check('Fresh successful replacement saves exactly one bound record', vaultRecords().length === 1 && vaultRecords()[0].profileId === fixtureId);
  await privacyCheck('Replacement login');
  check('Fixture executes no unrequested server command', metrics.unexpectedExec === 0);
  await closeApp(); report.phase = 'Completed'; report.status = 'passed'; persistReport();
  console.log(`Packaged password acceptance passed (${report.checks.length} checks).`);
}
async function cleanup() {
  try { ws?.close(); } catch {}
  let failed = false;
  for (const owner of owners) try { await stopOwner(owner); } catch { failed = true; }
  for (const peer of peers) peer.end();
  for (let count = 0; count < 40 && peers.size; count++) await delay(50);
  // These sockets were accepted only by this generated loopback server.
  for (const peer of peers) peer._sock?.destroy();
  if (server) await new Promise(resolve => server.close(resolve));
  if (failed || owners.some(owner => alive(owner.pid))) throw new Error('An owned process could not be verified for cleanup.');
  await delay(300);
  const resolved = path.resolve(temporary), tempRoot = path.resolve(os.tmpdir()) + path.sep;
  assert.ok(resolved.startsWith(tempRoot) && path.basename(resolved).startsWith('nerdsshell-password-') && !fs.lstatSync(resolved).isSymbolicLink() && fs.realpathSync.native(resolved) === createdTemporary, 'Cleanup is confined to the exact owned temporary data directory.');
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
  report.temporaryDataRemoved = true; report.allOwnedAppPIDsStopped = owners.every(owner => !alive(owner.pid)); persistReport();
}
main().catch(error => {
  report.status = 'failed'; report.failure = { phase: report.phase || 'Initialization', step: error.fixtureStep || null, type: error.name, code: typeof error.code === 'string' ? error.code : null, debuggerException: error.debuggerException || null };
  console.error(`Packaged password acceptance failed during ${report.failure.phase}.`); process.exitCode = 1;
}).finally(async () => {
  try { await cleanup(); } catch { report.status = 'failed'; report.cleanupFailed = true; persistReport(); console.error('Owned password acceptance cleanup failed.'); process.exitCode = 1; }
});
