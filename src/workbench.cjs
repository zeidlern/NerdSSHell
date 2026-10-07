'use strict';
const path = require('node:path'), fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { LocalRemote, installedShells, shellFamily } = require('./local-remote.cjs');
const { boundedText, diagnosticSnapshot } = require('./diagnostics.cjs');
const { actions, PROBE, parsePlatform, scriptText, commandWarnings, ReviewTickets } = require('./action-catalog.cjs');
const { OS_TYPES, osType, validateSettings, configuredActions, compileConfigured, previewFacts, favoriteIds, newActionId } = require('./action-settings.cjs');
function preferences(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Quick Actions preferences.');
  const favorites = value.favorites === undefined ? ['system.info', 'system.disk', 'updates.check'] : value.favorites;
  if (!Array.isArray(favorites) || favorites.length > 3 || favorites.some(id => !actions.some(a => a.id === id))) throw new Error('Choose up to three built-in favorite actions.');
  return { favorites: [...new Set(favorites)] };
}
function installWorkbench({ handle, connections, getStore, app, dialog, getWindow, emit, queueOutput, discardOutput, output, forKey, actionTarget = () => undefined, shellProvider = installedShells, localFactory = (s, o) => new LocalRemote(s, o) }) {
  const facts = new WeakMap(), probes = new WeakMap(), reviews = new ReviewTickets(), locks = new Map(), journal = [];
  let activeProbes = 0, launches = 0, confirmations = 0;
  const localConsoleSequence = new Map();
  const record = (event, profileId) => { journal.push({ at: new Date().toISOString(), event: boundedText(event, 128), profileId: boundedText(profileId, 100) }); if (journal.length > 100) journal.shift(); };
  function localShell(id) {
    const administrator = typeof id === 'string' && ['local:powershell-admin', 'local:pwsh-admin', 'local:cmd-admin'].includes(id), baseId = administrator ? id.slice(0, -6) : id;
    const s = shellProvider().find(s => s.id === baseId); if (!s) throw new Error('This local shell installation is not available.');
    return administrator ? { ...s, id, baseId, administrator: true, name: s.name + ' (Administrator)' } : s;
  }
  function owner(id, key) {
    if (typeof id !== 'string' || id.length > 100) throw new Error('Choose a destination.');
    if (id.startsWith('local:')) {
      const s = localShell(id);
      const result = { id, local: true, shell: s, persistent: false, title: `LOCAL · This PC / ${s.name}`, confirmWord: '',
        validate() { if (localShell(id).executable !== s.executable) throw new Error('Local shell changed. Review again.'); } };
      return bindPane(result, key);
    }
    const runtime = connections.get(id), remote = runtime?.remote;
    if (!remote?.connected || remote.closing || runtime.profile.local) throw new Error('Connect to the selected remote server first.');
    return bindPane({ id, local: false, remote, profile: runtime.profile, persistent: runtime.profile.sessionMode !== 'standard',
      title: `REMOTE · ${runtime.profile.name} · ${runtime.profile.username}@${runtime.profile.host}:${runtime.profile.port}`,
      confirmWord: runtime.profile.host,
      validate() { if (connections.get(id) !== runtime || runtime.remote !== remote || !remote.connected || remote.closing) throw new Error('Destination connection changed. Nothing was run; review again.'); } }, key);
  }
  function bindPane(o, key) {
    if (key === undefined) return o;
    if (typeof key !== 'string' || key.length > 240 || !key.startsWith(o.id + '/')) throw new Error('The source pane does not belong to this destination.');
    const r = forKey(key), remote = r.remote, view = remote.views.get(key), pane = remote.pane(key);
    if (r.profile.id !== o.id || !view?.active) throw new Error('The source pane is no longer active.');
    const token = pane.sessionToken, original = o.validate;
    o.persistent = !o.local && !pane.standard && !remote.isStandard?.(key) && !remote.shells?.has(key);
    o.validate = () => { original(); if (connections.get(o.id) !== r || r.remote !== remote || !remote.connected || remote.closing || remote.views.get(key) !== view || !view.active || remote.pane(key).sessionToken !== token) throw new Error('The source pane connection or identity changed. Review again.'); };
    return o;
  }
  function configuration() { return validateSettings(getStore().data.actionConfiguration || {}); }
  function favorites(settings, os) { return favoriteIds(settings, os, preferences(getStore().data.workbench).favorites); }
  function platform(o) { return o.local ? { system: 'Windows', caps: [], shell: o.shell.family || shellFamily(o.shell.baseId || o.shell.id) } : facts.get(o.remote) || { system: 'unknown', caps: [] }; }
  function context() {
    const targets = shellProvider().map(s => ({ id: s.id, title: `LOCAL · This PC / ${s.name}`, local: true, administrator: false, system: 'Windows', shell: s.family || shellFamily(s.id), shellId: s.id }));
    for (const [id, r] of connections) if (r.profile.local && r.remote.shell?.administrator && r.remote.connected && !r.remote.closing) targets.push({ id, title: `LOCAL · Administrator / ${r.remote.shell.name}`, local: true, administrator: true, system: 'Windows', shell: r.profile.shellFamily || shellFamily(r.remote.shell.baseId || r.remote.shell.id), shellId: r.profile.shellId || r.remote.shell.baseId });
    for (const [id, r] of connections) if (!r.profile.local && r.remote?.connected && !r.remote.closing) targets.push({ id, title: `REMOTE · ${r.profile.name} · ${r.profile.username}@${r.profile.host}:${r.profile.port}`, local: false, system: facts.get(r.remote)?.system || 'unknown', mode: r.profile.sessionMode });
    return { targets, preferences: preferences(getStore().data.workbench) };
  }
  async function getLocal(s, cwd) {
    let r = connections.get(s.id);
    if (!r?.remote.connected || r.remote.closing) {
      const nativeRoot = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'node-pty', 'prebuilds', 'win32-x64') : undefined;
      const remote = localFactory(s, { nativeRoot });
      r = { profile: remote.profile, remote, wanted: true, attempts: 0, secrets: {}, state: 'connected' }; connections.set(s.id, r);
      const current = () => connections.get(s.id) === r && remote.connected && !remote.closing;
      remote.on('panes', panes => { if (current()) emit('panes', { profileId: s.id, panes }); });
      remote.on('snapshot', (key, snapshot) => { if (current()) { discardOutput(key); emit('snapshot', { key, ...snapshot }); } });
      remote.on('output', (key, bytes) => { if (current()) queueOutput(key, bytes); });
      remote.on('ended', key => { locks.delete(key); if (current()) { output.flush(key); emit('standard-ended', { key }); record('Local console ended', s.id); } });
      remote.on('notice', message => { if (current()) emit('notice', { message }); });
      await remote.connect();
    }
    // Only the current launch uses this directory; command text and paths are not persisted.
    if (cwd !== undefined && (typeof cwd !== 'string' || cwd.length > 4096 || !path.isAbsolute(cwd) || !fs.statSync(cwd).isDirectory())) throw new Error('Choose an existing local folder.');
    return r;
  }
  async function launch(o, title, code, cwd, validateReview = () => {}) {
    if (launches >= 4) throw new Error('Wait for a console launch to finish.');
    launches++;
    try {
      o.validate();
      const r = o.local ? await getLocal(o.shell, cwd) : connections.get(o.id);
      o.validate(); validateReview(); // Last check before submitting creation; no await before create/createTask.
      const family = o.local ? (o.shell.family || shellFamily(o.shell.baseId || o.shell.id)) : '';
      if (o.local && code === undefined) localConsoleSequence.set(family, (localConsoleSequence.get(family) || 0) + 1);
      const name = o.local && code === undefined ? `${family === 'cmd' ? 'Command Prompt' : 'PowerShell'} ${localConsoleSequence.get(family)}` : (code === undefined ? 'Shell-' : 'Task-') + randomUUID().slice(0, 8);
      // A local cwd is passed only to this synchronous PTY spawn, never written to remote profiles.
      const oldHome = o.local ? r.remote.home : undefined;
      let pending;
      try { if (o.local && cwd !== undefined) r.remote.home = cwd; const guard = { validate: () => { o.validate(); validateReview(); } }; pending = code === undefined ? r.remote.create(name, undefined, guard) : !o.local && r.remote.createTaskFor ? r.remote.createTaskFor(name, code, o.persistent) : r.remote.createTask(name, code, guard); }
      finally { if (o.local) r.remote.home = oldHome; }
      const pane = await pending;
      try { o.validate(); } catch { throw new Error('Destination changed after launch was submitted. The console or task may have started on the original target. It was not retried; inspect that target before trying again.'); }
      record(code === undefined ? 'Local console opened' : 'Reviewed task console opened', o.id);
      return { profile: r.profile, pane, title };
    } finally { launches--; }
  }
  handle('workbenchContext', context);
  handle('actionConfiguration', () => ({ ...configuration(), osTypes: [...OS_TYPES], defaults: preferences(getStore().data.workbench).favorites }));
  handle('actionConfigurationSave', value => {
    const checked = validateSettings(value), store = getStore(), prior = store.data.actionConfiguration;
    store.data.actionConfiguration = checked;
    try { store.save(); } catch (error) { if (prior === undefined) delete store.data.actionConfiguration; else store.data.actionConfiguration = prior; throw error; }
    return checked;
  });
  handle('actionNewId', newActionId);
  handle('actionTemplates', (os, shell) => configuredActions(previewFacts(os, shell), configuration()));
  handle('actionPreview', (os, id, argument, shell) => compileConfigured(id, previewFacts(os, shell), argument, configuration()));
  handle('paneActions', key => {
    const r = forKey(key), o = owner(r.profile.id, key), settings = configuration(), info = platform(o), os = osType(info);
    o.validate(); return { title: o.title, os, platform: info, target: actionTarget(key), actions: configuredActions(info, settings), favorites: favorites(settings, os) };
  });
  handle('workbenchPreferences', value => { const p = preferences(value); getStore().data.workbench = p; getStore().save(); return p; });
  handle('localOpen', async (id, chooseFolder = false) => {
    const o = owner(id); if (!o.local) throw new Error('Choose a local shell.');
    let cwd;
    if (chooseFolder === true) { const result = await dialog.showOpenDialog(getWindow(), { title: `Open ${o.shell.name} in this folder`, properties: ['openDirectory'] }); if (result.canceled) return null; cwd = result.filePaths[0]; }
    else if (chooseFolder !== false) throw new Error('Invalid folder choice.');
    return launch(o, o.shell.name, undefined, cwd);
  });
  handle('workbenchActions', (id, key) => { const o = owner(id, key), settings = configuration(), info = platform(o); return { title: o.title, platform: info, actions: configuredActions(info, settings), favorites: favorites(settings, osType(info)) }; });
  handle('workbenchDetect', async (id, key) => {
    const o = owner(id, key); if (o.local) return platform(o);
    if (probes.has(o.remote)) return probes.get(o.remote);
    if (activeProbes >= 2) throw new Error('Wait for another platform inspection to finish.');
    facts.delete(o.remote);
    const task = (async () => { activeProbes++; try {
      const text = await o.remote.checked(PROBE, { timeout: 10000, maxBytes: 16384 }); o.validate();
      const result = parsePlatform(text); facts.set(o.remote, result); record('Read-only platform inspection completed', id); return result;
    } finally { activeProbes--; probes.delete(o.remote); } })();
    probes.set(o.remote, task); return task;
  });
  handle('workbenchTemplate', (id, actionId, argument, key) => compileConfigured(actionId, platform(owner(id, key)), argument, configuration()));
  handle('workbenchReview', (id, request) => {
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Review a command first.');
    const o = owner(id, request.key);
    const code = scriptText(request.code);
    if (o.local && Buffer.byteLength(code) > 8192) throw new Error('Local reviewed commands are limited to 8 KiB.');
    let plan = { code, title: 'Reviewed command', shell: o.local ? platform(o).shell : 'posix', risk: 'custom', note: '' };
    if (request.actionId) { plan = compileConfigured(request.actionId, platform(o), request.argument, configuration()); if (plan.code !== code) throw new Error('The template was edited. Review it as a custom command.'); }
    const token = reviews.issue(plan, o);
    return { ...plan, token, destination: o.title, confirmWord: plan.risk === 'disruptive' ? o.confirmWord : '',
      warnings: commandWarnings(code, plan.shell), persistence: !o.persistent ? 'This new console is NOT persistent. Closing the app, sleep or connection loss can stop work.' : 'A new persistent task session will be created. It survives client disconnects, not a server reboot.' };
  });
  handle('workbenchCancelReview', token => reviews.cancel(token));
  handle('workbenchRun', async (token, typedHost = '') => {
    // Revocation can free a ticket while its native dialog remains open. Bound
    // those dialogs independently until their handlers actually finish.
    if (confirmations >= 16) { reviews.cancel(token); throw new Error('Too many open command confirmations. Close one before reviewing again.'); }
    const item = reviews.take(token), { plan, owner: o } = item;
    confirmations++;
    try {
      if (plan.risk === 'disruptive' && typedHost !== o.confirmWord) throw new Error('Type the exact remote hostname before running this disruptive action.');
      const response = await dialog.showMessageBox(getWindow(), { type: 'warning', title: 'Run reviewed command', message: `${plan.title}\n${o.title}`,
        detail: `A NEW console will run the reviewed command. Existing panes will not receive keystrokes.\n\n${plan.description || ''}\n${plan.note || ''}\n\n${plan.code.slice(0, 8192)}${plan.code.length > 8192 ? '\n[Preview shortened here; full text was shown in command review.]' : ''}\n\nCommands have the selected account’s permissions. Credentials are entered in the task console, not stored by Quick Actions.`,
        buttons: ['Run in new console', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true });
      if (response.response !== 0) return null;
      const validateReview = () => reviews.validate(token, item);
      validateReview();
      return await launch(o, plan.title, plan.code, undefined, validateReview);
    } finally { confirmations--; reviews.cancel(token); }
  });
  handle('inputLock', (key, locked) => {
    if (typeof locked !== 'boolean') throw new Error('Invalid lock state.');
    const r = forKey(key), view = r.remote.views.get(key); if (!view?.active) throw new Error('This view is no longer active.');
    if (locked) {
      locks.set(key, { remote: r.remote, view }); view.inputSerial = (view.inputSerial || 0) + 1;
      const record = r.remote.shells?.get(key); if (record) record.serial++;
    } else locks.delete(key);
    emit('input-lock', { key, locked }); return locked;
  });
  handle('workbenchDiagnostics', () => diagnosticSnapshot(connections, journal, { version: app.getVersion(), platform: process.platform, architecture: process.arch }));
  return {
    resolvePaneAction(key, actionId, argument) {
      const r = forKey(key), o = owner(r.profile.id, key);
      o.validate();
      return compileConfigured(actionId, platform(o), argument, configuration());
    },
    async openAdministrator(id) {
      if (!['local:powershell', 'local:pwsh', 'local:cmd'].includes(id)) throw new Error('Choose a local shell installation.');
      const o = owner(id + '-admin');
      try { return await launch(o, o.shell.name); }
      catch (error) { if (error.code === 'NERDSSHELL_UAC_CANCELLED') return { cancelled: true }; throw error; }
    },
    assertInput(key) { const lock = locks.get(key); if (!lock) return; const r = forKey(key); if (r.remote === lock.remote && r.remote.views.get(key) === lock.view) throw new Error('Input is locked for this pane. Unlock it deliberately to type or paste.'); locks.delete(key); },
    forget(key) { locks.delete(key); },
    disconnect(id) { for (const key of locks.keys()) if (key.startsWith(id + '/')) locks.delete(key); for (const [token, item] of reviews.items) if (item.owner.id === id) reviews.cancel(token); },
    observe(type, data) { if (type === 'status' && ['connecting','connected','disconnected'].includes(data.state)) record('Connection ' + data.state, data.profileId); }
  };
}
module.exports = { installWorkbench, preferences };
