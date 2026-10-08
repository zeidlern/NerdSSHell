'use strict';
// Exact protected Windows executable, genuine renderer/preload/main and pointer/keyboard
// events. Only generated loopback appliance peers and explicitly owned disposable data.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os');
const path = require('node:path'), net = require('node:net');
const { spawn } = require('node:child_process');
const { generateKeyPairSync, createHash } = require('node:crypto');
const { Server, utils } = require('ssh2');
const { StateStore } = require('../src/storage.cjs');
const { fingerprint } = require('../src/core.cjs');
const { FILE_NAME } = require('../src/password-store.cjs');
const root = path.resolve(__dirname, '..'), metadata = require('../package.json'), options = new Map();
for (let index = 2; index < process.argv.length; index++) {
  const name = process.argv[index], value = process.argv[++index];
  if (!['--exe', '--output'].includes(name) || options.has(name) || !value || !path.isAbsolute(value)) throw Error('Use --exe and --output once each, with absolute paths.');
  options.set(name, value);
}
const exe = fs.realpathSync.native(options.get('--exe') || path.join(root, 'dist', 'win-unpacked', 'NerdSSHell.exe'));
assert.ok(fs.statSync(exe).isFile() && path.basename(exe).toLowerCase() === 'nerdsshell.exe', 'Select an existing NerdSSHell.exe.');
const output = path.resolve(options.get('--output') || path.join(root, '.local', 'packaged-quick-connect'));
const temporary = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'nerdsshell-quick-gui-')));
const createdTemporary = fs.realpathSync.native(temporary), owners = [], fixtures = [], temporaryIDs = new Set();
const password = 'synthetic-quick-connect-fixture-only';
let ws, control, currentOwner;
const metrics = { connections: 0, authenticationRequests: 0, acceptedPasswords: 0, shells: 0, closedShells: 0,
  execRequests: 0, subsystemRequests: 0, automaticInputBytes: 0, manualInputBytes: 0, liveSockets: 0, liveChannels: 0 };
