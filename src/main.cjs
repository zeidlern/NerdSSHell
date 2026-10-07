'use strict';
const { app, BrowserWindow, ipcMain, dialog: nativeDialog, clipboard, Menu, shell, protocol, net, Notification, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { UI_URL, assetPath } = require('./app-protocol.cjs');
const { PRODUCT_NAME, APP_ID, WINDOW_ICON } = require('./branding.cjs');
const { randomUUID } = require('node:crypto');
const { OutputBuffer } = require('./output-buffer.cjs');
const { StateStore, Archive, publishExport } = require('./storage.cjs');
const { cancelOnRight } = require('./dialog-policy.cjs');
const dialog = cancelOnRight(nativeDialog);
const { MixedRemote } = require('./mixed-remote.cjs');
const { installSessionActions, isStandardSession } = require('./session-actions.cjs');
const { listDirectory, download, remotePath, downloadName } = require('./sftp-browser.cjs');
const { FileListings } = require('./file-listings.cjs');
const { installWorkbench } = require('./workbench.cjs');
const { installDesktopTools } = require('./desktop-tools.cjs');
const { installLocalFiles } = require('./local-files.cjs');
const { installSessionCommands } = require('./session-commands.cjs');
const { createSessionNotifications } = require('./session-notifications.cjs');
const { configureScratchpadSpelling, installScratchpadSpelling } = require('./scratchpad-spelling.cjs');
let workbench, sessionCommands, sessionNotifications;
const { upload } = require('./transfer.cjs');
const { profile, integer, pasteText } = require('./core.cjs');
let window, store, quitting = false, quitPending = false, promptChain = Promise.resolve();
const connections = new Map(), archives = new Map(), prompts = new Map(), transfers = new Map(), fileListings = new FileListings();
const output = new OutputBuffer({ emit: (type, data) => { emit(type, data); if (type === 'output') standardBackpressure(data.key); }, recover: key => forKey(key).remote.snapshot(key) });
const uiURL = UI_URL;
protocol.registerSchemesAsPrivileged([{ scheme: 'betterssh', privileges: { standard: true, secure: true } }]);
function emit(type, data = {}) {
  workbench?.observe(type, data);
  if (['snapshot', 'detached', 'ended', 'standard-ended'].includes(type)) sessionCommands?.forget(data.key);
  if (['detached', 'ended', 'standard-ended'].includes(type)) sessionNotifications?.forget(data.key);
  if (type === 'status' && ['connecting', 'disconnected'].includes(data.state)) sessionNotifications?.clearProfile(data.profileId); if (window && !window.isDestroyed()) window.webContents.send('betterssh:event', { type, ...data }); }
function confirm(title, message, detail = '') { return dialog.showMessageBox(window, { type: 'question', title, message, detail, buttons: ['Cancel', 'Continue'], defaultId: 0, cancelId: 0, noLink: true }).then(x => x.response === 1); }
function ask(options) {
  const { valid = () => true, ...publicOptions } = options;
  const task = promptChain.then(() => {
    if (!valid()) return null;
    if (options.confirm) return confirm(options.title, options.message).then(answer => valid() ? answer : null);
    return new Promise(resolve => {
      const id = randomUUID(); const timer = setTimeout(() => { prompts.delete(id); emit('promptCancelled', { id }); resolve(null); }, 180000);
      const done = value => { clearTimeout(timer); prompts.delete(id); resolve(valid() ? value : null); }; done.profileId = options.profileId;
      prompts.set(id, done); emit('prompt', { id, ...publicOptions });
    });
  });
  promptChain = task.catch(() => {}); return task;
}
function saved(id) { const p = store.data.profiles.find(x => x.id === id); if (!p) throw new Error('Unknown connection.'); return p; }
function runtime(id) { const r = connections.get(id); if (!r?.remote?.connected) throw new Error('This server is disconnected.'); return r; }
function forKey(key) {
  if (typeof key !== 'string' || key.length > 240) throw new Error('Invalid session.');
  const r = runtime(key.split('/')[0]); r.remote.pane(key); return r;
}
function archive(p) {
  if (!archives.has(p.id)) archives.set(p.id, new Archive(app.getPath('userData'), p.id, p.archiveMB));
  const a = archives.get(p.id); a.limit = p.archiveMB * 1024 * 1024; a.segmentBytes = Math.min(4 * 1024 * 1024, a.limit); return a;
}
function publishStatus(r, state, detail = '') { r.state = state; emit('status', { profileId: r.profile.id, state, detail }); }
function discardOutput(key) { output.discard(key); }
function standardBackpressure(key) {
  const remote = connections.get(String(key).split('/')[0])?.remote, state = output.states.get(key);
  remote?.setOutputPaused?.(key, !!state && (state.inflight || state.bytes >= 262144 || state.overflow));
}
function queueOutput(key, bytes) { output.queue(key, bytes); standardBackpressure(key); }
function standardCount(id) {
  return [...connections].filter(([key]) => id === undefined || key === id).reduce((n, [, r]) => n + (r.remote?.activeShellCount?.() || 0), 0);
}
async function approveDisconnect(id) {
  const consent = disconnectConsent(id);
  if (consent.count && !await confirm('Close nonpersistent consoles?', `This will close ${consent.count} standard SSH or local console(s).`, 'Running work may stop and cannot be reattached. Persistent remote sessions are unaffected.')) return null;
  return consent.validate;
}
function disconnectConsent(id) {
  const selected = () => [...connections].filter(([key]) => id === undefined || key === id);
  const original = selected().map(([key, runtime]) => ({ key, runtime, remote: runtime.remote, client: runtime.remote?.client,
    count: runtime.remote?.activeShellCount?.() || 0, shells: [...(runtime.remote?.shells || new Map())].filter(([, shell]) => !shell.dead) }));
  return { count: original.reduce((sum, item) => sum + item.count, 0), validate() {
    const current = selected();
    if (current.length !== original.length || original.some(item => {
      const runtime = connections.get(item.key), remote = runtime?.remote;
      const shells = [...(remote?.shells || new Map())].filter(([, shell]) => !shell.dead);
      return runtime !== item.runtime || remote !== item.remote || remote?.client !== item.client ||
        (remote?.activeShellCount?.() || 0) !== item.count || shells.length !== item.shells.length || item.shells.some(([key, shell]) => remote.shells.get(key) !== shell || shell.dead);
    })) throw new Error('Connections or nonpersistent consoles changed during confirmation. Try again to review the current work.');
  } };
}
function assertRemote(id, remote) {
  if (connections.get(id)?.remote !== remote || !remote.connected || remote.closing) throw new Error('Server connection changed. Refresh and try again.');
}
function cancelRemoteFiles(id) {
  fileListings.cancelProfile(id);
  for (const controller of transfers.values()) if (controller.profileId === id) controller.abort();
}
function fileOwner(key) {
  const r = forKey(key), remote = r.remote, view = remote.views.get(key);
  if (r.profile.local) throw new Error('Use Windows Explorer for local files.');
  const valid = () => connections.get(r.profile.id)?.remote === remote && remote.connected && !remote.closing && remote.views.get(key) === view && !!view?.active;
  const validate = () => { if (!valid()) throw new Error('File-browser session changed. Refresh and try again.'); };
  validate(); return { key, profileId: r.profile.id, remote, view, valid, validate };
}
function beginTransfer(id) {
  if (transfers.size >= 4) throw new Error('Wait for a file transfer to finish (limit four at once).');
  const controller = new AbortController(); controller.profileId = id;
  const transferId = randomUUID(); transfers.set(transferId, controller);
  return { controller, transferId };
}
async function sendFiles(id, remote, directory, files, key = '', validateOwner = () => {}, validateSelection = async () => {}) {
  remotePath(directory);
  if (files === null) {
    const selected = await dialog.showOpenDialog(window, { title: 'Upload files', properties: ['openFile', 'multiSelections'] });
    if (selected.canceled) return []; files = selected.filePaths;
  }
  assertRemote(id, remote); validateOwner();
  if (!Array.isArray(files) || files.length < 1 || files.length > 50 || files.some(f => typeof f !== 'string' || !path.isAbsolute(f) || f.length > 4096)) throw new Error('Invalid file selection.');
  if (!await confirm('Upload files', `Upload ${files.length} file(s) to ${remote.profile.name}?`, `${remote.profile.username}@${remote.profile.host}\nDestination: ${directory}\n\n${files.join('\n')}\n\nFiles will not be executed.`)) return [];
  assertRemote(id, remote); validateOwner(); await validateSelection(); assertRemote(id, remote); validateOwner();
  const { controller, transferId } = beginTransfer(id);
  emit('transfer', { id: transferId, profileId: id, key, status: 'starting', name: path.basename(files[0]) });
  try {
    return await upload(remote, files, { directory, signal: controller.signal,
      confirmOverwrite: async target => { const accepted = await confirm('Replace existing remote file?', target, `Server: ${remote.profile.name}. The previous file will be replaced only after this upload completes.`); assertRemote(id, remote); validateOwner(); if (accepted) await validateSelection(); assertRemote(id, remote); validateOwner(); return accepted; },
      progress: data => emit('transfer', { id: transferId, profileId: id, key, status: 'running', ...data }) });
  } finally { transfers.delete(transferId); emit('transfer', { id: transferId, profileId: id, key, status: 'finished' }); }
}
async function connect(id, secrets) {
  const p = saved(id); let r = connections.get(id);
  if (r?.busy) return;
  if (r?.remote?.connected) return r.remote.panes;
  if (!r) { r = { profile: p, wanted: true, attempts: 0, secrets: {}, state: 'disconnected' }; connections.set(id, r); }
  r.profile = p; r.wanted = true; r.busy = true; clearTimeout(r.timer);
  r.secrets = secrets || r.secrets; publishStatus(r, 'connecting', 'Signing in…');
  const token = r.promptToken = randomUUID();
  const active = () => r.remote === remote && r.wanted && r.promptToken === token && r.state !== 'disconnected';
  const RemoteClass = MixedRemote;
  const remote = r.remote = new RemoteClass(p, { ask: options => ask({ ...options, profileId: id, valid: active }), secrets: r.secrets, pins: store.data.pins,
    savePin: (target, fp) => { if (active()) { store.data.pins[target] = fp; store.save(); } },
    trust: async v => {
      if (!active()) return false;
      const accepted = await confirm('Verify server identity', `First connection to ${v.host}:${v.port}`, `Fingerprint: ${v.fingerprint}\n\nCompare this fingerprint with a trusted source before continuing. The accepted identity will be saved.`);
      return active() && accepted;
    } });
  remote.allowDiscovery = p.sessionMode !== 'standard'; // Legacy Standard profiles stay probe-free until explicitly enabled.
  remote.on('panes', panes => { if (active()) emit('panes', { profileId: id, panes }); });
  remote.on('snapshot', (key, snapshot) => { if (!active()) return; discardOutput(key); emit('snapshot', { key, ...snapshot }); });
  remote.on('output', (key, bytes) => { if (!active()) return; if (p.record) { const a = archive(p); a.append(key, bytes); if (a.error && !a.reported) { a.reported = true; emit('notice', { message: 'History recording stopped: ' + a.error.message }); } } queueOutput(key, bytes); });
  remote.on('notice', message => { if (active()) emit('notice', { message }); });
  remote.on('ended', key => { if (!active()) return; fileListings.cancelView(key); if (isStandardSession(remote, key)) { output.flush(key); emit('standard-ended', { key }); } else { discardOutput(key); emit('ended', { key }); } });
  remote.on('detached', key => { if (!active()) return; fileListings.cancelView(key); discardOutput(key); emit('detached', { key }); });
  remote.on('disconnected', error => {
    if (!active() || quitting) return;
    cancelRemoteFiles(id);
    for (const pane of remote.panes) discardOutput(pane.key);
    publishStatus(r, 'disconnected', error.message);
    // Auth/trust failures require an explicit user action; network loss uses bounded backoff.
    if (p.sessionMode === 'standard' || error.code === 'BETTERSSH_HOST_VERIFICATION' || error.level === 'client-authentication') { r.wanted = false; r.secrets = {}; remote.disconnect(); return; }
    const delay = Math.min(30000, 1000 * 2 ** Math.min(r.attempts++, 5));
    clearTimeout(r.timer); r.timer = setTimeout(() => connect(id).catch(() => {}), delay);
  });
  try {
    let panes = await remote.connect();
    if (!r.wanted || r.remote !== remote) { remote.disconnect(); return []; }
    if (p.sessionMode === 'standard') { await remote.createSession('Shell', false); panes = remote.panes; }
    if (!active()) { remote.disconnect(); return []; }
    r.attempts = 0; publishStatus(r, 'connected', `${p.username}@${p.host}`); emit('connected', { profileId: id, panes }); return panes;
  } catch (e) {
    if (!active()) { remote.disconnect(); return []; }
    remote.disconnect(); publishStatus(r, 'disconnected', e.message);
    if (p.sessionMode === 'standard' || e.code === 'BETTERSSH_HOST_VERIFICATION' || /auth|identity|key|cancel|support|passphrase|agent|permission|known_hosts/i.test(e.message)) { r.wanted = false; r.secrets = {}; }
    else if (r.wanted && !quitting) { const delay = Math.min(30000, 1000 * 2 ** Math.min(r.attempts++, 5)); r.timer = setTimeout(() => connect(id).catch(() => {}), delay); }
    throw e;
  } finally { r.busy = false; }
}
function disconnect(id) { workbench?.disconnect(id); sessionCommands?.disconnect(id); sessionNotifications?.clearProfile(id); cancelRemoteFiles(id); const r = connections.get(id); if (!r) return; r.promptToken = randomUUID(); for (const [prompt, done] of prompts) if (done.profileId === id) { emit('promptCancelled', { id: prompt }); done(null); } r.wanted = false; clearTimeout(r.timer); for (const key of output.keys()) if (key.startsWith(`${id}/`)) discardOutput(key); r.remote?.disconnect(); r.secrets = {}; publishStatus(r, 'disconnected', r.profile.sessionMode === 'standard' ? 'Disconnected. Standard shells are not restorable; connect to start a new shell.' : 'Disconnected. Persistent work was left running; Standard shells are not restorable.'); }
function handle(name, fn) {
  ipcMain.handle(`betterssh:${name}`, async (event, ...args) => {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== uiURL) throw new Error('Untrusted request.');
    return fn(...args);
  });
}
function registerIPC() {
  installDesktopTools({ handle, app, dialog, getWindow: () => window, confirm, adminLaunch: id => workbench.openAdministrator(id) });
  const localFiles = installLocalFiles({ handle, fileOwner, dialog, getWindow: () => window, confirm, sendFiles, beginTransfer, transfers, emit });
  handle('state', () => ({ profiles: store.data.profiles, workspace: store.data.workspace, appearance: store.data.appearance, notifications: store.data.notifications, sessionDefaults: store.data.sessionDefaults, version: app.getVersion(), dataDirectory: app.getPath('userData') }));
  handle('saveAppearance', value => store.setAppearance(value));
  handle('savePreferences', value => { const saved = store.setPreferences(value); sessionNotifications?.refreshPreferences(); return saved; });
  handle('sessionAttention', (key, state) => sessionNotifications?.update(key, state));
  handle('activeSession', key => sessionNotifications?.setActive(key));
  handle('saveProfile', async p => { p = profile(p); const prior = store.data.profiles.find(x => x.id === p.id), approved = await approveDisconnect(p.id); if (!approved) throw new Error('Connection edit cancelled.'); approved(); if (store.data.profiles.find(x => x.id === p.id) !== prior) throw new Error('Connection settings changed during confirmation. Review them again.'); if (connections.has(p.id)) { disconnect(p.id); connections.delete(p.id); } return store.putProfile(p); });
  handle('deleteProfile', async id => { const p = saved(id), consent = disconnectConsent(id); if (!await confirm('Remove saved connection', `Remove ${p.name}?`, 'Persistent sessions and local history files will not be deleted. Any standard SSH shells on this connection will close; their running work may stop.')) return false; consent.validate(); if (saved(id) !== p) throw new Error('Connection settings changed during confirmation. Review them again.'); disconnect(id); connections.delete(id); store.data.profiles = store.data.profiles.filter(x => x.id !== id); store.save(); return true; });
  handle('connect', id => connect(id)); handle('disconnect', async id => { const approved = await approveDisconnect(id); if (!approved) return false; approved(); disconnect(id); return true; });
  handle('discover', id => runtime(id).remote.discover());
  handle('open', key => forKey(key).remote.open(key));
  installSessionActions({ handle, runtime, connections, forKey, dialog, getWindow: () => window,
    forget: key => { workbench?.forget(key); sessionCommands?.forget(key); sessionNotifications?.forget(key); fileListings.cancelView(key); discardOutput(key); } });
  handle('input', (key, data) => { workbench?.assertInput(key); return forKey(key).remote.input(key, data); });
  handle('resize', (key, cols, rows) => { integer(cols, 20, 1000, 'columns'); integer(rows, 5, 500, 'rows'); return forKey(key).remote.resize(key, cols, rows); });
  handle('rename', (key, name) => forKey(key).remote.rename(key, name));
  handle('snapshot', key => forKey(key).remote.snapshot(key));
  handle('workspace', w => store.setWorkspace(w));
  handle('promptReply', (id, value) => { if (value !== null && (typeof value !== 'string' || value.length > 4096)) throw new Error('Invalid response.'); prompts.get(id)?.(value); });
  handle('ack', (key, epoch, sequence) => { output.ack(key, epoch, sequence); standardBackpressure(key); });
  handle('chooseKey', async () => { const r = await dialog.showOpenDialog(window, { title: 'Choose SSH private key', properties: ['openFile'] }); return r.canceled ? null : r.filePaths[0]; });
  handle('copy', value => { if (typeof value !== 'string' || value.length > 8 * 1024 * 1024) throw new Error('Selection is too large. Export history instead.'); return clipboard.writeText(value); });
  handle('paste', async () => { const text = pasteText(await clipboard.readText()); if (/[\r\n]/.test(text) && !await confirm('Paste multiple lines?', 'The clipboard contains multiple lines.', 'Pasting can execute commands in applications that do not protect multiline input.\n\n' + text.slice(0, 1800))) return null; return text; });
  handle('fullscreen', () => { window.setFullScreen(!window.isFullScreen()); return window.isFullScreen(); });
  handle('history', async (key, query) => { if (typeof query !== 'string' || query.length > 500) throw new Error('Search is too long.'); const p = saved(String(key).split('/')[0]); return archive(p).search(key, query); });
  handle('export', async key => {
    const p = saved(String(key).split('/')[0]);
    const r = await dialog.showSaveDialog(window, { title: 'Export recorded output', defaultPath: `NerdSSHell-${new Date().toISOString().slice(0, 10)}.txt`, filters: [{ name: 'Text', extensions: ['txt'] }] });
    if (r.canceled || !r.filePath) return null;
    const temp = r.filePath + `.${randomUUID()}.tmp`;
    try { await archive(p).exportTo(key, temp); publishExport(temp, r.filePath); } finally { try { fs.unlinkSync(temp); } catch {} }
    return r.filePath;
  });
  handle('upload', (key, dropped) => { const r = forKey(key); return sendFiles(r.profile.id, r.remote, r.profile.uploadDirectory, dropped, key); });
  handle('listFiles', async (key, browserId, directory) => {
    remotePath(directory); const owner = fileOwner(key);
    localFiles.clearRemote(key, browserId);
    const result = await fileListings.run({ ...owner, browserId }, signal => listDirectory(owner.remote, directory, { signal }));
    owner.validate(); localFiles.rememberRemote(key, browserId, result); return result;
  });
  handle('cancelFileList', (key, browserId) => fileListings.cancel(key, browserId));
  handle('browserUpload', (key, directory, dropped) => {
    const owner = fileOwner(key);
    return sendFiles(owner.profileId, owner.remote, directory, dropped, key, owner.validate);
  });
  handle('downloadFile', async (key, source) => {
    remotePath(source); const owner = fileOwner(key), { profileId: id, remote } = owner;
    const result = await dialog.showSaveDialog(window, { title: `Download from ${remote.profile.name} (choose a new filename)`, defaultPath: downloadName(source) });
    if (result.canceled || !result.filePath) return null;
    owner.validate();
    const { controller, transferId } = beginTransfer(id);
    emit('transfer', { id: transferId, profileId: id, key, status: 'starting', name: downloadName(source) });
    try { return await download(remote, source, result.filePath, { signal: controller.signal,
      progress: data => emit('transfer', { id: transferId, profileId: id, key, status: 'running', ...data }) }); }
    finally { transfers.delete(transferId); emit('transfer', { id: transferId, profileId: id, key, status: 'finished' }); }
  });
  handle('cancelTransfer', id => transfers.get(id)?.abort());
  handle('dataFolder', () => shell.openPath(app.getPath('userData')));
  workbench = installWorkbench({ handle, connections, getStore: () => store, app, dialog, getWindow: () => window, emit, queueOutput, discardOutput, output, forKey, actionTarget: key => sessionCommands.context(key) });
  sessionCommands = installSessionCommands({ handle, connections, forKey, assertInput: key => workbench.assertInput(key), resolveAction: (key, id, argument) => workbench.resolvePaneAction(key, id, argument) });
}
if (!app.isPackaged && process.env.BETTERSSH_TEST_DATA) app.setPath('userData', process.env.BETTERSSH_TEST_DATA);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.focus(); });
  app.whenReady().then(() => {
    // Keep the existing app ID/package namespace and userData directory; only
    // visible identity changes. This also matches the installed shortcut AUMID.
    if (process.platform === 'win32') app.setAppUserModelId?.(APP_ID);
    protocol.handle('betterssh', async request => {
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      const asset = assetPath(request.url, request.initiatorOrigin, path.join(__dirname, '..'));
      if (!asset) return new Response('Not found', { status: 404 });
      try { return await net.fetch(pathToFileURL(asset).href); }
      catch (error) { console.error('NerdSSHell UI asset load failed:', error); return new Response('Resource unavailable', { status: 500 }); }
    });
    store = new StateStore(app.getPath('userData')); registerIPC();
    if (session) configureScratchpadSpelling(session.defaultSession);
    window = new BrowserWindow({ width: 1440, height: 920, minWidth: 850, minHeight: 540, backgroundColor: '#11151d', title: PRODUCT_NAME, icon: path.join(__dirname, '..', WINDOW_ICON),
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, spellcheck: true, backgroundThrottling: false } });
    installScratchpadSpelling({ getWindow: () => window, Menu });
    sessionNotifications = createSessionNotifications({ getWindow: () => window, Notification, getPreferences: () => store.data.notifications,
      resolveSession: key => {
        const r = forKey(key), view = r.remote.views.get(key), pane = r.remote.pane(key);
        if (!view?.active || !view.initialized || pane.dead || r.remote.closing) return null;
        return { identity: view, label: `${r.profile.name} · ${pane.sessionName}` };
      }, onActivate: key => emit('attention-activate', { key }), onAudio: data => emit('attention-audio', data) });
    window.on('close', event => { if (!quitting && (standardCount() || app.bettersshScratchpadDirty)) { event.preventDefault(); app.quit(); } });
    Menu.setApplicationMenu(null);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', e => e.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    window.webContents.session.setPermissionCheckHandler(() => false);
    window.webContents.on('render-process-gone', () => { for (const id of connections.keys()) disconnect(id); });
    return window.loadURL(uiURL);
  }).catch(e => { console.error('NerdSSHell startup failed:', e); dialog.showErrorBox('NerdSSHell could not start', e.message); app.exit(1); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (quitting) return;
    event.preventDefault(); if (quitPending) return; quitPending = true;
    Promise.resolve().then(async () => {
      const scratchRevision = app.bettersshScratchpadRevision || 0;
      if (app.bettersshScratchpadDirty && !await confirm('Discard unsaved scratchpad?', 'Quit without saving your scratchpad?', 'Cancel to keep editing or use Save As. Notes are not stored automatically.')) return;
      const approved = await approveDisconnect(); if (!approved) return; approved();
      if (app.bettersshScratchpadDirty && (app.bettersshScratchpadRevision || 0) !== scratchRevision) throw new Error('Scratchpad changed during confirmation. Save it or review quitting again.');
      quitting = true; sessionNotifications?.dispose();
      for (const id of connections.keys()) disconnect(id);
      for (const done of prompts.values()) done(null);
      for (const t of transfers.values()) t.abort();
      await Promise.allSettled([...archives.values()].map(a => a.close()));
      app.quit();
    }).catch(e => { emit('notice', { message: e.message }); }).finally(() => { quitPending = false; });
  });
}
