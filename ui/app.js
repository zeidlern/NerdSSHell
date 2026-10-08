/* global Terminal, FitAddon, SearchAddon, NerdSSHellAppearance, NerdSSHellFiles, NerdSSHellSelectionCopy */
'use strict';
const api = window.nerdsshell, $ = id => document.getElementById(id);
const profiles = new Map(), panes = new Map(), views = new Map(), statuses = new Map(), opening = new Map(), closing = new Map();
const { baseColors, colorKeys, presets, presetPalette, paletteLabels, exampleRoles } = NerdSSHellAppearance;
const defaultAppearance = NerdSSHellAppearance.appearance();
let appearance = NerdSSHellAppearance.appearance(), preferencePalette = presetPalette();
let notifications = { enabled: true, audio: true, desktop: true, visual: true };
let sessionDefaults = { scrollback: 100000, archiveMB: 256, record: false, startup: 'all', autoConnect: true };
let preferenceSection = 'copy', preferenceGeneration = 0, preferenceSaving = false, preferenceLoaded = false, attentionActiveKey = '';
let order = [], savedOrder = [], slots = [], savedSlots = [], active = '', desiredActive = '', layout = 1, twoPaneOrientation = 'side-by-side', splitX = 50, splitY = 50;
let saveTimer, noticeTimer, promptId, promptProfileId, promptKind, promptChoiceResponses = new Map(), entryResolve, historyKey, selectedProfile;
let maxOpenViews = 64, pendingViewSlots = 0;
function requireViewCapacity(key) {
  if (!views.has(key) && views.size + pendingViewSlots >= maxOpenViews) throw new Error(`NerdSSHell supports ${maxOpenViews} open terminal views. Close a view before opening another; persistent remote work keeps running.`);
}
async function withViewCapacity(operation) {
  requireViewCapacity(); pendingViewSlots++;
  let reserved = true;
  const release = () => { if (reserved) { reserved = false; pendingViewSlots--; } };
  try { return await operation(release); }
  finally { release(); }
}
const activeTransfers = new Map();
function syncFiles() {
  for (const view of views.values()) {
    const p = profiles.get(view.pane.profileId);
    view.files?.context(p ? `${p.name} — ${p.username}@${p.host}:${p.port}` : 'Connection removed',
      !!p && view.filesAttached === true && connected(p.id) && panes.has(view.pane.key) && !view.pane.dead, label(view.pane));
  }
}
function showFiles(key = active) { const browser = views.get(key)?.files; if (browser) browser.show(!browser.visible); }
function message(text) { $('notice').textContent = String(text).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''); $('notice').hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 9000); }
function run(promise) { return Promise.resolve(promise).catch(e => { message(e.message); }); }
function luminance(hex) { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
function mixColor(a, b, weight) { return '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * weight + parseInt(b.slice(i, i + 2), 16) * (1 - weight)).toString(16).padStart(2, '0')).join(''); }
function terminalTheme(colors) { return { ...colors.palette, background: colors.terminalBackground, foreground: colors.text, cursor: colors.accent, selectionBackground: mixColor(colors.accent, colors.terminalBackground, 0.38) }; }
function applyAppearance(colors) {
  const root = document.documentElement;
  root.style.setProperty('--terminal-bg', colors.terminalBackground);
  root.style.setProperty('--bg', colors.uiBackground);
  root.style.setProperty('--accent', colors.accent);
  root.style.setProperty('--text', colors.text);
  const contrast = luminance(colors.uiBackground) > 0.179 ? '#000000' : '#ffffff';
  root.style.setProperty('--contrast', contrast);
  root.style.setProperty('--danger', contrast === '#000000' ? '#a92332' : '#ff9298');
  root.style.setProperty('--on-accent', luminance(colors.accent) > 0.179 ? '#111111' : '#ffffff');
  const lightTerminal = luminance(colors.terminalBackground) > 0.179;
  for (const [key, dark, light] of [['keyword', '#c9b1ff', '#7655a8'], ['string', '#a8d8a5', '#36752d'], ['variable', '#8ed9e8', '#006e82'], ['comment', '#aaa4b2', '#64616a'], ['number', '#ead29d', '#856b18']]) root.style.setProperty('--syntax-' + key, lightTerminal ? light : dark);
  root.style.colorScheme = contrast === '#000000' ? 'light' : 'dark';
  const brand = $('brandIcon');
  if (brand) brand.src = contrast === '#000000' ? 'branding/app-light-64.png' : 'branding/app-dark-64.png';
  const aboutBrand = $('aboutBrandIcon');
  if (aboutBrand) aboutBrand.src = contrast === '#000000' ? 'branding/app-light-512.png' : 'branding/app-dark-512.png';
  for (const view of views.values()) view.terminal.options.theme = terminalTheme(colors);
}
function element(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
function button(text, action, cls, title) { const b = element('button', cls, text); if (title) b.title = title; b.addEventListener('click', e => { e.stopPropagation(); run(action()); }); return b; }
function label(p) { return p.windowPanes > 1 || [...panes.values()].some(x => x.key !== p.key && x.sessionId === p.sessionId && x.profileId === p.profileId) ? `${p.sessionName} / ${p.windowName} / ${p.paneIndex + 1}` : p.sessionName; }
function connected(id) { return statuses.get(id)?.state === 'connected'; }
async function connectProfile(id) {
  if (profiles.get(id)?.sessionMode !== 'standard' || connected(id)) return api.connect(id);
  return withViewCapacity(async release => {
    const result = await api.connect(id);
    release();
    // The connected event may arrive while the reserved slot is still held.
    // Attach its returned ordinary shell before another launch can take it.
    for (const pane of result || []) { panes.set(pane.key, pane); if (!pane.dead) await openPane(pane.key, false); }
    return result;
  });
}
function remember() {
  clearTimeout(saveTimer); saveTimer = setTimeout(() => {
    savedOrder = [...order];
    run(api.workspace({ layout, twoPaneOrientation, order, slots, active, splitX, splitY }));
  }, 250);
}
function dragSource(node, key) {
  node.draggable = true;
  node.addEventListener('dragstart', e => {
    if (!panes.has(key)) { e.preventDefault(); return; }
    e.dataTransfer.setData('application/x-nerdsshell-pane', key); e.dataTransfer.effectAllowed = 'move';
  });
  node.addEventListener('dragend', () => { for (const target of document.querySelectorAll('.drop-target')) target.classList.remove('drop-target'); });
}
function dropTarget(node, index, layoutSlot = false) {
  node.addEventListener('dragover', e => {
    if (![...e.dataTransfer.types].some(type => type === 'application/x-nerdsshell-pane' || type === 'Files')) return;
    e.preventDefault(); node.classList.add('drop-target');
  });
  node.addEventListener('dragleave', () => node.classList.remove('drop-target'));
  node.addEventListener('drop', async e => {
    e.preventDefault(); e.stopPropagation(); node.classList.remove('drop-target');
    const key = e.dataTransfer.getData('application/x-nerdsshell-pane');
    if (key && panes.has(key)) {
      const actual = index(), targetKey = layoutSlot ? slots[actual] : order[actual], originalLayout = layout;
      const pane = panes.get(key), targetSlots = [...slots];
      try {
        if (!order.includes(key)) await openPane(key, false, false);
        if (panes.get(key) !== pane || !order.includes(key) || layout !== originalLayout || targetSlots.some((value, i) => slots[i] !== value)) return;
        if (layoutSlot) {
          const source = slots.indexOf(key);
          if (source >= 0) slots[source] = targetKey || null;
          slots[actual] = key;
          const arranged = slots.filter(Boolean), positions = order.map((value, i) => arranged.includes(value) ? i : -1).filter(i => i >= 0);
          positions.forEach((position, i) => { order[position] = arranged[i]; });
        } else {
          const current = order.indexOf(key), target = order.indexOf(targetKey);
          if (target < 0) return;
          [order[current], order[target]] = [order[target], order[current]];
          slots = slots.map(value => value === key ? targetKey : value === targetKey ? key : value);
        }
        active = key; render(); remember(); focusPane(key);
      } catch (error) { message(error.message); }
      return;
    }
    const target = layoutSlot ? slots[index()] : order[index()]; if (!target || !e.dataTransfer.files.length) return;
    const files = Array.from(e.dataTransfer.files);
    if (panes.get(target)?.local) {
      const paths = api.filePaths(files);
      window.NerdSSHellWorkbench?.open({ target: panes.get(target).profileId, code: paths.map(p => "'" + p.replace(/'/g, "''") + "'").join(' ') }); return;
    }
    if (views.get(target)?.locked) { message('Input is locked. Unlock the pane before inserting paths.'); return; }
    if (e.shiftKey) { const paths = api.filePaths(files); views.get(target)?.terminal.paste(paths.map(quote).join(' ')); message('Local paths inserted. These files have not been uploaded.'); }
    else run(uploadFiles(target, files));
  });
}
function quote(text) { return `'${text.replace(/'/g, `'\\''`)}'`; }
function waitingState(key) { const state = views.get(key)?.attention; return notifications.visual && state?.waiting ? state : null; }
function waitingIndicator(key, compact = false) {
  const indicator = element('span', 'waiting-indicator', compact ? 'WAITING' : 'WAITING FOR INPUT');
  indicator.title = 'Waiting for input'; indicator.setAttribute('aria-label', 'Waiting for input');
  indicator.hidden = !waitingState(key); return indicator;
}
function renderAttentionIndicators() {
  for (const [key, view] of views) {
    const attention = waitingState(key);
    view.waitingBadge.hidden = !attention;
    view.wrapper.classList.toggle('waiting', !!attention);
    view.wrapper.classList.toggle('attention-new', !!attention && !attention.acknowledged);
  }
  renderConnections(); renderTabs();
}
function syncActiveAttention() {
  if (attentionActiveKey === active) return;
  attentionActiveKey = active;
  views.get(active)?.attentionTracker?.acknowledge();
  run(api.activeSession(views.get(active)?.ready ? active : ''));
}
function sessionRow(pane) {
  const attention = waitingState(pane.key);
  const row = element('div', 'session-item' + (active === pane.key ? ' active' : '') + (pane.dead ? ' dead' : '') + (attention ? ' waiting' : '') + (attention && !attention.acknowledged ? ' attention-new' : ''));
  row.setAttribute('role', 'button'); row.tabIndex = 0;
  row.append(element('span', 'session-dot', pane.dead ? '○' : '●'));
  if (pane.local) row.append(element('span', 'session-kind', pane.shellFamily === 'cmd' || pane.shellId === 'local:cmd' ? 'CMD' : 'PS'));
  row.append(element('span', 'session-name', label(pane)), waitingIndicator(pane.key, true));
  row.title = `${label(pane)} — ${pane.local ? 'Local shell on this PC' : pane.command || 'Remote shell'}${pane.administrator ? ' · Administrator' : ''}${attention ? '\nWaiting for input' : ''}\nClick to open; drag into a layout slot.`;
  const open = () => { selectedProfile = pane.profileId; run(openPane(pane.key)); };
  row.addEventListener('click', open);
  row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  dragSource(row, pane.key); return row;
}
function renderConnections() {
  const root = $('connections'); root.replaceChildren();
  const localPanes = [...panes.values()].filter(pane => pane.local);
  if (localPanes.length) {
    const local = element('section', 'connection local-connection');
    local.append(element('div', 'connection-head', 'This PC'), element('div', 'connection-address', 'Local shells · closing a session ends its process'));
    for (const pane of localPanes) local.append(sessionRow(pane));
    root.append(local);
  }
  if (![...profiles.values()].some(p => !p.local)) root.append(element('p', 'hint', 'Add an SSH server to open remote sessions.'));
  for (const p of profiles.values()) {
    if (p.local) continue;
    const box = element('section', 'connection'), head = element('div', 'connection-head', p.name);
    head.append(button('⋯', () => editConnection(p), 'small', 'Edit connection'));
    box.append(head, element('div', 'connection-address', `${p.username}@${p.host}:${p.port}`), element('div', 'connection-address', 'Persistence is chosen for each new session'));
    const state = statuses.get(p.id) || { state: 'disconnected', detail: 'Not connected' };
    const status = element('div', 'connection-status ' + state.state, state.detail || state.state);
    status.setAttribute('role', 'status'); box.append(status);
    const actions = element('div', 'connection-actions');
    if (state.state === 'connected') {
      actions.append(button('+ New', () => newSession(p.id), 'small'), button('Refresh', () => api.discover(p.id), 'small'), button('Disconnect', () => api.disconnect(p.id), 'small'));
    } else if (state.state === 'connecting') actions.append(button('Cancel', () => api.disconnect(p.id), 'small'));
    else actions.append(button('Connect', () => { selectedProfile = p.id; return connectProfile(p.id); }, 'small'), button('Remove', async () => { if (await api.deleteProfile(p.id)) { profiles.delete(p.id); renderConnections(); } }, 'small'));
    if (p.auth === 'password') actions.append(button('Forget password', async () => {
      const result = await api.forgetPassword(p.id);
      if (profiles.get(p.id) === p) { profiles.set(p.id, result); renderConnections(); }
    }, 'small', 'Remove the remembered password without disconnecting this session'));
    box.append(actions);
    for (const pane of panes.values()) if (pane.profileId === p.id && !pane.local) box.append(sessionRow(pane));
    root.append(box);
  }
}
function renderTabs() {
  const root = $('tabs'); root.replaceChildren();
  for (const key of order) {
    const p = panes.get(key) || views.get(key)?.pane; if (!p) continue;
    const attention = waitingState(key);
    const tab = element('div', 'tab' + (key === active ? ' active' : '') + (!views.get(key)?.ready ? ' offline' : '') + (attention ? ' waiting' : '') + (attention && !attention.acknowledged ? ' attention-new' : ''));
    tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(key === active));
    tab.append(element('span', 'label', label(p)), waitingIndicator(key, true), button('×', () => closeView(key), 'close-tab', p.local ? 'End local shell and its process (confirmation required)' : p.standard ? 'Close standard shell (confirmation required)' : 'Close view; leave remote work running'));
    tab.title = `${profiles.get(p.profileId)?.name || ''} / ${label(p)}${attention ? '\nWaiting for input' : ''}`;
    tab.addEventListener('click', () => activate(key)); dragSource(tab, key); dropTarget(tab, () => order.indexOf(key)); root.append(tab);
  }
}
function focusPane(key) {
  const view = views.get(key);
  requestAnimationFrame(() => {
    if (active === key && views.get(key) === view && view && !view.wrapper.hidden && !document.querySelector('dialog[open]')) view.terminal.focus();
  });
}
function activate(key) { active = key; selectedProfile = panes.get(key)?.profileId || selectedProfile; views.get(key)?.attentionTracker?.acknowledge(); render(); remember(); focusPane(key); }
function activateVisiblePane(key) {
  views.get(key)?.attentionTracker?.acknowledge();
  if (active === key) return;
  active = key; selectedProfile = views.get(key)?.pane.profileId || selectedProfile;
  renderTabs(); renderConnections(); syncFiles();
  for (const [otherKey, other] of views) other.wrapper.classList.toggle('focused', otherKey === active);
  remember(); updateDimensions(); syncActiveAttention();
}
function visibleKeys() {
  const size = layout;
  slots = slots.map(key => order.includes(key) ? key : null);
  if (slots.length !== size || !slots.includes(active)) {
    const index = Math.max(0, order.indexOf(active)), start = Math.max(0, index - size + 1);
    slots = Array.from({ length: size }, (_, i) => order[start + i] || null);
  }
  return { size, keys: slots };
}
function paneSlot(size, i) { return size === 2 && twoPaneOrientation === 'stacked' ? { column: 1, row: i + 1 } : { column: size > 1 ? i % 2 + 1 : 1, row: size === 4 ? Math.floor(i / 2) + 1 : 1 }; }
function render() {
  if (!order.includes(active)) active = order[0] || '';
  syncActiveAttention();
  renderTabs(); renderConnections(); syncFiles();
  const grid = $('grid'); const { size, keys } = visibleKeys();
  const stacked = size === 2 && twoPaneOrientation === 'stacked';
  grid.className = size === 1 ? '' : stacked ? 'layout-2-stacked' : 'layout-' + size;
  grid.style.setProperty('--split-x', splitX + '%'); grid.style.setProperty('--split-y', splitY + '%');
  for (const empty of grid.querySelectorAll('.empty-slot')) empty.remove();
  $('welcome').hidden = order.length > 0;
  for (const [key, v] of views) {
    const i = keys.indexOf(key); v.wrapper.hidden = i < 0;
    if (i >= 0) {
      const slot = paneSlot(size, i); v.wrapper.style.gridColumn = String(slot.column); v.wrapper.style.gridRow = String(slot.row);
      v.wrapper.classList.toggle('focused', key === active);
    }
  }
  if (order.length) for (let i = 0; i < size; i++) if (!keys[i]) {
    const empty = element('div', 'empty-slot'), slot = paneSlot(size, i); empty.style.gridColumn = String(slot.column); empty.style.gridRow = String(slot.row);
    empty.append(element('span', '', 'Drop a session here'), button('+ New session', () => newSession()), element('p', '', 'Existing sessions are listed on the left.'));
    dropTarget(empty, () => i, true); grid.append(empty);
  }
  $('dividerX').hidden = !order.length || size === 1 || stacked; $('dividerY').hidden = !order.length || !(size === 4 || stacked);
  const choice = layout === 2 ? '2-' + twoPaneOrientation : String(layout);
  for (const control of document.querySelectorAll('.layout-buttons [data-layout-choice]')) {
    const selected = control.dataset.layoutChoice === choice;
    control.classList.toggle('active', selected); control.setAttribute('aria-pressed', String(selected));
  }
  requestAnimationFrame(() => { for (const key of keys) fit(views.get(key)); updateDimensions(); });
}
function updateDimensions() { for (const v of views.values()) if (v.dimensions) v.dimensions.textContent = `${v.terminal.cols} × ${v.terminal.rows}`; }
function fit(v) {
  if (!v || v.wrapper.hidden || v.host.clientWidth < 50 || v.host.clientHeight < 30) return;
  if (v.pane.local) {
    if (v.fitQueued) return;
    v.fitQueued = true; const generation = v.generation;
    v.render = v.render.then(async () => {
      v.fitQueued = false;
      if (views.get(v.pane.key) !== v || v.generation !== generation || v.wrapper.hidden || v.host.clientWidth < 50 || v.host.clientHeight < 30) return;
      // Keep xterm's public reflow state authoritative. Modern ConPTY queries
      // its cursor when a console application next reads buffer coordinates.
      v.fit.fit();
      scheduleResize(v);
    }).catch(e => { v.fitQueued = false; message(e.message); });
    return;
  }
  try { v.fit.fit(); } catch (e) { message(e.message); }
  scheduleResize(v);
}
function scheduleResize(v) {
  if (!v.ready) return;
  clearTimeout(v.resizeTimer); v.resizeTimer = setTimeout(() => {
    if (views.get(v.pane.key) !== v || !v.ready) return;
    const cols = Math.min(1000, Math.max(20, v.terminal.cols)), rows = Math.min(500, Math.max(5, v.terminal.rows));
    run(api.resize(v.pane.key, cols, rows)); updateDimensions();
  }, 120);
}
function write(term, data) { return new Promise(resolve => term.write(data, resolve)); }
function decode(data) { return Uint8Array.from(atob(data), ch => ch.charCodeAt(0)); }
async function copySelection(terminal) { await api.copy(terminal.getSelection()); terminal.clearSelection(); }
function createView(pane) {
  requireViewCapacity(pane.key);
  const wrapper = element('section', 'terminal-pane'), head = element('div', 'pane-head'), host = element('div', 'terminal-host'), bottom = element('div', 'pane-bottom');
  const state = element('span', 'pane-state', 'Opening…'), context = element('div', 'pane-head-context'), controls = element('div', 'pane-session-controls');
  const locationBadge = element('span', 'pane-location-badge ' + (pane.local ? 'local' : 'remote'), pane.local ? 'LOCAL' : 'REMOTE');
  locationBadge.title = pane.local ? 'Shell running on this PC' : 'Shell running on the connected SSH server';
  const waitingBadge = waitingIndicator(pane.key), dimensions = element('span', 'pane-dimensions');
  const move = element('span', 'pane-move', '⠿'); move.title = 'Drag to move this terminal to another layout slot'; move.setAttribute('aria-label', 'Drag to move terminal');
  dragSource(move, pane.key);
  context.append(move, locationBadge, element('span', 'pane-title', label(pane)), waitingBadge, state); head.append(context, controls);
  const filesToggle = element('button', 'pane-files-toggle', 'File SFTP'); filesToggle.type = 'button'; filesToggle.title = 'Show or hide this terminal’s file browser';
  if (!pane.local) context.append(filesToggle, button('History', () => showHistory(pane.key), '', 'Search recorded output'));
  controls.append(button('Rename', () => performSessionAction(pane.key, 'rename'), 'pane-rename'));
  if (!pane.local) controls.append(button('Disconnect', () => performSessionAction(pane.key, 'disconnect'), 'pane-disconnect', pane.standard ? 'Close this nonpersistent console (confirmation required)' : 'Detach this view; leave remote work running'));
  controls.append(button('End Session', () => performSessionAction(pane.key, 'end'), 'pane-end danger', pane.local ? 'Terminate this local shell and its process (confirmation required)' : 'Terminate this session (confirmation required)'));
  bottom.append(dimensions, button('Jump to live ↓', () => views.get(pane.key)?.terminal.scrollToBottom()));
  const body = element('div', 'pane-body'); body.append(host);
  wrapper.dataset.paneKey = pane.key; wrapper.append(head, body, bottom); $('grid').append(wrapper);
  const terminal = new Terminal({ scrollback: profiles.get(pane.profileId)?.scrollback || 100000, fontFamily: '"Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace', fontSize: 15, lineHeight: 1.12, cursorBlink: true, minimumContrastRatio: 4.5,
    // ConPTY owns its screen redraw after row growth. Keep its scrollback in
    // place; ordinary SSH PTYs retain xterm's normal reflow behavior.
    ...(pane.local ? { windowsPty: { backend: 'conpty' } } : {}), theme: terminalTheme(appearance) });
  const addon = new FitAddon.FitAddon(), search = new SearchAddon.SearchAddon(); terminal.loadAddon(addon); terminal.loadAddon(search); terminal.open(host);
  const v = { pane, wrapper, host, terminal, fit: addon, search, state, locationBadge, waitingBadge, dimensions, ready: false, generation: 0, render: Promise.resolve() }; views.set(pane.key, v);
  v.attentionTracker = window.NerdSSHellAttention.attach({ terminal, isReady: () => v.ready && !v.pane.dead,
    enabled: () => notifications.enabled,
    onChange: attention => {
      if (views.get(pane.key) !== v) return;
      v.attention = attention; renderAttentionIndicators();
      api.sessionAttention(pane.key, attention).catch(() => {});
    } });
  if (!pane.local) v.files = NerdSSHellFiles.create({ api, onError: message, container: body, toggle: filesToggle, key: pane.key, profileId: pane.profileId });
  terminal.parser.registerOscHandler(52, () => true); // Remote output never writes to the local clipboard.
  v.selectionCopy = NerdSSHellSelectionCopy.attach({ terminal, host, copy: text => api.copy(text),
    enabled: () => appearance.copyOnSelect, generation: () => v.generation,
    isCurrent: () => views.get(pane.key) === v && !v.wrapper.hidden && !document.querySelector('dialog[open]'),
    onError: error => message(error.message) });
  terminal.onData(data => {
    if (!v.ready || v.locked) return;
    const generation = v.generation, attentionToken = v.attentionTracker.captureInput();
    run(api.input(pane.key, data).then(() => {
      if (views.get(pane.key) === v && v.generation === generation) v.attentionTracker.acceptInput(data, attentionToken);
    }));
  });
  terminal.onBell(() => { if (active !== pane.key) message(`Attention: ${label(pane)}`); });
  terminal.attachCustomKeyEventHandler(e => {
    if (e.type !== 'keydown') return true;
    if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'c' && (terminal.hasSelection() || e.shiftKey)) { run(copySelection(terminal)); return false; }
    if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'f') { if (e.shiftKey && !pane.local) run(showHistory(pane.key)); else showFind(); return false; }
    if (isAppShortcut(e)) return false;
    return true;
  });
  terminal.attachCustomWheelEventHandler(e => {
    if (e.altKey) return true;
    terminal.scrollLines(Math.sign(e.deltaY) * Math.max(1, Math.round(Math.abs(e.deltaY) / (e.deltaMode === 0 ? 30 : 1)))); return false;
  });
  host.addEventListener('contextmenu', e => { e.preventDefault(); if (terminal.hasSelection()) run(copySelection(terminal)); else run(paste(pane.key)); });
  wrapper.addEventListener('pointerdown', () => activateVisiblePane(pane.key));
  wrapper.addEventListener('focusin', () => activateVisiblePane(pane.key));
  dropTarget(wrapper, () => slots.indexOf(pane.key), true);
  v.observer = new ResizeObserver(() => fit(v)); v.observer.observe(host); window.NerdSSHellWorkbench?.onView(v); window.NerdSSHellPanes?.onView(v); return v;
}
async function openPane(key, select = true, place = true) {
  const pane = panes.get(key); if (!pane) return;
  if (!connected(pane.profileId)) { message('Connect to this server first.'); return; }
  if (!views.has(key)) createView(pane);
  if (!order.includes(key)) {
    order.push(key);
    if (place && slots.length === layout && slots.includes(null)) slots[slots.indexOf(null)] = key;
  }
  if (select || !active) active = key;
  render(); remember();
  if (select) focusPane(key);
  if (views.get(key).ready) return;
  if (opening.has(key)) return opening.get(key);
  const view = views.get(key);
  const task = Promise.resolve(closing.get(key)).then(() => api.open(key)).catch(e => { if (views.get(key) === view) view.state.textContent = 'Could not open'; throw e; }).finally(() => { if (opening.get(key) === task) opening.delete(key); });
  opening.set(key, task); await task;
}
async function closeView(key) {
  const pane = views.get(key)?.pane, standard = pane?.standard || pane?.local;
  if (standard && await api.close(key) === false) return;
  const v = views.get(key); if (v) { v.ready = false; v.generation++; }
  if (!v && !order.includes(key)) return;
  opening.delete(key);
  if (v && views.get(key) === v) { clearTimeout(v.resizeTimer); v.files?.destroy(); v.selectionCopy?.dispose(); v.attentionTracker?.dispose(); v.observer.disconnect(); v.terminal.dispose(); v.wrapper.remove(); views.delete(key); }
  order = order.filter(k => k !== key); render(); remember();
  const task = standard ? Promise.resolve() : api.close(key); closing.set(key, task);
  try { await task; } finally { if (closing.get(key) === task) closing.delete(key); }
}
async function paste(key = active) { const v = views.get(key); if (v?.locked) { message('Input is locked. Clipboard text was not sent.'); return; } if (!v?.ready) { message('Disconnected. Clipboard text was not sent.'); return; } const generation = v.generation; const text = await api.paste(); if (text !== null && views.get(key) === v && v.ready && !v.locked && v.generation === generation) v.terminal.paste(text); }
async function uploadFiles(key, files) {
  const view = views.get(key), generation = view?.generation;
  const paths = files ? await api.dropUpload(key, files) : await api.chooseUpload(key);
  if (!paths.length) return;
  // A second affirmative action is required to insert paths. Never execute a dropped file.
  const result = await entry('Files uploaded', 'Type INSERT to place the remote paths at the prompt, or cancel to leave the terminal untouched.', 'INSERT');
  if (result === 'INSERT' && views.get(key) === view && view?.ready && !view.locked && view.generation === generation) view.terminal.paste(paths.map(quote).join(' '));
}
function entry(title, text, value = '') { return new Promise(resolve => { entryResolve = resolve; $('entryTitle').textContent = title; $('entryMessage').textContent = text; $('entryValue').value = value; $('entryDialog').showModal(); $('entryValue').focus(); $('entryValue').select(); }); }
function finishEntry(value) { $('entryDialog').close(); const resolve = entryResolve; entryResolve = null; resolve?.(value); }
let newSessionResolve = null, newSessionTarget = null;
function chooseNewSession(id) {
  if (newSessionResolve) return Promise.reject(new Error('Finish naming the current new session first.'));
  const local = !!profiles.get(id)?.local;
  $('newSessionTitle').textContent = `New session on ${profiles.get(id)?.name || id}`;
  $('newSessionName').value = 'Session-' + new Date().toTimeString().slice(0, 8).replace(/:/g, '-');
  $('newSessionPersistence').hidden = local;
  $('newSessionPersistent').checked = true;
  newSessionTarget = id; $('newSessionBaud').value = ''; updateNewSessionBaud();
  return new Promise(resolve => { newSessionResolve = resolve; $('newSessionDialog').showModal(); $('newSessionName').focus(); $('newSessionName').select(); });
}
function updateNewSessionBaud() {
  const local = !!profiles.get(newSessionTarget)?.local, persistent = $('newSessionPersistent').checked;
  $('newSessionBaudField').hidden = local; $('newSessionBaud').disabled = local || persistent;
  const rate = profiles.get(newSessionTarget)?.terminalBaud || 0;
  $('newSessionBaud').options[0].textContent = 'Use connection setting (' + (rate ? rate + ' baud' : 'server default') + ')';
  $('newSessionBaudHint').textContent = persistent ? 'Persistent tmux panes manage their own terminal settings. This override is available when persistence is unchecked.' : 'Applied when this Standard SSH window is created. Sets the speed reported to remote terminal programs; does not change SSH bandwidth or a physical serial port. Each new Standard window can choose its own speed.';
}
function finishNewSession(accepted) {
  const resolve = newSessionResolve;
  const persistent = $('newSessionPersistent').checked, value = $('newSessionBaud').value;
  const result = accepted ? { name: $('newSessionName').value, persistent,
    terminalBaud: !persistent && !profiles.get(newSessionTarget)?.local && value !== '' ? Number(value) : undefined } : null;
  newSessionResolve = newSessionTarget = null; $('newSessionDialog').close(); resolve?.(result);
}
async function newSession(profileId) {
  const id = profileId || panes.get(active)?.profileId || selectedProfile || [...profiles.keys()].find(connected);
  if (!id || !connected(id)) { message('Connect to a server before creating a session.'); return; }
  requireViewCapacity();
  const choice = await chooseNewSession(id);
  if (choice === null) return;
  await withViewCapacity(async release => {
    const pane = await api.create(id, choice.name, choice.persistent, choice.terminalBaud); panes.set(pane.key, pane);
    release(); await openPane(pane.key);
  });
}
async function performSessionAction(key, action) {
  const p = panes.get(key) || views.get(key)?.pane; if (!p) return;
  if (action === 'disconnect') { if (!p.local) return closeView(key); return; }
  if (action === 'end') {
    const related = [...views].filter(([, v]) => v.pane.profileId === p.profileId && v.pane.sessionId === p.sessionId && v.pane.sessionToken === p.sessionToken).map(([viewKey]) => viewKey);
    if (await api.end(key)) for (const viewKey of related) await closeView(viewKey);
    return;
  }
  if (action === 'rename') {
    const name = await entry('Rename session', `New name for ${p.sessionName}`, p.sessionName);
    if (name !== null && name !== p.sessionName) return api.rename(key, name);
  }
}
function showFind() { $('searchbar').hidden = false; $('searchText').focus(); }
async function showHistory(key = active) { if (!key) return; historyKey = key; $('historyDialog').showModal(); $('archiveQuery').focus(); await searchArchive(); }
async function searchArchive() { $('archiveResults').textContent = 'Searching…'; const rows = await api.history(historyKey, $('archiveQuery').value); $('archiveResults').textContent = rows.length ? rows.map(r => `[${new Date(r.at).toLocaleString()}] ${r.text}`).join('\n') : 'No matching recorded output. Enable “Save searchable output on this PC” in the connection settings to record future output while views are open.'; }
function editConnection(p = {}) {
  const form = $('connectionForm'); form.reset(); $('connectionError').textContent = '';
  if (!p.id) for (const [key, value] of Object.entries(sessionDefaults)) if (form.elements[key]) { if (form.elements[key].type === 'checkbox') form.elements[key].checked = value; else form.elements[key].value = value; }
  for (const [key, value] of Object.entries(p)) if (form.elements[key]) { if (form.elements[key].type === 'checkbox') form.elements[key].checked = value; else form.elements[key].value = value; }
  $('connectionTitle').textContent = p.id ? 'Edit connection' : 'Save a connection'; updateAuthenticationFields(); updateSessionMode(); $('connectionDialog').showModal(); form.elements.name.focus();
}
function updateAuthenticationFields() {
  const form = $('connectionForm'), password = form.elements.auth.value === 'password';
  $('keyField').hidden = form.elements.auth.value !== 'key'; $('rememberPasswordField').hidden = !password;
  if (form.elements.rememberPassword) { form.elements.rememberPassword.disabled = !password; if (!password) form.elements.rememberPassword.checked = false; }
}
function appearanceFields() {
  const form = $('preferencesForm');
  return { ...Object.fromEntries(Object.keys(baseColors).map(key => [key, form.elements[key].value])),
    copyOnSelect: form.elements.copyOnSelect.checked,
    palette: { ...Object.fromEntries(colorKeys.map(key => [key, form.elements['palette-' + key].value])), extendedAnsi: [...preferencePalette.extendedAnsi] } };
}
function indexedColor() { return Math.max(16, Math.min(255, Math.round(Number($('indexedColor').value) || 16))); }
function showIndexedColor() { $('indexedPicker').value = preferencePalette.extendedAnsi[indexedColor() - 16]; }
function fillPalette(palette) {
  preferencePalette = { ...palette, extendedAnsi: [...palette.extendedAnsi] };
  for (const key of colorKeys) $('preferencesForm').elements['palette-' + key].value = palette[key];
  $('palettePreset').value = Object.keys(presets).find(name => { const defaults = presetPalette(name); return colorKeys.every(key => palette[key] === defaults[key]) && palette.extendedAnsi.every((color, i) => color === defaults.extendedAnsi[i]); }) || '';
  showIndexedColor();
}
function previewAppearance() {
  const colors = appearanceFields(); applyAppearance(colors);
  $('palettePreview').style.backgroundColor = colors.terminalBackground; $('palettePreview').style.color = colors.text;
  for (const span of $('palettePreview').querySelectorAll('[data-color]')) span.style.color = colors.palette[span.dataset.color];
  for (const key of colorKeys) $('hex-' + key).textContent = colors.palette[key].toUpperCase();
}
function selectPreferenceSection(section, focus = false) {
  if (!['copy', 'terminal', 'system', 'actions', 'favorites', 'notifications', 'sessions'].includes(section)) section = 'copy';
  preferenceSection = section;
  for (const control of document.querySelectorAll('[data-preference-section]')) {
    const selected = control.dataset.preferenceSection === section;
    control.setAttribute('aria-selected', String(selected)); control.tabIndex = selected ? 0 : -1;
    $('preferences-' + control.dataset.preferenceSection).hidden = !selected;
  }
  $('resetAppearance').hidden = !['terminal', 'system'].includes(section);
  $('preferencesContent').scrollTop = 0;
  if (focus) $('preferenceTab-' + section).focus();
}
function syncNotificationOptions() {
  const form = $('preferencesForm');
  for (const key of ['notificationAudio', 'notificationDesktop', 'notificationVisual']) form.elements[key].disabled = !form.elements.notificationEnabled.checked;
}
function blockPreferences(saving) {
  preferenceSaving = saving; $('preferencesContent').inert = saving;
  for (const control of document.querySelectorAll('[data-preference-section]')) control.disabled = saving;
  $('savePreferences').disabled = saving || !preferenceLoaded; $('cancelPreferences').disabled = saving; $('resetAppearance').disabled = saving;
  window.NerdSSHellPanes.blockConfiguration(saving);
}
async function openPreferences(section = preferenceSection) {
  if (preferenceSaving) return;
  if ($('preferencesDialog').open) { selectPreferenceSection(section, true); return; }
  const generation = ++preferenceGeneration;
  const form = $('preferencesForm');
  for (const key of Object.keys(baseColors)) form.elements[key].value = appearance[key];
  form.elements.copyOnSelect.checked = appearance.copyOnSelect;
  for (const [key, field] of Object.entries({ enabled: 'notificationEnabled', audio: 'notificationAudio', desktop: 'notificationDesktop', visual: 'notificationVisual' })) form.elements[field].checked = notifications[key];
  for (const [key, value] of Object.entries(sessionDefaults)) { if (form.elements[key].type === 'checkbox') form.elements[key].checked = value; else form.elements[key].value = value; }
  syncNotificationOptions();
  for (const field of $('paletteColors').querySelectorAll('.palette-target')) field.classList.remove('palette-target');
  $('paletteHelp').textContent = 'Select an example above to locate its palette color. Your editor may use different syntax colors.';
  fillPalette(appearance.palette); previewAppearance();
  preferenceLoaded = false; blockPreferences(false);
  $('preferencesStatus').textContent = 'Loading your saved actions and favorites…';
  selectPreferenceSection(section); $('preferencesDialog').showModal(); $('preferenceTab-' + preferenceSection).focus();
  try {
    await window.NerdSSHellPanes.beginConfiguration();
    if (generation !== preferenceGeneration || !$('preferencesDialog').open) return;
    preferenceLoaded = true; $('savePreferences').disabled = false; $('preferencesStatus').textContent = '';
  } catch (e) {
    if (generation === preferenceGeneration && $('preferencesDialog').open) $('preferencesStatus').textContent = `Could not load settings: ${e.message}. Close Preferences and try again.`;
  }
}
function closePreferences() {
  if (preferenceSaving) return;
  preferenceGeneration++; preferenceLoaded = false;
  window.NerdSSHellPanes.cancelConfiguration(); $('preferencesDialog').close(); applyAppearance(appearance);
}
async function savePreferences() {
  if (preferenceSaving || !preferenceLoaded || !$('preferencesDialog').open) return;
  const form = $('preferencesForm');
  if (!form.checkValidity()) { selectPreferenceSection('sessions'); form.reportValidity(); return; }
  try {
    const request = {
      appearance: appearanceFields(),
      notifications: { enabled: form.elements.notificationEnabled.checked, audio: form.elements.notificationAudio.checked, desktop: form.elements.notificationDesktop.checked, visual: form.elements.notificationVisual.checked },
      sessionDefaults: { scrollback: Number(form.elements.scrollback.value), archiveMB: Number(form.elements.archiveMB.value), record: form.elements.record.checked, startup: form.elements.startup.value, autoConnect: form.elements.autoConnect.checked },
      actionConfiguration: window.NerdSSHellPanes.stageConfiguration()
    };
    blockPreferences(true); $('preferencesStatus').textContent = 'Saving preferences…';
    const saved = await api.savePreferences(request);
    appearance = NerdSSHellAppearance.appearance(saved.appearance); notifications = saved.notifications; sessionDefaults = saved.sessionDefaults;
    window.NerdSSHellPanes.commitConfiguration();
    applyAppearance(appearance);
    for (const view of views.values()) view.attentionTracker?.sample();
    renderAttentionIndicators(); $('preferencesDialog').close();
  } catch (e) { $('preferencesStatus').textContent = e.message; }
  finally { blockPreferences(false); }
}
window.NerdSSHellPreferences = { open: section => run(openPreferences(section)) };
function showCredentialPrompt(event) {
  promptId = event.id; promptProfileId = event.profileId || null; promptKind = event.kind;
  $('promptTitle').textContent = event.title; $('promptMessage').textContent = event.message + (event.detail ? '\n\n' + event.detail : '');
  $('promptValue').type = event.secret ? 'password' : 'text'; $('promptValue').value = ''; $('promptValue').hidden = ['host-trust', 'confirmation'].includes(promptKind);
  const remember = !['host-trust', 'confirmation'].includes(promptKind) && event.secret === true && event.rememberPasswordAvailable === true;
  $('promptRememberField').hidden = !remember; $('promptRemember').checked = remember && event.rememberPassword === true;
  promptChoiceResponses.clear(); $('promptChoices').replaceChildren();
  $('promptAccept').hidden = false; $('cancelPrompt').textContent = 'Cancel';
  if (promptKind === 'confirmation') {
    if (!Array.isArray(event.buttons) || !Number.isInteger(event.cancelId) || event.cancelId < 0 || event.cancelId >= event.buttons.length) { replyCredentialPrompt(true); return; }
    const choices = event.buttons.map((text, index) => ({ text, index })).filter(choice => choice.index !== event.cancelId);
    $('promptAccept').hidden = choices.length === 0; $('cancelPrompt').textContent = event.buttons[event.cancelId];
    for (const [position, choice] of choices.entries()) {
      const control = position === 0 ? $('promptAccept') : element('button');
      control.type = 'submit'; control.textContent = choice.text;
      promptChoiceResponses.set(control, 'choice:' + choice.index);
      if (position) { control.addEventListener('click', suppressPromptDoubleClick); $('promptChoices').append(control); }
    }
  } else $('promptAccept').textContent = promptKind === 'host-trust' ? 'Trust and connect' : 'Continue';
  $('promptDialog').showModal(); (['host-trust', 'confirmation'].includes(promptKind) ? $('cancelPrompt') : $('promptValue')).focus();
}
function clearCredentialPrompt() {
  promptId = null; promptProfileId = null; promptKind = null; promptChoiceResponses.clear(); $('promptChoices').replaceChildren(); $('promptValue').value = ''; $('promptRemember').checked = false; $('promptRememberField').hidden = true; $('promptDialog').close();
}
function replyCredentialPrompt(cancelled = false, submitter = null) {
  if (!cancelled && (promptKind === 'host-trust' && submitter !== $('promptAccept') || promptKind === 'confirmation' && !promptChoiceResponses.has(submitter))) return;
  const id = promptId, value = cancelled ? null : promptKind === 'confirmation' ? promptChoiceResponses.get(submitter) : promptKind === 'host-trust' ? 'trust' : $('promptValue').value;
  const remember = !cancelled && !['host-trust', 'confirmation'].includes(promptKind) && !$('promptRememberField').hidden && $('promptRemember').checked === true;
  clearCredentialPrompt();
  if (id) run(cancelled ? api.promptReply(id, null) : api.promptReply(id, value, remember));
}
function isAppShortcut(e) { return e.key === 'F11' || e.ctrlKey && (e.key === 'Tab' || e.altKey && ['1', '2', '3', '4'].includes(e.key) || e.shiftKey && ['T', 't', 'W', 'w', 'P', 'p'].includes(e.key)); }
api.onEvent(event => {
  if (event.type === 'prompt') showCredentialPrompt(event);
  else if (event.type === 'promptCancelled') { if (promptId === event.id) clearCredentialPrompt(); }
  else if (event.type === 'profile') {
    if (profiles.has(event.profile.id)) { profiles.set(event.profile.id, event.profile); renderConnections(); }
    if (promptId && promptProfileId === event.profile.id && event.profile.rememberPassword !== true) $('promptRemember').checked = false;
  }
  else if (event.type === 'status') {
    if (newSessionTarget === event.profileId && event.state !== 'connected') finishNewSession(false);
    statuses.set(event.profileId, event);
    if (event.state !== 'connected') for (const v of views.values()) if (v.pane.profileId === event.profileId) { v.ready = false; v.filesAttached = false; v.generation++; v.attentionTracker?.reset(); v.state.textContent = event.state; window.NerdSSHellPanes?.refresh(v); }
    renderConnections(); renderTabs();
    syncFiles();
  } else if (event.type === 'panes') {
    for (const [key, p] of panes) if (p.profileId === event.profileId) panes.delete(key);
    for (const p of event.panes) { panes.set(p.key, p); const v = views.get(p.key); if (v) { v.pane = p; v.wrapper.querySelector('.pane-title').textContent = label(p); v.locationBadge.textContent = p.local ? 'LOCAL' : 'REMOTE'; v.locationBadge.className = 'pane-location-badge ' + (p.local ? 'local' : 'remote'); if (p.dead) v.attentionTracker?.reset(); } }
    renderConnections(); renderTabs(); syncFiles();
  } else if (event.type === 'connected') {
    run((async () => {
      const p = profiles.get(event.profileId); if (!p) return;
      for (const pane of event.panes) panes.set(pane.key, pane);
      const live = event.panes.filter(x => !x.dead).map(x => x.key), previous = [...new Set([...order, ...savedOrder])].filter(k => live.includes(k));
      const wanted = p.sessionMode === 'standard' ? live : p.startup === 'all' ? [...new Set([...previous, ...live])] : p.startup === 'restore' ? previous : order.filter(k => live.includes(k));
      let skipped = 0;
      for (const key of wanted) {
        if (!views.has(key) && views.size + pendingViewSlots >= maxOpenViews) { skipped++; continue; }
        await openPane(key, false);
      }
      // Standard connect owns a pending renderer slot and attaches its returned
      // shell immediately after IPC resolves. Its early event is not overflow.
      if (skipped && !(p.sessionMode === 'standard' && pendingViewSlots > 0)) message(`${skipped} session(s) remain in the sidebar. Close a view to open another (limit ${maxOpenViews}); their remote work keeps running.`);
      if (desiredActive && order.includes(desiredActive)) { active = desiredActive; desiredActive = ''; slots = [...savedSlots]; }
      render();
    })());
  } else if (event.type === 'snapshot') {
    const v = views.get(event.key); if (!v) return;
    v.ready = false; v.attentionTracker?.suspend(); const generation = ++v.generation;
    v.filesAttached = true; syncFiles();
    v.render = v.render.then(async () => {
      if (views.get(event.key) !== v || v.generation !== generation) return;
      v.terminal.reset(); v.terminal.resize(event.cols, event.rows);
      if (event.alternate) await write(v.terminal, '\x1b[?1049h');
      await write(v.terminal, decode(event.data));
      if (views.get(event.key) !== v || v.generation !== generation) return;
      let controls = `\x1b[${Math.max(1, Math.min(event.rows, event.cursorY + 1))};${Math.max(1, Math.min(event.cols, event.cursorX + 1))}H`;
      [1, 1000, 1002, 1003, 1006, 2004, 25].forEach((mode, i) => { controls += `\x1b[?${mode}${event.modes[i] ? 'h' : 'l'}`; });
      await write(v.terminal, controls);
      if (views.get(event.key) !== v || v.generation !== generation) return;
      v.ready = !v.pane.dead; v.state.textContent = v.pane.dead ? 'Ended' : v.pane.administrator ? 'Live · Administrator' : v.pane.local ? 'Live' : v.pane.standard ? 'Live · Standard' : 'Live'; fit(v); renderTabs(); window.NerdSSHellPanes?.refresh(v);
      if (active === event.key) await api.activeSession(event.key);
      v.attentionTracker?.resume();
    }).catch(e => message(e.message));
  } else if (event.type === 'output') {
    const v = views.get(event.key); if (!v) { run(api.ack(event.key, event.epoch, event.sequence)); return; }
    const generation = v.generation;
    v.render = v.render.then(async () => { if (views.get(event.key) === v && v.generation === generation) await write(v.terminal, decode(event.data)); await api.ack(event.key, event.epoch, event.sequence); }).catch(e => message(e.message));
  } else if (event.type === 'recovering' || event.type === 'recovery-failed') {
    const v = views.get(event.key);
    if (v) { v.ready = false; v.generation++; if (event.type === 'recovering') v.attentionTracker?.suspend(); else v.attentionTracker?.reset(); v.state.textContent = event.type === 'recovering' ? 'Refreshing…' : 'Refresh failed — reopen view'; renderTabs(); window.NerdSSHellPanes?.refresh(v); }
  } else if (event.type === 'standard-ended') {
    panes.delete(event.key); renderConnections();
    const v = views.get(event.key); if (v) { v.ready = false; v.filesAttached = false; v.pane.dead = true; v.attentionTracker?.reset(); v.state.textContent = 'Ended — open a new shell'; v.files?.context(v.files.label, false, label(v.pane)); renderTabs(); window.NerdSSHellPanes?.refresh(v); }
  } else if (event.type === 'ended' || event.type === 'detached') {
    if (event.type === 'ended') { panes.delete(event.key); renderConnections(); }
    const v = views.get(event.key); if (v) { v.ready = false; v.filesAttached = false; v.generation++; v.attentionTracker?.reset(); v.state.textContent = event.type === 'ended' ? 'Ended' : 'Detached'; v.files?.context(v.files.label, false, label(v.pane)); renderTabs(); window.NerdSSHellPanes?.refresh(v); }
  } else if (event.type === 'attention-activate') {
    if (views.has(event.key)) activate(event.key);
  } else if (event.type === 'attention-audio') {
    if (notifications.enabled && notifications.audio) window.NerdSSHellAttention.playAlert();
  } else if (event.type === 'notice') message(event.message);
  else if (event.type === 'transfer') {
    if (event.status === 'finished') activeTransfers.delete(event.id); else activeTransfers.set(event.id, event);
    $('transfers').replaceChildren(); $('transfers').hidden = activeTransfers.size === 0;
    for (const t of activeTransfers.values()) { const row = element('div', 'transfer-row'); row.append(element('span', '', `${profiles.get(t.profileId)?.name || views.get(t.key)?.files?.label || 'Transfer'} · ${views.get(t.key)?.pane.sessionName || 'Files'} · ${t.name}: ${t.total ? Math.round(t.transferred / t.total * 100) + '%' : t.status}`), button('Cancel', () => api.cancelTransfer(t.id), 'small')); $('transfers').append(row); }
  }
});
$('connectionForm').addEventListener('submit', e => {
  e.preventDefault(); run((async () => {
    const form = e.target, p = Object.fromEntries(new FormData(form)); p.autoConnect = form.elements.autoConnect.checked; p.record = form.elements.record.checked; p.rememberPassword = p.auth === 'password' && form.elements.rememberPassword.checked;
    try { const result = await api.saveProfile(p); profiles.set(result.id, result); selectedProfile = result.id; $('connectionDialog').close(); renderConnections(); await connectProfile(result.id); }
    catch (error) { $('connectionError').textContent = error.message; message(error.message); }
  })());
});
function updateSessionMode() { $('startupField').hidden = false; $('sessionModeHint').textContent = 'Choose persistence in New session. Connecting never starts a new persistent job.'; }
$('connectionForm').elements.auth.addEventListener('change', updateAuthenticationFields);
$('chooseKey').addEventListener('click', () => run((async () => { const file = await api.chooseKey(); if (file) $('connectionForm').elements.keyPath.value = file; })()));
$('addConnection').onclick = $('welcomeConnect').onclick = () => editConnection();
$('cancelConnection').onclick = () => $('connectionDialog').close();
function suppressPromptDoubleClick(e) { if (e.detail > 1) { e.preventDefault(); e.stopImmediatePropagation(); } }
$('promptAccept').addEventListener('click', suppressPromptDoubleClick);
$('promptForm').onsubmit = e => { e.preventDefault(); replyCredentialPrompt(false, e.submitter); };
$('cancelPrompt').onclick = () => replyCredentialPrompt(true);
$('promptDialog').addEventListener('cancel', e => { e.preventDefault(); replyCredentialPrompt(true); });
$('promptDialog').addEventListener('close', () => { if (!$('promptDialog').open && promptId) replyCredentialPrompt(true); });
$('promptDialog').addEventListener('keydown', e => {
  if (['host-trust', 'confirmation'].includes(promptKind) && e.key === 'Enter' && e.target !== $('cancelPrompt') && !(promptKind === 'host-trust' ? e.target === $('promptAccept') : promptChoiceResponses.has(e.target))) e.preventDefault();
});
$('newSessionForm').onsubmit = e => { e.preventDefault(); finishNewSession(true); };
$('newSessionPersistent').addEventListener('change', updateNewSessionBaud);
$('cancelNewSession').onclick = () => finishNewSession(false);
$('newSessionDialog').addEventListener('cancel', e => { e.preventDefault(); finishNewSession(false); });
$('entryForm').onsubmit = e => { e.preventDefault(); finishEntry($('entryValue').value); }; $('cancelEntry').onclick = () => finishEntry(null); $('entryDialog').addEventListener('cancel', () => finishEntry(null));
function chooseLayout(choice) {
  if (!['1', '2-side-by-side', '2-stacked', '4'].includes(choice)) return;
  layout = choice.startsWith('2-') ? 2 : Number(choice);
  if (layout === 2) twoPaneOrientation = choice.slice(2);
  render(); remember();
}
for (const control of document.querySelectorAll('.layout-buttons [data-layout-choice]')) control.onclick = () => chooseLayout(control.dataset.layoutChoice);
$('preferences').onclick = () => run(openPreferences());
for (const control of document.querySelectorAll('[data-preference-section]')) {
  control.onclick = () => { if (!preferenceSaving) selectPreferenceSection(control.dataset.preferenceSection); };
  control.addEventListener('keydown', e => {
    if (preferenceSaving || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const controls = [...document.querySelectorAll('[data-preference-section]')], index = controls.indexOf(control);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? controls.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : controls.length - 1)) % controls.length;
    selectPreferenceSection(controls[next].dataset.preferenceSection, true);
  });
}
for (let family = 0; family < 8; family++) {
  const row = element('div', 'palette-row');
  row.append(element('strong', 'palette-family', family === 0 ? 'Black / gray' : paletteLabels[family]));
  for (const index of [family, family + 8]) {
    const key = colorKeys[index], label = element('label', 'palette-color'), input = element('input');
    const caption = element('span', 'palette-caption');
    caption.append(element('span', '', paletteLabels[index]), element('small', '', 'Slot ' + index));
    const hex = element('code', 'palette-hex'); hex.id = 'hex-' + key;
    input.type = 'color'; input.name = input.id = 'palette-' + key;
    input.setAttribute('aria-label', `${paletteLabels[index]} — palette slot ${index}`);
    label.append(caption, input, hex); row.append(label);
    input.addEventListener('input', () => { $('palettePreset').value = ''; });
  }
  $('paletteColors').append(row);
}
for (const token of $('palettePreview').querySelectorAll('[data-color]')) {
  const key = token.dataset.color, index = colorKeys.indexOf(key), role = exampleRoles[key];
  token.title = `${role} in this example → ${paletteLabels[index]} (slot ${index})`;
  token.setAttribute('aria-label', token.title);
  token.addEventListener('click', () => {
    const input = $('preferencesForm').elements['palette-' + key];
    for (const field of $('paletteColors').querySelectorAll('.palette-color')) field.classList.toggle('palette-target', field.contains(input));
    $('paletteHelp').textContent = `${role} in this example use ${paletteLabels[index]} (slot ${index}). Edit the outlined swatch below. Your program may choose a different slot.`;
    input.scrollIntoView({ block: 'nearest' }); input.focus({ preventScroll: true });
  });
}
for (const name of Object.keys(presets)) { const option = element('option', '', name); option.value = name; $('palettePreset').append(option); }
$('palettePreset').onchange = () => { if ($('palettePreset').value) { fillPalette(presetPalette($('palettePreset').value)); previewAppearance(); } };
$('indexedColor').onchange = () => { $('indexedColor').value = indexedColor(); showIndexedColor(); };
$('indexedPicker').addEventListener('input', () => { preferencePalette.extendedAnsi[indexedColor() - 16] = $('indexedPicker').value; $('palettePreset').value = ''; });
$('resetIndexedColor').onclick = () => { preferencePalette.extendedAnsi[indexedColor() - 16] = presetPalette().extendedAnsi[indexedColor() - 16]; showIndexedColor(); $('palettePreset').value = ''; previewAppearance(); };
$('preferencesForm').addEventListener('input', e => { if (e.target.type === 'color') previewAppearance(); });
$('preferencesForm').elements.notificationEnabled.addEventListener('change', syncNotificationOptions);
$('preferencesForm').onsubmit = e => e.preventDefault();
$('savePreferences').onclick = () => run(savePreferences());
$('resetAppearance').onclick = () => { for (const [key, value] of Object.entries(baseColors)) $('preferencesForm').elements[key].value = value; fillPalette(defaultAppearance.palette); previewAppearance(); };
$('themeDark').onclick = () => { for (const key of ['terminalBackground', 'uiBackground', 'text']) $('preferencesForm').elements[key].value = baseColors[key]; previewAppearance(); };
$('themeLight').onclick = () => { const form = $('preferencesForm'); form.elements.terminalBackground.value = '#ffffff'; form.elements.uiBackground.value = '#f3f2f7'; form.elements.text.value = '#26232b'; previewAppearance(); };
$('cancelPreferences').onclick = closePreferences;
$('preferencesDialog').addEventListener('cancel', e => { e.preventDefault(); closePreferences(); });
$('preferencesDialog').addEventListener('close', () => { if (!$('preferencesDialog').open) { preferenceGeneration++; preferenceLoaded = false; window.NerdSSHellPanes.cancelConfiguration(); applyAppearance(appearance); } });
$('help').onclick = () => $('helpDialog').showModal(); $('closeHelp').onclick = () => $('helpDialog').close();
for (const link of $('helpDialog').querySelectorAll('[data-public-link]')) link.addEventListener('click', () => run(api.publicLink(link.dataset.publicLink)));
$('findNext').onclick = () => views.get(active)?.search.findNext($('searchText').value); $('findPrev').onclick = () => views.get(active)?.search.findPrevious($('searchText').value);
$('searchText').onkeydown = e => { if (e.key === 'Enter') { if (e.shiftKey) $('findPrev').click(); else $('findNext').click(); } };
$('closeSearch').onclick = () => { $('searchbar').hidden = true; views.get(active)?.terminal.focus(); };
$('archiveSearch').onclick = () => run(searchArchive()); $('archiveQuery').onkeydown = e => { if (e.key === 'Enter') run(searchArchive()); };
$('archiveExport').onclick = () => run(api.export(historyKey).then(p => { if (p) message('Exported to ' + p); })); $('closeHistory').onclick = () => $('historyDialog').close();
for (const axis of ['X', 'Y']) {
  const divider = $('divider' + axis);
  divider.addEventListener('pointerdown', e => {
    e.preventDefault(); divider.setPointerCapture(e.pointerId); divider.classList.add('dragging');
    const move = event => { const r = $('grid').getBoundingClientRect(); if (axis === 'X') splitX = Math.max(20, Math.min(80, (event.clientX - r.left) / r.width * 100)); else splitY = Math.max(20, Math.min(80, (event.clientY - r.top) / r.height * 100)); $('grid').style.setProperty('--split-' + axis.toLowerCase(), (axis === 'X' ? splitX : splitY) + '%'); };
    const up = () => { divider.classList.remove('dragging'); divider.removeEventListener('pointermove', move); divider.removeEventListener('pointerup', up); remember(); };
    divider.addEventListener('pointermove', move); divider.addEventListener('pointerup', up);
  });
}
document.addEventListener('keydown', e => {
  if (e.key === 'F11') { e.preventDefault(); run(api.fullscreen()); return; }
  if (document.querySelector('dialog[open]')) return;
  // A custom app protocol does not reliably produce a native paste event for
  // Ctrl+V. Route the terminal shortcut through the same confirmed IPC path as
  // right-click, and cancel the default action so it cannot paste twice.
  if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'v') {
    const host = e.target.closest?.('.terminal-host');
    if (host) {
      e.preventDefault(); e.stopImmediatePropagation();
      const view = [...views].find(([, v]) => v.host === host);
      if (view) run(paste(view[0]));
      return;
    }
  }
  if (e.ctrlKey && e.key === 'Tab') { e.preventDefault(); if (order.length) activate(order[(order.indexOf(active) + (e.shiftKey ? order.length - 1 : 1)) % order.length]); }
  else if (e.ctrlKey && e.altKey && ['1', '2', '3', '4'].includes(e.key)) { e.preventDefault(); layout = e.key === '3' ? 2 : Number(e.key); if (layout === 2) twoPaneOrientation = e.key === '3' ? 'stacked' : 'side-by-side'; render(); remember(); }
  else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 't') { e.preventDefault(); run(newSession()); }
  else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'w') { e.preventDefault(); if (active) run(closeView(active)); }
}, true);
document.addEventListener('paste', e => {
  const host = e.target.closest('.terminal-host');
  if (!host) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const view = [...views].find(([, v]) => v.host === host);
  if (view) run(paste(view[0]));
}, true);
window.addEventListener('beforeunload', () => { clearTimeout(saveTimer); api.workspace({ layout, twoPaneOrientation, order, slots, active, splitX, splitY }).catch(() => {}); });
run((async () => {
  const state = await api.state(); appearance = NerdSSHellAppearance.appearance(state.appearance); notifications = { ...notifications, ...state.notifications }; sessionDefaults = { ...sessionDefaults, ...state.sessionDefaults }; applyAppearance(appearance); for (const p of state.profiles) profiles.set(p.id, p);
  if (Number.isInteger(state.sessionLimits?.maxOpenViews) && state.sessionLimits.maxOpenViews > 0 && state.sessionLimits.maxOpenViews <= 64) maxOpenViews = state.sessionLimits.maxOpenViews;
  savedOrder = state.workspace.order; savedSlots = state.workspace.slots || []; desiredActive = state.workspace.active; layout = state.workspace.layout; twoPaneOrientation = state.workspace.twoPaneOrientation || 'side-by-side'; splitX = state.workspace.splitX; splitY = state.workspace.splitY; $('version').textContent = 'v' + state.version; $('aboutVersion').textContent = state.version;
  render(); for (const p of profiles.values()) if (p.autoConnect) { try { await connectProfile(p.id); } catch (e) { message(e.message); } }
})());
