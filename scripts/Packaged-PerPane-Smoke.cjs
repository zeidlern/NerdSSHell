'use strict';
// Disposable packaged Windows acceptance: actual renderer/preload/IPC + loopback SSH.
// An explicitly selected installed binary still uses only disposable profiles/data.
// No existing profile, external host, or global security setting is changed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { generateKeyPairSync, createHash } = require('node:crypto');
const { Server, utils } = require('ssh2');
const { fingerprint, profile } = require('../src/core.cjs');
const { StateStore } = require('../src/storage.cjs');
const { PROBE } = require('../src/action-catalog.cjs');
const root = path.resolve(__dirname, '..'), metadata = require('../package.json');
const options = new Map(), switches = new Set(['--visible', '--administrator-fixture', '--clipboard-fixture']);
for (let i = 2; i < process.argv.length; i++) {
  const option = process.argv[i];
  if (options.has(option)) throw new Error('Duplicate smoke option: ' + option);
  if (switches.has(option)) options.set(option, true);
  else if (option === '--exe' || option === '--output') {
    const value = process.argv[++i];
    if (!value || value.startsWith('--') || !path.isAbsolute(value)) throw new Error(option + ' requires an absolute path.');
    options.set(option, value);
  } else throw new Error('Unknown smoke option: ' + option);
}
let exe = path.join(root, 'dist/win-unpacked/' + metadata.build.productName + '.exe');
if (options.has('--exe')) {
  exe = fs.realpathSync.native(options.get('--exe'));
  if (!fs.statSync(exe).isFile() || path.basename(exe).toLowerCase() !== 'nerdsshell.exe') throw new Error('--exe must select an existing NerdSSHell.exe.');
}
const visibleFixture = options.has('--visible');
const output = options.has('--output') ? path.resolve(options.get('--output')) : path.join(root, '.local', 'packaged-per-pane');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nerdsshell-per-pane-'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const metrics = { logins: 0, shells: 0, closedShells: 0, exec: 0, inspections: 0, unexpectedExec: 0, sftp: 0, closedSftp: 0, directories: [], resize: [], terminalBaud: [] };
const peers = new Set(), report = { status: 'running', started: new Date().toISOString(), executable: exe, expectedVersion: metadata.version, visibleFixture, appPID: null, checks: [], screenshots: [], metrics, nativeDialogs: 'Unverified: upload/download native dialogs and transfer bytes are covered separately.' };
let server, launcher, appPID, ws;
async function freePort() { const s = net.createServer(); await new Promise(resolve => s.listen(0, '127.0.0.1', resolve)); const p = s.address().port; await new Promise(resolve => s.close(resolve)); return p; }
async function fixture() {
  const hostKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs1' });
  const attrs = { mode: 0o100644, uid: 1, gid: 1, size: 17, atime: 100, mtime: 100 }, dirAttrs = { ...attrs, mode: 0o040755, size: 0 };
  server = new Server({ hostKeys: [hostKey] }, client => {
    peers.add(client); metrics.logins++; client.on('error', () => {}); client.on('close', () => peers.delete(client));
    client.on('authentication', ctx => ctx.method === 'password' && ctx.username === 'fixture' && ctx.password === 'synthetic-loopback-only' ? ctx.accept() : ctx.reject());
    client.on('ready', () => {
      const decipher = client._protocol._decipher, received = decipher._onPayload;
      decipher._onPayload = payload => { const baud = require('./Terminal-Baud-Smoke.cjs').receivedTerminalBaud(payload); if (baud) metrics.terminalBaud.push(baud); return received(payload); };
      client.on('session', accept => {
      const session = accept();
      session.on('exec', (_accept, reject, info) => { metrics.exec++; if (info.command === PROBE) metrics.inspections++; else metrics.unexpectedExec++; reject(); });
      session.on('pty', acceptPty => acceptPty());
      session.on('window-change', (acceptChange, _reject, info) => { metrics.resize.push({ rows: info.rows, cols: info.cols }); acceptChange?.(); });
      session.on('shell', acceptShell => {
        const stream = acceptShell(), id = ++metrics.shells; stream.on('error', () => {});
        stream.on('close', () => metrics.closedShells++);
        stream.write(`SYNTHETIC SHELL ${id}\r\n`); stream.on('data', bytes => stream.write(bytes));
      });
      session.on('sftp', acceptSftp => {
        const sftp = acceptSftp(); metrics.sftp++; sftp.on('error', () => {}); sftp.on('close', () => metrics.closedSftp++);
        const handles = new Map(); let serial = 0;
        sftp.on('REALPATH', (id, value) => { const name = value === '.' ? '/home/fixture' : path.posix.normalize(value); sftp.name(id, [{ filename: name, longname: name, attrs: dirAttrs }]); });
        sftp.on('OPENDIR', (id, directory) => { const handle = Buffer.from(String(++serial)); handles.set(handle.toString(), { directory, listed: false }); metrics.directories.push(directory); sftp.handle(id, handle); });
        sftp.on('READDIR', (id, handle) => {
          const entry = handles.get(handle.toString());
          if (!entry) return sftp.status(id, utils.sftp.STATUS_CODE.FAILURE);
          if (entry.directory === '/slow') return;
          if (entry.directory === '/denied') return sftp.status(id, utils.sftp.STATUS_CODE.PERMISSION_DENIED);
          if (entry.listed) return sftp.status(id, utils.sftp.STATUS_CODE.EOF);
          entry.listed = true; sftp.name(id, [
            { filename: 'folder', longname: 'folder', attrs: dirAttrs },
            { filename: 'marker-' + path.posix.basename(entry.directory) + '.txt', longname: 'marker', attrs },
            { filename: '.hidden.txt', longname: '.hidden.txt', attrs },
            { filename: 'other.txt', longname: 'other.txt', attrs }
          ]);
        });
        sftp.on('CLOSE', (id, handle) => { handles.delete(handle.toString()); sftp.status(id, utils.sftp.STATUS_CODE.OK); });
      });
      });
    });
  });
  server.on('error', () => {}); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port, state = new StateStore(temporary).data;
  state.profiles = ['fixture-a', 'fixture-b'].map(id => profile({ id, name: id === 'fixture-a' ? 'Loopback A' : 'Loopback B', host: '127.0.0.1', port, username: 'fixture', auth: 'password', sessionMode: 'standard', autoConnect: false, record: false, scrollback: 1000, terminalBaud: id === 'fixture-a' ? 9600 : 0 }));
  state.pins[`127.0.0.1:${port}`] = fingerprint(utils.parseKey(hostKey).getPublicSSH());
  fs.writeFileSync(path.join(temporary, 'settings.json'), JSON.stringify(state));
  report.fixture = { address: '127.0.0.1', port, generatedHostKey: true, preverifiedGeneratedPin: true };
}
async function launch(port) {
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const command = `$p=Start-Process -FilePath ${quote(exe)} -ArgumentList @(${quote('"--user-data-dir=' + temporary + '"')},${quote('--remote-debugging-port=' + port)},'--remote-debugging-address=127.0.0.1') -WindowStyle ${visibleFixture ? 'Normal' : 'Hidden'} -PassThru; $p.Id`;
  launcher = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = ''; launcher.stderr.on('data', bytes => { stderr += bytes; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Launcher did not report a PID within 15 seconds: ${stderr}`)), 15000);
    launcher.stdout.on('data', bytes => { stdout += bytes; const id = Number(stdout.trim()); if (Number.isInteger(id) && id > 0) { appPID = id; clearTimeout(timer); resolve(); } });
    launcher.on('error', error => { clearTimeout(timer); reject(error); });
    launcher.on('exit', code => { if (!appPID) { clearTimeout(timer); reject(new Error(`Launch failed (${code}): ${stderr}`)); } });
  });
  report.appPID = appPID; report.debugPort = port;
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2)); console.log(`Owned app PID ${appPID}; debugger port ${port}`);
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try { const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) })).json(); const page = pages.find(p => p.type === 'page' && p.url === 'nerdsshell://app/ui/index.html'); if (page) return page; } catch {}
    await delay(100);
  }
  throw new Error('Isolated packaged app did not expose its own page.');
}
async function cdp(url) {
  ws = new WebSocket(url); await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.close(); reject(new Error('Owned application CDP handshake timed out.')); }, 10000);
    ws.onopen = () => { clearTimeout(timer); resolve(); }; ws.onerror = error => { clearTimeout(timer); reject(error); };
  });
  let next = 1; const pending = new Map();
  ws.onmessage = event => { const value = JSON.parse(event.data), task = pending.get(value.id); if (!task) return; pending.delete(value.id); clearTimeout(task.timer); value.error ? task.reject(new Error(value.error.message)) : task.resolve(value.result); };
  ws.onclose = () => { for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('Owned application CDP connection closed.')); } pending.clear(); };
  return (method, params = {}) => new Promise((resolve, reject) => { const id = next++, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timed out: ${method}`)); }, 25000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })); });
}
// Read logical lines, not a single physical row: narrow panes reflow banners.
function terminalText(view) {
  const buffer = view.terminal.buffer.active; let text = '';
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i); if (!line) continue;
    text += (line.isWrapped ? '' : '\n') + line.translateToString(!buffer.getLine(i + 1)?.isWrapped);
  }
  return text;
}
async function main() {
  if (process.platform !== 'win32') throw new Error('This acceptance harness requires Windows.');
  fs.mkdirSync(output, { recursive: true }); assert.ok(fs.existsSync(exe), 'Run npm run pack first.');
  report.executableSha256 = createHash('sha256').update(fs.readFileSync(exe)).digest('hex');
  report.asarSha256 = createHash('sha256').update(fs.readFileSync(path.join(path.dirname(exe), 'resources', 'app.asar'))).digest('hex');
  await fixture(); const port = await freePort(), target = await launch(port), send = await cdp(target.webSocketDebuggerUrl);
  const evaluate = async expression => { const value = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (value.exceptionDetails) throw new Error(JSON.stringify(value.exceptionDetails)); return value.result.value; };
  const wait = async (expression, message) => { for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await delay(100); } throw new Error(message); };
  const check = (name, value = true) => { assert.equal(value, true, name); report.checks.push(name); fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2)); console.log(name); };
  await send('Runtime.enable');
  check('Packaged renderer CDP evaluates JavaScript', await evaluate('1+1') === 2);
  if (visibleFixture) await send('Page.bringToFront');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await wait('typeof NerdSSHellFiles !== "undefined" && typeof profiles !== "undefined" && profiles.size===2', 'Packaged renderer/profiles did not initialize.');
  const saved = await evaluate('api.state()'); assert.equal(path.resolve(saved.dataDirectory), path.resolve(temporary)); assert.deepEqual(saved.profiles.map(p => p.id), ['fixture-a', 'fixture-b']);
  check('Actual packaged app uses only disposable user-data directory and profiles');
  check('Packaged header and About display the expected source version', saved.version === metadata.version && await evaluate(`$('version').textContent===${JSON.stringify('v' + metadata.version)}&&$('aboutVersion').textContent===${JSON.stringify(metadata.version)}`));
  await evaluate(`$('help').click(); true`);
  check('Packaged Help provides the Wiki, connection guide, troubleshooting, repository, issues and releases', await evaluate(`$('helpDialog').open && JSON.stringify([...$('helpDialog').querySelectorAll('[data-public-link]')].map(b=>b.dataset.publicLink).sort())===${JSON.stringify(JSON.stringify(['manual', 'connections', 'troubleshooting', 'repository', 'issues', 'releases'].sort()))}`));
  check('Packaged Help rejects arbitrary URLs through the actual preload and main IPC', await evaluate(`(async()=>{try{await api.publicLink('https://attacker.invalid/');return false;}catch(e){return /Unknown help destination/.test(e.message);}})()`));
  await evaluate(`$('closeHelp').click(); true`);
  report.version = saved.version;
  await evaluate('maxOpenViews=1; true');
  for (const id of ['fixture-a', 'fixture-b']) {
    await evaluate(`window.__smokeConnect=connectProfile(${JSON.stringify(id)}); true`);
    await wait('$(' + JSON.stringify('promptDialog') + ').open', 'Actual password prompt did not appear.');
    await evaluate(`$('promptValue').value='synthetic-loopback-only'; $('promptForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); true`);
    await evaluate('window.__smokeConnect');
    if (id === 'fixture-a') {
      check('Standard connect consumes its reserved last renderer slot without a stale overflow notice', await evaluate(`views.size===1&&!$('notice').textContent.includes('session(s) remain in the sidebar')`));
      await evaluate('maxOpenViews=64; true');
    }
  }
  await evaluate(`(async()=>{for(const name of ['Pane B','Pane C']){const pane=await api.create('fixture-a',name,false);panes.set(pane.key,pane);await openPane(pane.key,false);}window.__smokeKeys=[...order.filter(k=>k.startsWith('fixture-a/')), ...order.filter(k=>k.startsWith('fixture-b/'))];order=[...__smokeKeys];active=order[3];render();return true;})()`);
  await wait('views.size===4 && [...views.values()].every(v=>v.ready)', 'Four actual shell views did not attach.');
  check('Four real shell channels with three panes sharing one saved connection');
  check('Saved packaged connection baud reaches each new Standard PTY while server-default connection omits both modes', JSON.stringify(metrics.terminalBaud) === JSON.stringify([{input:9600,output:9600},{input:null,output:null},{input:9600,output:9600},{input:9600,output:9600}]));
  const owners = await evaluate('[...__smokeKeys]'); assert.equal(owners.length, 4);
  await evaluate(`window.__smokeTerminalText=${terminalText.toString()}; true`);
  await wait('[...views.values()].every(v=>/SYNTHETIC SHELL [1-4]/.test(__smokeTerminalText(v)))', 'Initial shell banners did not reach all renderers.');
  await evaluate(`window.__smokeBanners=new Map(__smokeKeys.map(k=>[k,__smokeTerminalText(views.get(k)).match(/SYNTHETIC SHELL [1-4]/)[0]])); true`);
  check('Each renderer starts with its own distinct real shell banner', await evaluate('new Set(__smokeBanners.values()).size===4'));
  const control = (i, name) => `views.get(__smokeKeys[${i}]).wrapper.querySelector('[data-file="${name}"]')`;
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await evaluate(`$('layoutFour').click(); for(const key of __smokeKeys)views.get(key).wrapper.querySelector('.pane-files-toggle').click(); true`);
  await wait('[...views.values()].every(v=>!v.files.loading&&v.files.directory!=="~")', 'Initial file listings did not complete.');
  for (let i = 0; i < 4; i++) {
    await evaluate(`${control(i, 'path')}.value='/project-${i}'; ${control(i, 'go')}.click(); true`);
    await wait(`views.get(__smokeKeys[${i}]).files.directory==='/project-${i}' && !views.get(__smokeKeys[${i}]).files.loading`, 'Independent navigation failed.');
    await evaluate(`${control(i, 'dock')}.value='${i % 2 ? 'bottom' : 'right'}'; ${control(i, 'dock')}.dispatchEvent(new Event('change',{bubbles:true})); ${control(i, 'filter')}.value='${i === 0 ? 'marker' : ''}'; ${control(i, 'filter')}.dispatchEvent(new Event('input',{bubbles:true})); ${control(i, 'hidden')}.checked=${i === 2}; ${control(i, 'hidden')}.dispatchEvent(new Event('change',{bubbles:true})); true`);
  }
  check('Independent paths, text filters, hidden-file settings and right/below docks', await evaluate(`[...__smokeKeys].every((k,i)=>{const f=views.get(k).files;return f.directory==='/project-'+i && f.dock===(i%2?'bottom':'right') && f.filter===(i===0?'marker':'') && f.hidden===(i===2);})`));
  // Use CDP pointer input on the actual divider, followed by actual keyboard focus.
  const grip = await evaluate(`(()=>{const r=${control(0, 'grip')}.getBoundingClientRect();return {x:r.x+3,y:r.y+r.height/2};})()`);
  const before = await evaluate('[...__smokeKeys].map(k=>({width:views.get(k).files.width,height:views.get(k).files.height}))');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...grip, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: grip.x - 35, y: grip.y, button: 'left', buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: grip.x - 35, y: grip.y, button: 'left', clickCount: 1 });
  const after = await evaluate('[...__smokeKeys].map(k=>({width:views.get(k).files.width,height:views.get(k).files.height}))');
  assert.notEqual(after[0].width, before[0].width); assert.deepEqual(after.slice(1), before.slice(1)); check('Pointer splitter changes only its owning browser');
  await evaluate(`${control(1, 'grip')}.focus(); true`); await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowUp', code: 'ArrowUp' }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowUp', code: 'ArrowUp' });
  check('Keyboard divider resizes its below-docked browser', await evaluate(`views.get(__smokeKeys[1]).files.height!==${before[1].height}`));
  const layoutState = await evaluate('({layout,twoPaneOrientation,order:[...order]})');
  await evaluate(`${control(2, 'path')}.focus(); ${control(2, 'path')}.value='/editing-unsubmitted'; ${control(2, 'path')}.setSelectionRange(5,5); true`);
  check('Keyboard entering browser activates its owner and keeps edited path/caret', await evaluate(`active===__smokeKeys[2] && document.activeElement===${control(2, 'path')} && document.activeElement.value==='/editing-unsubmitted' && document.activeElement.selectionStart===5 && layout===4`));
  assert.deepEqual(await evaluate('({layout,twoPaneOrientation,order:[...order]})'), layoutState);
  await evaluate(`views.get(__smokeKeys[2]).wrapper.querySelector('.pane-files-toggle').click(); true`); check('Per-session File SFTP button affects its owner only', await evaluate('!views.get(__smokeKeys[2]).files.visible && __smokeKeys.filter((_,i)=>i!==2).every(k=>views.get(k).files.visible)'));
  await evaluate(`views.get(__smokeKeys[2]).wrapper.querySelector('.pane-files-toggle').click(); true`); await wait('!views.get(__smokeKeys[2]).files.loading', 'Reopened browser did not refresh.');
  await evaluate(`views.get(__smokeKeys[0]).wrapper.querySelector('.file-entry').click(); ${control(0, 'filter')}.value='missing'; ${control(0, 'filter')}.dispatchEvent(new Event('input',{bubbles:true})); true`);
  check('Filtering a selected file out disables Download and clears its target', await evaluate(`${control(0, 'download')}.disabled && views.get(__smokeKeys[0]).files.selectedPath===null`));
  await evaluate(`${control(0, 'filter')}.value='marker'; ${control(0, 'filter')}.dispatchEvent(new Event('input',{bubbles:true})); true`);
  await evaluate(`views.get(__smokeKeys[0]).files.load('/slow'); true`); await wait('views.get(__smokeKeys[0]).files.loading', 'Slow listing did not start.');
  await delay(100); await evaluate(`views.get(__smokeKeys[0]).wrapper.querySelector('.pane-files-toggle').click(); true`);
  check('Collapsing slow listing leaves sibling browsers and shells connected', await evaluate(`!views.get(__smokeKeys[0]).files.loading && __smokeKeys.slice(1).every(k=>views.get(k).files.visible&&views.get(k).files.connected) && [...views.values()].every(v=>v.ready)`));
  await evaluate(`views.get(__smokeKeys[0]).wrapper.querySelector('.pane-files-toggle').click(); true`); await wait('!views.get(__smokeKeys[0]).files.loading', 'Cancelled browser did not refresh preserved folder.');
  await evaluate(`(()=>{const tabs=[...$('tabs').children], data=new DataTransfer();tabs[0].dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:data}));tabs[3].dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));return true;})()`);
  check('Actual tab drop reorders views while browsers retain owners and state', await evaluate(`order[3]===__smokeKeys[0] && __smokeKeys.every((k,i)=>views.get(k).files.key===k && views.get(k).files.directory==='/project-'+i)`));
  const screenshot = async name => {
    // Local home listings are live PC metadata: mask only the fixture screenshots.
    await evaluate(`document.querySelectorAll('.file-local').forEach(node=>node.style.visibility='hidden'); true`);
    try { await delay(200); const data = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); const file = path.join(output, name + '.png'); fs.writeFileSync(file, Buffer.from(data.data, 'base64')); report.screenshots.push(file); }
    finally { await evaluate(`document.querySelectorAll('.file-local').forEach(node=>node.style.visibility=''); true`); }
  };
  for (const dimensions of [[1920, 1080], [900, 600]]) {
    await send('Emulation.setDeviceMetricsOverride', { width: dimensions[0], height: dimensions[1], deviceScaleFactor: 1, mobile: false });
    for (const [size, orientation, name] of [[1, null, 'single'], [2, 'side-by-side', 'side-by-side'], [2, 'stacked', 'stacked'], [4, null, 'four']]) {
      const choice = size === 2 ? '2-' + orientation : String(size);
      await evaluate(`document.querySelector('[data-layout-choice="'+${JSON.stringify(choice)}+'"]').click(); true`); await delay(150);
      check(`${dimensions.join('x')}: ${name} layout retains browser ownership`, await evaluate(`__smokeKeys.every((k,i)=>views.get(k).files.key===k&&views.get(k).files.directory==='/project-'+i) && [...views.values()].filter(v=>!v.wrapper.hidden).every(v=>{const r=v.host.getBoundingClientRect();return r.width>40&&r.height>25;})`));
      check(`${dimensions.join('x')}: ${name} browsers fit inside their terminal panes`, await evaluate(`[...views.values()].filter(v=>!v.wrapper.hidden).every(v=>{const b=v.wrapper.querySelector('.pane-body').getBoundingClientRect(),d=v.wrapper.querySelector('.file-drawer').getBoundingClientRect();return d.width>0&&d.height>0&&d.x>=b.x-1&&d.y>=b.y-1&&d.right<=b.right+1&&d.bottom<=b.bottom+1&&(v.files.dock==='right'?d.width<=b.width*.65+1:d.height<=b.height*.65+1);})`));
      const controlGeometry = await evaluate(`[...views.values()].filter(v=>!v.wrapper.hidden).map(v=>{const drawer=v.wrapper.querySelector('.file-drawer'),actions=drawer.querySelector('.file-actions').getBoundingClientRect(),list=drawer.querySelector('.file-list').getBoundingClientRect(),controls=drawer.querySelector('.file-controls').getBoundingClientRect();return {key:v.pane.key,dock:v.files.dock,listBottom:list.bottom,controlsBottom:controls.bottom,actionsTop:actions.top};})`);
      if (!controlGeometry.every(g => g.listBottom <= g.actionsTop + 1 && g.controlsBottom <= g.actionsTop + 1)) { report.overlapGeometry = controlGeometry; await screenshot(dimensions.join('x') + '-' + name + '-overlap'); }
      check(`${dimensions.join('x')}: ${name} file controls do not overlap transfer actions`, controlGeometry.every(g => g.listBottom <= g.actionsTop + 1 && g.controlsBottom <= g.actionsTop + 1));
      await screenshot(dimensions.join('x') + '-' + name);
    }
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,shiftKey:true,bubbles:true,cancelable:true})); views.get(active).wrapper.querySelector('.pane-title').dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); true`);
    check(`${dimensions.join('x')}: removed focus shortcut and title double-click cannot hide split panes`, await evaluate(`layout===4 && [...views.values()].filter(v=>!v.wrapper.hidden).length===4 && views.get(active).files.visible`));
  }
  await wait('__smokeKeys.every(k=>__smokeTerminalText(views.get(k)).includes(__smokeBanners.get(k)))', 'Real shell banners did not survive renderer reflow.');
  check('Every original shell banner survives narrow-pane reflow under its own view key');
  assert.equal(metrics.logins, 2); assert.equal(metrics.shells, 4); assert.equal(metrics.closedShells, 0); assert.equal(metrics.unexpectedExec, 0); assert.equal(metrics.exec, metrics.inspections); assert.ok(metrics.inspections>=2 && metrics.inspections<=4); assert.ok(metrics.resize.length > 0);
  check('Verified transport reused; only bounded read-only OS inspections, no task/tmux requests');
  // This opt-in test overwrites/reads only synthetic clipboard contents on a CI
  // runner. A local user must explicitly opt in; never read an existing clipboard.
  if (process.env.GITHUB_ACTIONS === 'true' || process.argv.includes('--clipboard-fixture')) {
    await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    await evaluate(`views.get(active).files.show(false); $('layoutOne').click(); true`);
    await wait('views.get(active).terminal.cols>=80', 'Clipboard fixture terminal did not expand.');
    await evaluate(`api.input(active,${JSON.stringify('\r\nAUTOCOPYCHECK42\r\n')})`);
    await wait('__smokeTerminalText(views.get(active)).includes("AUTOCOPYCHECK42")', 'Clipboard fixture marker was not echoed.');
    await evaluate(`views.get(active).terminal.scrollToBottom(); api.copy('BEFORE_COPY_TEST')`);
    const point = await evaluate(`(()=>{const v=views.get(active),t=v.terminal,b=t.buffer.active,r=v.host.querySelector('.xterm-screen').getBoundingClientRect();for(let i=b.viewportY;i<Math.min(b.length,b.viewportY+t.rows);i++){const at=b.getLine(i).translateToString(true).indexOf('AUTOCOPYCHECK42');if(at>=0)return {x:r.x+(at+3.5)*r.width/t.cols,y:r.y+(i-b.viewportY+.5)*r.height/t.rows};}throw new Error('No visible clipboard fixture marker');})()`);
    const doubleClick = async () => {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 2 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 2 });
    };
    await doubleClick();
    await wait('views.get(active).terminal.getSelection()==="AUTOCOPYCHECK42"', 'Double-click did not select fixture word.');
    await wait('(async()=>await api.paste()==="AUTOCOPYCHECK42")()', 'Automatic selection copy did not reach the Windows clipboard.');
    check('Trusted mouse selection reaches the real Windows clipboard and keeps its highlight', await evaluate('views.get(active).terminal.hasSelection()'));
    await evaluate(`openPreferences().then(()=>{$('preferencesForm').elements.copyOnSelect.checked=false; $('savePreferences').click(); return true;})`);
    await wait('!$("preferencesDialog").open && appearance.copyOnSelect===false', 'Copy preference did not save.');
    await evaluate(`views.get(active).terminal.clearSelection(); api.copy('COPY_DISABLED_SENTINEL')`);
    await doubleClick(); await delay(150);
    check('Saved opt-out leaves the real Windows clipboard unchanged', await evaluate('views.get(active).terminal.getSelection()==="AUTOCOPYCHECK42" && appearance.copyOnSelect===false') && await evaluate('api.paste()') === 'COPY_DISABLED_SENTINEL');
    report.clipboard = 'Passed using only synthetic text in the disposable packaged application.';
  } else report.clipboard = 'Skipped locally; pass --clipboard-fixture to allow replacing the clipboard with synthetic text.';
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await evaluate(`active=__smokeKeys[0]; $('layoutOne').click(); true`);
  await require('./UX-SFTP-Smoke.cjs').uxSftpSmoke({ evaluate, wait, check, send });
  await require('./UX-Desktop-Smoke.cjs').uxDesktopSmoke({ evaluate, wait, check, screenshot, send });
  await evaluate(`for(const v of views.values())v.files?.show(false); true`);
  await require('./Packaged-Workbench-Smoke.cjs').workbenchSmoke({ evaluate, wait, check, screenshot });
  if (process.argv.includes('--administrator-fixture')) {
    report.administrator = await require('./Packaged-Administrator-Smoke.cjs').administratorSmoke({ evaluate, wait, check, screenshot });
  } else report.administrator = 'Skipped: opt-in --administrator-fixture requires native Windows consent and uses only a disposable LOCAL console.';
  await require('./Terminal-Baud-Smoke.cjs').terminalBaudSmoke({ evaluate, send, wait, check, received: () => metrics.terminalBaud });
  // Closing the fixture transport avoids a native quit-confirmation; only synthetic shells are affected.
  for (const peer of peers) peer.end(); await wait('[...views.values()].every(v=>!v.files.connected&&!v.ready)', 'Fixture disconnect did not reach browsers.');
  check('Transport disconnect disables all owned browsers'); report.status = 'passed';
  report.gracefulShutdownRequested = true;
  try { await send('Browser.close'); } catch (error) { report.shutdownNote = error.message; }
  await delay(300);
  console.log(`Packaged per-pane smoke passed (${report.checks.length} checks); results: ${path.join(output, 'results.json')}`);
}
async function cleanup() {
  try { ws?.close(); } catch {}
  if (appPID) { try { process.kill(appPID); report.appPIDStopped = true; } catch (error) { report.appPIDStopped = error.code === 'ESRCH'; } }
  for (const peer of peers) peer.end();
  if (server) await new Promise(resolve => server.close(resolve));
  launcher?.kill(); await delay(300);
  const resolved = path.resolve(temporary), tempRoot = path.resolve(os.tmpdir()) + path.sep;
  assert.ok(resolved.startsWith(tempRoot) && path.basename(resolved).startsWith('nerdsshell-per-pane-'));
  try { fs.rmSync(resolved, { recursive: true, force: true }); report.temporaryDataRemoved = true; } catch (error) { report.temporaryDataRemoved = false; report.cleanupError = error.message; }
  report.finished = new Date().toISOString(); fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
}
main().catch(error => { report.status = 'failed'; report.error = error.stack; console.error(error); process.exitCode = 1; }).finally(cleanup);