const report = { status: 'running', expectedVersion: metadata.version, checks: [], metrics, ownedAppPIDs: [],
  scope: 'Actual protected Windows GUI/preload/main and real loopback SSH with synthetic appliance peers. CDP pointer/keyboard events; no physical mouse, real device/vendor interoperability, clipboard, installer or UAC claim.' };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const literal = value => JSON.stringify(value).replace(/[<>\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const quotePowerShell = value => "'" + value.replaceAll("'", "''") + "'";
function persistReport() { fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2)); }
function check(name, value = true) { if (value !== true) { const error = Error(name); error.fixtureStep = name; throw error; } report.checks.push(name); persistReport(); console.log(name); }
async function until(predicate, label) { for (let i = 0; i < 200; i++) { if (predicate()) return; await delay(50); } const error = Error(label); error.fixtureStep = label; throw error; }
async function powershell(command, timeout = 15000) {
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.resume();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(Error('Owned process helper timed out.')); }, timeout);
    child.once('error', () => { clearTimeout(timer); reject(Error('Owned process helper could not launch.')); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve(stdout.trim()) : reject(Error('Owned process helper failed.')); });
  });
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; } }
async function stopOwner(owner) {
  if (!owner || !alive(owner.pid)) return;
  assert.ok(owners.includes(owner) && Number.isInteger(owner.pid) && owner.pid > 0, 'Stop only a recorded owned process.');
  await powershell(`$ErrorActionPreference='Stop'; $p=Get-Process -Id ${owner.pid} -ErrorAction SilentlyContinue; if($null -ne $p){$w=Get-CimInstance Win32_Process -Filter 'ProcessId=${owner.pid}'; if($p.StartTime.ToUniversalTime().Ticks.ToString() -ne ${quotePowerShell(owner.startedTicks)} -or [IO.Path]::GetFullPath($p.Path) -ne ${quotePowerShell(exe)} -or !$w.CommandLine.Contains(${quotePowerShell('--user-data-dir='+temporary)})){throw 'Owned identity changed.'}; Stop-Process -InputObject $p -Force}`);
}
async function freePort() { const socket = net.createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve)); const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return port; }
async function createFixture(label) {
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs1' });
  const fixture = { label, peers: new Set(), channels: new Set(), connections: 0, authRequests: 0, holdAuthentication: false, received: '' };
  fixture.fingerprint = fingerprint(utils.parseKey(key).getPublicSSH());
  fixture.server = new Server({ hostKeys: [key] }, peer => {
    fixture.peers.add(peer); fixture.connections++; metrics.connections++; metrics.liveSockets++; peer._sock.setNoDelay(true);
    peer.on('error', () => {}); peer.on('close', () => { fixture.peers.delete(peer); metrics.liveSockets--; });
    peer.on('authentication', request => {
      fixture.authRequests++; metrics.authenticationRequests++;
      if (fixture.holdAuthentication) return;
      if (request.method === 'password' && request.username === 'fixture' && request.password === password) { metrics.acceptedPasswords++; request.accept(); }
      else request.reject(['password']);
    });
    peer.on('ready', () => peer.on('session', acceptSession => {
      const session = acceptSession(); session.on('pty', acceptPty => acceptPty()); session.on('window-change', accept => accept?.());
      session.on('exec', (_accept, reject) => { metrics.execRequests++; reject(); });
      const rejectSubsystem = (_accept, reject) => { metrics.subsystemRequests++; reject(); };
      session.on('subsystem', rejectSubsystem); session.on('sftp', rejectSubsystem);
      session.on('shell', acceptShell => {
        const stream = acceptShell(); fixture.channels.add(stream); metrics.shells++; metrics.liveChannels++; stream.on('error', () => {});
        let retired = false; const retire = () => { if (retired) return; retired = true; fixture.channels.delete(stream); metrics.closedShells++; metrics.liveChannels--; };
        stream.on('close', retire); peer.once('close', retire);
        stream.write('SYNTHETIC_APPLIANCE_' + label + '_READY> ');
        stream.on('data', bytes => { if (stream.intentionalInput) metrics.manualInputBytes += bytes.length; else metrics.automaticInputBytes += bytes.length; fixture.received += bytes.toString(); assert.ok(fixture.received.length < 16384); stream.write(bytes); });
        stream.on('end', () => stream.end());
      });
    }));
  });
  fixture.server.on('error', () => {}); await new Promise(resolve => fixture.server.listen(0, '127.0.0.1', resolve));
  fixture.port = fixture.server.address().port; fixtures.push(fixture); return fixture;
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
  const wait = async (expression, name, allowContextChange = false) => {
    for (let count = 0; count < 200; count++) {
      try { if (await evaluate(expression)) return; } catch (error) { if (!allowContextChange) { error.fixtureStep = name; throw error; } }
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
  const owner = JSON.parse(result); assert.ok(Number.isInteger(owner.pid) && owner.pid > 0 && /^\d+$/.test(owner.startedTicks));
  owners.push(owner); currentOwner = owner; report.ownedAppPIDs.push(owner.pid); persistReport();
  const deadline = Date.now() + 25000; let page;
  while (Date.now() < deadline) { try { const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) })).json(); page = pages.find(item => item.type === 'page' && item.url === 'nerdsshell://app/ui/index.html'); if (page) break; } catch {} await delay(100); }
  if (!page) throw Error('Owned packaged UI did not initialize.');
  control = await connectDebugger(page.webSocketDebuggerUrl, port);
  await control.wait(`typeof profiles!=='undefined'&&window.NerdSSHellQuick&&!$('quickConnect').disabled`, 'Quick Connect did not initialize.');
  check('Protected packaged app uses the expected version and explicit disposable directory', await control.evaluate(`(async()=>{const s=await api.state();return s.version===${literal(metadata.version)}&&s.dataDirectory.toLowerCase()===${literal(temporary.toLowerCase())}&&s.profiles.length===0;})()`));
}
async function pointer(expression) {
  const point = await control.evaluate(`(()=>{const node=${expression};if(!node)throw Error('Fixture control missing');node.scrollIntoView({block:'nearest'});const r=node.getBoundingClientRect();if(r.width<1||r.height<1)throw Error('Fixture control hidden');return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
  for (const type of ['mousePressed', 'mouseReleased']) await control.send('Input.dispatchMouseEvent', { type, button: 'left', clickCount: 1, ...point });
}
async function click(selector) { return pointer(`document.querySelector(${literal(selector)})`); }
async function key(key, code, windowsVirtualKeyCode, modifiers = 0) {
  for (const type of ['keyDown', 'keyUp']) await control.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode, modifiers, ...(key === 'Enter' && type === 'keyDown' ? { text: '\r', unmodifiedText: '\r' } : {}) });
}
async function type(selector, text) { await click(selector); await key('a', 'KeyA', 65, 2); await control.send('Input.insertText', { text }); }
async function settings(fixture, enabled = true) {
  await click('#quickSettings'); await control.wait(`$('quickSettingsDialog').open`, 'Quick defaults dialog did not open.');
  await type('#quickUsername', 'fixture'); await type('#quickPort', String(fixture.port));
  await click('#quickAuth'); await key('Home', 'Home', 36); await key('Enter', 'Enter', 13);
  const checked = await control.evaluate(`$('quickHistoryEnabled').checked`); if (checked !== enabled) await click('#quickHistoryEnabled');
  await click('#quickSettingsSave'); await control.wait(`!$('quickSettingsDialog').open&&!$('quickSettings').disabled`, 'Quick defaults did not save.');
  check('Quick defaults are reusable nonsecret username, port and password-method settings', new StateStore(temporary).data.quickConnect.defaults.username === 'fixture' && new StateStore(temporary).data.quickConnect.defaults.port === fixture.port && new StateStore(temporary).data.quickConnect.defaults.auth === 'password');
}
async function begin(address) {
  const before = await control.evaluate(`[...profiles.keys()]`); await type('#quickAddress', address); await key('Enter', 'Enter', 13);
  await control.wait(`$('promptDialog').open`, 'Temporary login prompt did not open.');
  check('Temporary password prompt offers no Remember password field', await control.evaluate(`promptKind!=='host-trust'&&$('promptValue').type==='password'&&$('promptRememberField').hidden&&!$('promptRemember').checked`));
  const id = await control.evaluate('promptProfileId'); assert.ok(/^quick-[a-f0-9-]{36}$/.test(id) && !before.includes(id)); temporaryIDs.add(id); return id;
}
async function answerPassword() { await type('#promptValue', password); await click('#promptAccept'); }
async function host(fixture, approve = true, expectedAuth) {
  await control.wait(`$('promptDialog').open&&promptKind==='host-trust'`, 'Host verification did not open.');
  check('Host trust shows the generated fingerprint and safe Cancel focus', await control.evaluate(`$('promptMessage').textContent.includes(${literal(fixture.fingerprint)})&&document.activeElement===$('cancelPrompt')&&$('promptRememberField').hidden`));
  check('Pending host approval sends no authentication method or password to the appliance', fixture.authRequests === expectedAuth);
  await click(approve ? '#promptAccept' : '#cancelPrompt');
}
async function settled() { await control.wait(`!$('quickConnect').disabled&&!$('promptDialog').open`, 'Quick attempt did not settle.'); }
async function ready(id) { await settled(); await control.wait(`[...views.values()].some(v=>v.ready&&v.pane.profileId===${literal(id)})`, 'Temporary shell did not open directly.'); return control.evaluate(`[...views.values()].find(v=>v.ready&&v.pane.profileId===${literal(id)}).pane.key`); }
async function resources() { return control.evaluate(`api.workbenchDiagnostics().then(d=>({connections:d.connections.length,prompts:d.pendingPrompts,views:d.connections.reduce((n,c)=>n+c.openViews,0),standard:d.connections.reduce((n,c)=>n+c.standardChannels,0),controls:d.connections.reduce((n,c)=>n+c.controlChannels,0),commands:d.connections.reduce((n,c)=>n+c.pendingCommands,0)}))`); }
function vaultEmpty() { const file = path.join(temporary, FILE_NAME); return !fs.existsSync(file) || JSON.parse(fs.readFileSync(file,'utf8')).records.length === 0; }
function noAutomation(name) { check(name, metrics.execRequests === 0 && metrics.subsystemRequests === 0 && metrics.automaticInputBytes === 0); }
async function privacy(name, expectedSaved = 0) {
  const state = new StateStore(temporary).data, text = JSON.stringify(state), unsaved = [...temporaryIDs].filter(id => !state.profiles.some(p=>p.id===id));
  check(name + ': no temporary saved profiles, credentials or workspace entries', state.profiles.length === expectedSaved && state.profiles.every(p=>p.terminalType==='generic') && vaultEmpty() && unsaved.every(id=>!state.workspace.order.some(k=>k.startsWith(id+'/')) && !state.workspace.slots.some(k=>typeof k==='string'&&k.startsWith(id+'/')) && !state.workspace.active.startsWith(id+'/')));
  check(name + ': no plaintext password in settings or renderer state', !text.includes(password) && await control.evaluate(`api.state().then(s=>!JSON.stringify(s).includes(${literal(password)})&&!/"(?:password|ciphertext|secrets)":/.test(JSON.stringify(s)))`));
}
async function manualInput(fixture, paneKey, marker) {
  for (const stream of fixture.channels) stream.intentionalInput = true;
  await pointer(`views.get(${literal(paneKey)}).host`); await control.send('Input.insertText', { text: marker }); await key('Enter', 'Enter', 13);
  await until(()=>fixture.received.includes(marker), 'Intentional input did not reach its appliance.');
  await control.wait(`(()=>{const v=views.get(${literal(paneKey)});return Array.from({length:v.terminal.buffer.active.length},(_,i)=>v.terminal.buffer.active.getLine(i)?.translateToString(true)||'').join(${literal('\n')}).includes(${literal(marker)});})()`, 'Appliance echo did not reach its owning terminal.');
}
async function closeTab(paneKey, confirm = true) {
  await pointer(`([...$('tabs').children].find(tab=>tab.title===profiles.get(views.get(${literal(paneKey)}).pane.profileId).name+' / '+label(views.get(${literal(paneKey)}).pane))).querySelector('.close-tab')`);
  if (confirm) { await control.wait(`$('promptDialog').open&&promptKind==='confirmation'`, 'Normal Standard closure confirmation did not open.'); await click('#promptAccept'); }
  await control.wait(`!views.has(${literal(paneKey)})`, 'Closed terminal view remained.');
}
async function normalQuit() {
  if (!control || !currentOwner || !alive(currentOwner.pid)) return;
  for (const fixture of fixtures) for (const peer of fixture.peers) peer._sock?.destroy();
  await until(()=>metrics.liveSockets===0&&metrics.liveChannels===0, 'Owned peers did not close for normal quit.');
  try { await control.send('Browser.close'); } catch {}
  await until(()=>!alive(currentOwner.pid), 'Owned app did not quit normally.');
  ws?.close(); control = null; currentOwner = null;
}
async function main() {
  if (process.platform !== 'win32') throw Error('Packaged Quick Connect acceptance requires Windows.');
  assert.ok(output !== path.resolve(temporary) && !output.startsWith(path.resolve(temporary)+path.sep), 'Keep reports outside disposable user data.');
  report.executableSha256=createHash('sha256').update(fs.readFileSync(exe)).digest('hex'); report.asarSha256=createHash('sha256').update(fs.readFileSync(path.join(path.dirname(exe),'resources','app.asar'))).digest('hex');
  const state = new StateStore(temporary); state.data.notifications = { enabled:false,audio:false,desktop:false,visual:false }; state.save();
  const a=await createFixture('A'), b=await createFixture('B'); await launch(); report.runtime = await control.evaluate('api.workbenchDiagnostics().then(d=>d.runtime)'); report.platform = { os: process.platform, architecture: process.arch, release: os.release() };
  report.phase='Reusable defaults and shortcut'; await settings(a); report.baseline=await resources();
  await click('#sidebarToggle'); check('Sidebar can collapse before Quick shortcut',await control.evaluate(`$('connectionSidebar').classList.contains('collapsed')`));
  await key('q','KeyQ',81,3); check('Ctrl+Alt+Q expands the sidebar and focuses the address box',await control.evaluate(`!$('connectionSidebar').classList.contains('collapsed')&&document.activeElement===$('quickAddress')`));
  report.phase='Memory clipboard destination validation'; await type('#quickAddress','preserve-input.invalid');
  const pasteCases = [['LF-separated destinations','router-a.invalid\nrouter-b.invalid'],['CRLF-separated destinations','router-a.invalid\r\nrouter-b.invalid'],['tab control','router-a.invalid\t'],['DEL control','router-a.invalid\x7f']];
  for (const [label,text] of pasteCases) {
    const result=await control.evaluate(`(()=>{const input=$('quickAddress'),before=input.value,data=new DataTransfer();data.setData('text/plain',${literal(text)});const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data});input.dispatchEvent(event);return {blocked:event.defaultPrevented,preserved:input.value===before,inlineError:$('quickStatus').classList.contains('error')&&$('quickStatus').textContent.length>0,profiles:profiles.size};})()`);
    check('Memory clipboard '+label+' is blocked before normalization without replacing input or connecting',result.blocked&&result.preserved&&result.inlineError&&result.profiles===0&&metrics.connections===0);
  }
  check('A single-host memory paste event remains allowed without touching the OS clipboard',await control.evaluate(`(()=>{const input=$('quickAddress'),data=new DataTransfer();data.setData('text/plain','localhost');const event=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data});input.dispatchEvent(event);return !event.defaultPrevented;})()`)&&metrics.connections===0);
  report.clipboardScope='Synthetic renderer ClipboardEvent/DataTransfer only; the fixture never reads or writes the Windows clipboard. Browser default paste insertion is not synthesized.';
  await type('#quickAddress','127.0.0.1; echo forbidden'); await key('Enter','Enter',13); await settled();
  check('Command-shaped addresses fail inline without an SSH connection or profile',metrics.connections===0&&await control.evaluate(`profiles.size===0&&$('quickStatus').classList.contains('error')`));
  report.phase='Unknown host pointer refusal'; const refused=await begin('127.0.0.1'); await answerPassword(); await host(a,false,0); await settled();
  await control.wait(`!profiles.has(${literal(refused)})`, 'Refused temporary entry remained.'); await until(()=>metrics.liveSockets===0,'Refused host socket remained.');
  check('Host refusal creates no history, pin, credential or shell',new StateStore(temporary).data.quickConnect.recent.length===0&&Object.keys(new StateStore(temporary).data.pins).length===0&&vaultEmpty()&&metrics.shells===0);
  report.phase='Bare IP connects directly'; const idA=await begin('127.0.0.1'); await answerPassword(); await host(a,true,0); const keyA=await ready(idA);
  check('Bare IP creates a temporary generic Standard tab with endpoint identity',await control.evaluate(`profiles.get(${literal(idA)}).temporary&&profiles.get(${literal(idA)}).terminalType==='generic'&&views.get(${literal(keyA)}).pane.standard&&views.get(${literal(keyA)}).actionBar.bar.hidden&&label(views.get(${literal(keyA)}).pane).includes('fixture@127.0.0.1')`));
  check('Generic terminal hides Review command while retaining Lock input',await control.evaluate(`(()=>{const wrapper=views.get(${literal(keyA)}).wrapper,lock=wrapper.querySelector('.wb-lock');return ![...wrapper.querySelectorAll('button')].some(button=>button.textContent==='Review command'&&!button.hidden&&button.getClientRects().length>0)&&!!lock&&!lock.hidden&&lock.getClientRects().length>0;})()`));
  const beforeUnsupportedWorkbench=metrics.connections;
  check('Explicit generic workbench target cannot fall back to a local console',await control.evaluate(`(async()=>{const locals=[...views.values()].filter(v=>v.pane.local).length;await window.NerdSSHellWorkbench.open({target:${literal(idA)},code:'synthetic-never-execute'});return !$('workbenchDialog').open&&$('wbCode').value!=='synthetic-never-execute'&&[...views.values()].filter(v=>v.pane.local).length===locals;})()`)&&metrics.connections===beforeUnsupportedWorkbench&&metrics.execRequests===0);
  noAutomation('Opening a generic terminal sends zero exec, SFTP or startup input'); await delay(600); await privacy('Temporary IP connection');
  report.phase='Port override and exact input ownership'; const idB=await begin('127.0.0.1:'+b.port); await answerPassword(); await host(b,true,0); const keyB=await ready(idB);
  check('Address port override uses a second independent appliance transport',a.peers.size===1&&b.peers.size===1&&await control.evaluate(`profiles.get(${literal(idB)}).port===${b.port}&&profiles.get(${literal(idA)}).port===${a.port}`));
  await click('[data-layout-choice="2-side-by-side"]'); await manualInput(a,keyA,'ONLY_APPLIANCE_A'); await manualInput(b,keyB,'ONLY_APPLIANCE_B');
  check('Pointer/keyboard terminal input stays on its exact appliance',a.received.includes('ONLY_APPLIANCE_A')&&!a.received.includes('ONLY_APPLIANCE_B')&&b.received.includes('ONLY_APPLIANCE_B')&&!b.received.includes('ONLY_APPLIANCE_A'));
  noAutomation('Interactive network-device shells still issue no automation');
  report.phase='Cancel pending authentication'; b.holdAuthentication=true; const authBefore=b.authRequests, cancelled=await begin('127.0.0.1:'+b.port); await answerPassword();
  await until(()=>b.authRequests>authBefore,'Held authentication did not reach fixture.'); await control.wait(`!$('promptDialog').open&&!$('quickCancel').hidden`, 'Quick Cancel control did not become available.'); await click('#quickCancel'); await settled();
  await control.wait(`!profiles.has(${literal(cancelled)})`, 'Cancelled temporary entry remained.'); b.holdAuthentication=false;
  check('Cancel connection retires only its pending transport and leaves both live shells',await control.evaluate(`views.get(${literal(keyA)}).ready&&views.get(${literal(keyB)}).ready`)&&a.peers.size===1);
  report.phase='Network loss and retained transcript'; const beforeLoss=metrics.connections; for(const peer of b.peers)peer._sock.destroy();
  await control.wait(`!views.get(${literal(keyB)}).ready&&views.get(${literal(keyB)}).pane.dead`, 'Transport loss did not retire the owned terminal.'); await until(()=>b.peers.size===0&&b.channels.size===0,'Lost appliance resources remained.'); await delay(500);
  check('Network loss keeps the ended transcript without reconnecting or affecting its sibling',metrics.connections===beforeLoss&&await control.evaluate(`profiles.has(${literal(idB)})&&profiles.get(${literal(idB)}).temporary&&views.get(${literal(keyA)}).ready&&Array.from({length:views.get(${literal(keyB)}).terminal.buffer.active.length},(_,i)=>views.get(${literal(keyB)}).terminal.buffer.active.getLine(i)?.translateToString(true)||'').join(${literal('\n')}).includes('ONLY_APPLIANCE_B')`));
  await closeTab(keyB,false); await control.wait(`!profiles.has(${literal(idB)})`, 'Closing final lost transcript retained its temporary entry.');
  check('Final transcript closure removes its temporary runtime', (await resources()).connections===1);
  report.phase='Renderer reload preserves metadata without reconnect or input replay'; const connectionsBeforeReload=metrics.connections, inputsBeforeReload=metrics.manualInputBytes;
  await control.evaluate('window.__quickSmokeBeforeReload=true;true');
  await control.send('Page.reload'); await control.wait(`(()=>{try{return window.__quickSmokeBeforeReload!==true&&typeof profiles!=='undefined'&&profiles.has(${literal(idA)})&&views.has(${literal(keyA)})&&views.get(${literal(keyA)}).ready;}catch{return false;}})()`, 'Reloaded temporary shell did not reattach its existing view.', true);
  check('Renderer reload retains the live generic temporary identity without creating a connection or replaying input',metrics.connections===connectionsBeforeReload&&metrics.manualInputBytes===inputsBeforeReload&&await control.evaluate(`profiles.get(${literal(idA)}).temporary&&views.get(${literal(keyA)}).actionBar.bar.hidden`));
  report.phase='Bare DNS name'; const dnsAuth=a.authRequests, dns=await begin('localhost'); await answerPassword(); await host(a,true,dnsAuth); const dnsKey=await ready(dns);
  check('Bare DNS name resolves with reusable login defaults',await control.evaluate(`profiles.get(${literal(dns)}).host==='localhost'&&profiles.get(${literal(dns)}).port===${a.port}`));
  await closeTab(dnsKey); await control.wait(`!profiles.has(${literal(dns)})`, 'Closed DNS connection retained a temporary profile.');
  report.phase='Save promotion preserves the active terminal'; await control.evaluate(`window.__quickPromotionView=views.get(${literal(keyA)});true`); const beforePromotion=metrics.connections;
  await pointer(`([...$('connections').querySelectorAll('button')].find(button=>button.textContent==='Save connection'))`); await control.wait(`$('entryDialog').open`, 'Save connection naming dialog did not open.'); await type('#entryValue','Saved appliance fixture'); await click('#entryForm button.primary');
  await control.wait(`profiles.get(${literal(idA)})?.temporary!==true&&profiles.get(${literal(idA)})?.name==='Saved appliance fixture'`, 'Quick connection was not promoted.');
  check('Saving keeps the same profile ID, terminal object and verified transport',metrics.connections===beforePromotion&&await control.evaluate(`views.get(${literal(keyA)})===window.__quickPromotionView&&views.get(${literal(keyA)}).ready&&profiles.get(${literal(idA)}).terminalType==='generic'`)&&new StateStore(temporary).data.profiles[0].id===idA);
  await pointer(`([...$('connections').querySelectorAll('button')].find(button=>button.textContent==='+ New'))`); await control.wait(`$('newSessionDialog').open`, 'Saved appliance new-shell dialog did not open.');
  check('Saved generic profiles offer a Standard shell with no Persistent checkbox',await control.evaluate(`$('newSessionPersistence').hidden&&!$('newSessionPersistent').checked`)); await click('#cancelNewSession');
  check('Main IPC refuses appliance persistence, probes and workbench task review',await control.evaluate(`(async()=>{let blocked=0;for(const operation of [()=>api.create(${literal(idA)},'Forbidden',true),()=>api.workbenchDetect(${literal(idA)},${literal(keyA)}),()=>api.workbenchReview(${literal(idA)},{key:${literal(keyA)},code:'printf forbidden'})]){try{await operation();}catch{blocked++;}}return blocked===3&&(await api.workbenchContext()).targets.every(t=>!t.title.includes('Saved appliance fixture'));})()`));
  await privacy('Promoted connection',1); noAutomation('Promotion and saved generic affordances create no appliance commands');
  report.phase='Saved generic reconnect'; await pointer(`[...([...$('connections').querySelectorAll('section.connection')].find(node=>node.querySelector('.connection-head').textContent.includes('Saved appliance fixture'))).querySelectorAll('.connection-actions button')].find(button=>button.textContent==='Disconnect')`);
  await control.wait(`$('promptDialog').open&&promptKind==='confirmation'`, 'Saved generic disconnect did not confirm consequences.'); await click('#promptAccept'); await until(()=>a.peers.size===0,'Saved generic transport did not close.');
  await closeTab(keyA,false); await pointer(`([...$('connections').querySelectorAll('button')].find(button=>button.textContent==='Connect'))`); await control.wait(`$('promptDialog').open&&$('promptValue').type==='password'`, 'Saved generic reconnect did not ask for its password.'); await answerPassword();
  await control.wait(`[...views.values()].some(v=>v.ready&&v.pane.profileId===${literal(idA)})`, 'Saved generic reconnect did not open a plain shell.');
  const savedKey=await control.evaluate(`[...views.values()].find(v=>v.ready&&v.pane.profileId===${literal(idA)}).pane.key`);
  check('Saved generic reconnect creates a fresh Standard shell without probes or persistence',savedKey!==keyA&&await control.evaluate(`views.get(${literal(savedKey)}).pane.standard&&views.get(${literal(savedKey)}).actionBar.bar.hidden`)); noAutomation('Saved generic reconnect remains free of automatic commands');
  await closeTab(savedKey); await until(()=>a.channels.size===0,'Saved generic channel did not close.');
  // A saved profile may retain its idle authenticated transport; close it normally.
  await pointer(`[...([...$('connections').querySelectorAll('section.connection')].find(node=>node.querySelector('.connection-head').textContent.includes('Saved appliance fixture'))).querySelectorAll('.connection-actions button')].find(button=>button.textContent==='Disconnect')`); await until(()=>a.peers.size===0,'Idle saved generic transport did not disconnect.');
  report.phase='Clear and disable recent destinations'; await click('#quickSettings'); await control.wait(`$('quickSettingsDialog').open`, 'History defaults did not open.');
  check('Recent destinations expose only bounded endpoint metadata',new StateStore(temporary).data.quickConnect.recent.length<=50&&new StateStore(temporary).data.quickConnect.recent.every(r=>Object.keys(r).sort().join(',')==='host,port,username'));
  await click('#quickClearHistory'); await control.wait(`$('quickRecent').children.length===0&&!$('quickHistoryEnabled').disabled`, 'Clear recent destinations did not clear autocomplete.'); await click('#quickHistoryEnabled'); await click('#quickSettingsSave'); await settled();
  const last=await begin('127.0.0.1:'+b.port); await answerPassword(); const lastKey=await ready(last);
  check('Disabled history remains empty after another successful connection',new StateStore(temporary).data.quickConnect.defaults.historyEnabled===false&&new StateStore(temporary).data.quickConnect.recent.length===0&&await control.evaluate(`$('quickRecent').children.length===0`));
  await closeTab(lastKey); await control.wait(`!profiles.has(${literal(last)})`, 'Final temporary entry remained after tab close.'); await until(()=>b.peers.size===0&&b.channels.size===0,'Final temporary transport remained.'); await delay(600);
  report.finalResources=await resources(); check('Final temporary cleanup restores zero live views, channels, commands and prompts',report.finalResources.views===0&&report.finalResources.standard===0&&report.finalResources.controls===0&&report.finalResources.commands===0&&report.finalResources.prompts===0&&metrics.liveSockets===0&&metrics.liveChannels===0);
  await privacy('Final stored state',1); noAutomation('All packaged Quick Connect flows send no automated command, SFTP request or startup input');
  await normalQuit(); check('Owned packaged app quits normally',owners.every(owner=>!alive(owner.pid))); report.phase='Completed'; report.status='passed'; persistReport(); console.log(`Packaged Quick Connect acceptance passed (${report.checks.length} checks).`);
}
async function cleanup() {
  // Normal exit first; identity-bound termination is only timeout recovery.
  try { await normalQuit(); } catch {}
  let failed=false; for(const owner of owners)try{await stopOwner(owner);}catch{failed=true;}
  try{ws?.close();}catch{}
  for(const fixture of fixtures)for(const peer of fixture.peers)peer._sock?.destroy();
  for(const fixture of fixtures)await new Promise(resolve=>fixture.server.close(resolve));
  if(failed||owners.some(owner=>alive(owner.pid)))throw Error('Owned process cleanup was not verified.');
  await delay(300); const resolved=path.resolve(temporary), tempRoot=fs.realpathSync.native(os.tmpdir())+path.sep;
  assert.ok(resolved.startsWith(tempRoot)&&path.basename(resolved).startsWith('nerdsshell-quick-gui-')&&!fs.lstatSync(resolved).isSymbolicLink()&&fs.realpathSync.native(resolved)===createdTemporary,'Cleanup must target the original owned temporary directory.');
  // Detect directory links anywhere below this owned fixture before recursive removal.
  const pending=[resolved]; while(pending.length){const directory=pending.pop();for(const name of fs.readdirSync(directory)){const file=path.join(directory,name),stat=fs.lstatSync(file);assert.ok(file.startsWith(resolved+path.sep)&&!stat.isSymbolicLink(),'Owned cleanup refuses nested links.');if(stat.isDirectory()){assert.equal(fs.realpathSync.native(file),path.resolve(file),'Owned cleanup refuses directory redirects.');pending.push(file);}}}
  fs.rmSync(resolved,{recursive:true,force:true,maxRetries:3,retryDelay:300}); report.temporaryDataRemoved=true; report.allOwnedAppPIDsStopped=owners.every(owner=>!alive(owner.pid)); persistReport();
}
main().catch(async error=>{
  report.status='failed';report.failure={phase:report.phase||'Initialization',step:error.fixtureStep||null,type:error.name,code:typeof error.code==='string'?error.code:null,debuggerException:error.debuggerException||null};persistReport();
  try{if(control){const screenshot=await control.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,'failure.png'),Buffer.from(screenshot.data,'base64'));report.fixtureScreenshot='failure.png';persistReport();}}catch{}
  console.error('Packaged Quick Connect acceptance failed during '+report.failure.phase+'.');process.exitCode=1;
}).finally(async()=>{try{await cleanup();}catch{report.status='failed';report.cleanupFailed=true;persistReport();console.error('Owned Quick Connect cleanup failed.');process.exitCode=1;}});
