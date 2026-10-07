/* global api, $, profiles, panes, views, statuses, active, openPane, render, element, button, message, run, BetterSSHCommandReview */
'use strict';
(function () {
  const dialog = $('workbenchDialog'), target = $('wbTarget'), code = $('wbCode'), search = $('wbSearch');
  let targets = [], actions = [], favorites = [], serial = 0, ticket = null, template = null, busy = false, runningToken = null, shareSerial = 0, sourceKey, openSerial = 0, pendingReopen = 0;
  const controls = ['wbReview', 'wbRun', 'wbDetect', 'wbOpenLocal', 'wbOpenFolder'];
  function error(e) { $('wbFeedback').textContent = e.message || String(e); }
  function invalidate() {
    serial++; const old = ticket; ticket = null;
    if (old) api.workbenchCancelReview(old.token).catch(() => {});
    if (runningToken) api.workbenchCancelReview(runningToken).catch(() => {});
    $('wbReviewDetails').hidden = true; $('wbRun').disabled = true; $('wbTypedHost').value = '';
  }
  function setBusy(value) {
    busy = value;
    for (const id of controls) $(id).disabled = value || (id === 'wbRun' && !ticket);
    target.disabled = value || !!sourceKey; code.readOnly = value; search.disabled = value;
    $('wbImport').disabled = value; $('wbBlocks').disabled = value;
    for (const b of $('wbActionList').querySelectorAll('button')) b.disabled = value || b.dataset.unavailable === 'true' || b.dataset.saving === 'true';
    $('wbClose').disabled = value;
  }
  async function acceptResult(result) {
    if (!result) return;
    profiles.set(result.profile.id, result.profile);
    statuses.set(result.profile.id, { state: 'connected', detail: result.profile.local ? 'Local console — not persistent' : `${result.profile.username}@${result.profile.host}` });
    panes.set(result.pane.key, result.pane);
    await openPane(result.pane.key);
  }
  async function open(options = {}) {
    if (busy) return;
    const request = ++openSerial;
    pendingReopen = dialog.open ? 0 : request;
    invalidate(); // A new destination request immediately revokes old approval.
    const generation = serial;
    try {
      const context = await api.workbenchContext(); if (generation !== serial) return;
      targets = context.targets; favorites = context.preferences.favorites;
      target.replaceChildren();
      for (const t of targets) { const option = element('option', '', t.title); option.value = t.id; target.append(option); }
      const preferred = options.target || panes.get(active)?.profileId;
      if (options.key && !targets.some(t => t.id === options.target)) throw new Error('The selected pane destination is no longer connected.');
      sourceKey = options.key; target.disabled = !!sourceKey;
      if (targets.some(t => t.id === preferred)) target.value = preferred;
      if (!targets.length) { const option = element('option', '', 'Connect to an SSH server first'); option.value = ''; target.append(option); }
      $('wbFeedback').textContent = ''; search.value = ''; invalidate();
      template = null; code.value = options.code !== undefined ? options.code : '';
      if (pendingReopen === request) pendingReopen = 0;
      if (!dialog.open) dialog.showModal();
      await loadActions();
      if (request !== openSerial || !dialog.open) return;
      if (options.actionId && dialog.open && target.value === preferred) {
        const action = actions.find(a => a.id === options.actionId);
        if (!action || !action.enabled) throw new Error('This action is no longer available for this pane.');
        const staged = await chooseAction(action);
        if (staged && options.review === true && request === openSerial && dialog.open && target.value === preferred && sourceKey === options.key) await review();
      } else search.focus();
    } catch (e) { if (request === openSerial) message(e.message); }
    finally { if (pendingReopen === request) pendingReopen = 0; }
  }
  async function loadActions() {
    invalidate(); const generation = serial, id = target.value;
    actions = []; renderActions();
    const destination = targets.find(t => t.id === id), local = destination?.local;
    const localName = destination?.shell === 'cmd' ? 'Command Prompt' : 'PowerShell';
    $('wbLocalTools').hidden = !local; $('wbDetect').hidden = !!local;
    $('wbOpenLocal').textContent = 'Open ' + localName;
    $('wbTargetSummary').textContent = targets.find(t => t.id === id)?.title || 'No connected destination';
    $('wbScope').textContent = local ? `New ${localName} console on this PC. Starts in your home folder. ${destination.shell === 'cmd' ? 'AutoRun commands are disabled.' : 'PowerShell profiles are not loaded.'} ${destination.administrator ? 'A new administrator console requests Windows UAC.' : 'No elevation is requested.'}` : 'New remote task console, not the currently running agent/editor. Starts in the SSH account’s default directory; include an explicit cd when needed. Task syntax is POSIX /bin/sh.';
    $('wbReview').disabled = !id; $('wbDetect').disabled = !id;
    if (!id) return;
    try {
      const result = await api.workbenchActions(id, sourceKey); if (generation !== serial) return;
      actions = result.actions;
      favorites = result.favorites || favorites;
      $('wbPlatform').textContent = result.platform.system === 'unknown' ? 'OS not inspected · Detect reads system information over a separate SSH channel.' : `${result.platform.system}${result.platform.id ? ' · ' + result.platform.id : ''}`;
      renderActions();
    } catch (e) { if (generation === serial) error(e); }
  }
  function renderActions() {
    const root = $('wbActionList'); root.replaceChildren();
    const query = search.value.toLocaleLowerCase().trim();
    const sorted = [...actions].sort((a, b) => Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)) || a.group.localeCompare(b.group));
    for (const a of sorted) {
      const terms = `${a.title} ${a.description} ${a.group} ${a.id} ${a.keywords || ''}`.toLocaleLowerCase();
      if (query && !query.split(/\s+/).every(word => terms.includes(word))) continue;
      const row = element('div', 'wb-action-row');
      const choose = button(a.title, () => chooseAction(a), 'wb-action', a.enabled ? a.description : a.reason);
      choose.disabled = busy || !a.enabled; choose.dataset.unavailable = String(!a.enabled);
      choose.append(element('small', '', a.enabled ? `${a.group} · ${a.risk === 'info' ? 'inspect' : a.risk === 'disruptive' ? 'interrupts work' : 'changes state'}` : `Unavailable: ${a.reason}`));
      const pin = button(favorites.includes(a.id) ? '★' : '☆', () => {
        if (busy || !window.BetterSSHPanes) return;
        invalidate(); dialog.close(); window.BetterSSHPanes.configure('favorites');
      }, 'wb-pin', 'Configure favorites for each operating system');
      pin.disabled = busy; pin.setAttribute('aria-label', `Configure favorites: ${a.title}`); pin.setAttribute('aria-pressed', String(favorites.includes(a.id)));
      row.append(choose, pin); root.append(row);
    }
    if (!root.children.length) root.append(element('p', 'hint', actions.length ? 'No matching actions.' : 'Choose a destination. Unsupported actions are never guessed.'));
  }
  async function chooseAction(a) {
    if (busy || !a.enabled) return;
    invalidate(); const generation = serial, id = target.value;
    try {
      const argument = a.argument ? $('wbArgument').value.trim() : '';
      const plan = await api.workbenchTemplate(id, a.id, argument, sourceKey); if (generation !== serial || id !== target.value || !dialog.open) return;
      code.value = plan.code; template = { actionId: a.id, argument };
      $('wbFeedback').textContent = `${plan.description}${plan.note ? '\n' + plan.note : ''}`; code.focus();
      return true;
    } catch (e) { if (generation === serial) error(e); }
  }
  async function review() {
    if (busy || !target.value) return;
    invalidate(); const generation = serial, id = target.value;
    try {
      const result = await api.workbenchReview(id, { code: code.value, ...template, ...(sourceKey ? { key: sourceKey } : {}) });
      if (generation !== serial || id !== target.value || !dialog.open) { await api.workbenchCancelReview(result.token); return; }
      ticket = result;
      $('wbReviewText').textContent = `${result.title}\n${result.destination}\n\n${result.persistence}\n${result.note}\n\n${result.warnings.join('\n\n')}\n\nExact command:\n${result.code}`;
      $('wbHostLabel').hidden = !result.confirmWord;
      $('wbHostPrompt').textContent = `Type ${result.confirmWord} to confirm this disruptive action`;
      $('wbReviewDetails').hidden = false; $('wbRun').disabled = false; $('wbReviewDetails').scrollIntoView({ block: 'nearest' });
    } catch (e) { if (generation === serial) error(e); }
  }
  async function execute() {
    if (busy || !ticket) return;
    const approved = ticket; ticket = null; runningToken = approved.token; serial++; setBusy(true);
    try {
      const result = await api.workbenchRun(approved.token, $('wbTypedHost').value);
      invalidate(); if (result) { dialog.close(); await acceptResult(result); }
      else $('wbFeedback').textContent = 'Cancelled. No task was started.';
    } catch (e) { invalidate(); error(e); }
    finally { runningToken = null; setBusy(false); renderActions(); }
  }
  async function localOpen(chooseFolder) {
    if (busy) return; setBusy(true);
    try { const result = await api.localOpen(target.value, chooseFolder); if (result) { dialog.close(); await acceptResult(result); } }
    catch (e) { error(e); } finally { setBusy(false); }
  }
  function onView(v) {
    if (v.lockButton) return;
    const bottom = v.wrapper.querySelector('.pane-bottom'), profile = profiles.get(v.pane.profileId);
    const badge = element('span', 'wb-target-badge', v.pane.local ? 'LOCAL · This PC' : `REMOTE · ${profile?.username || ''}@${profile?.host || ''}`);
    badge.title = v.pane.local ? `${v.pane.shellFamily === 'cmd' ? 'Command Prompt' : 'PowerShell'} running on this PC; not persistent across closing/reboot.` : `Actual SSH endpoint. Nested ssh or sudo in the terminal does not change this connection identity. ${v.pane.standard ? 'Not persistent.' : 'Server-side persistent session.'}`;
    const lock = button('Lock input', async () => { if (!v.ready) return message('This console is not ready.'); v.locked = await api.inputLock(v.pane.key, !v.locked); updateLock(v); }, 'wb-lock', 'Prevent accidental typing or paste; not a server-permission restriction');
    const more = button('Review command', () => open({ target: v.pane.profileId, key: v.pane.key }), 'small');
    bottom.prepend(badge); bottom.append(lock, more); v.lockButton = lock;
  }
  function updateLock(v) {
    v.wrapper.classList.toggle('input-locked', !!v.locked); if (v.lockButton) { v.lockButton.textContent = v.locked ? 'Unlock input' : 'Lock input'; v.lockButton.setAttribute('aria-pressed', String(!!v.locked)); }
  }
  function clearDiagnostics() {
    shareSerial++; $('wbDiagnosticsText').value = ''; $('wbDiagnosticsText').readOnly = false; $('wbDiagnosticsCopy').disabled = true;
  }
  async function diagnostics(includeOutput) {
    const generation = ++shareSerial, preview = $('wbDiagnosticsDialog'), editor = $('wbDiagnosticsText');
    editor.value = ''; editor.readOnly = true; $('wbDiagnosticsCopy').disabled = true;
    if (!preview.open) preview.showModal();
    try {
      const v = views.get(sourceKey || active), profile = v && profiles.get(v.pane.profileId);
      let text;
      if (includeOutput) {
        if (!v) throw new Error('Open a terminal first.');
        const excerpt = BetterSSHCommandReview.outputExcerpt(v.terminal);
        const endpoint = BetterSSHCommandReview.visibleText(v.pane.local ? 'LOCAL · This PC' : `REMOTE · ${profile?.name || ''} · ${profile?.username || ''}@${profile?.host || ''}`);
        text = `Captured: ${new Date().toISOString()}\nTarget: ${endpoint}\nSession: ${BetterSSHCommandReview.visibleText(v.pane.sessionName || '')}\nScreen excerpt: ${excerpt.rows} rows / ${excerpt.bytes} UTF-8 bytes from the ${excerpt.buffer} buffer. ${excerpt.omittedRows} older rows omitted.${excerpt.startsMidLine ? ' Begins mid-wrapped line.' : ''}\nNot a complete transcript or a command boundary. Soft wraps joined; control characters shown as U+ labels. Secrets are NOT automatically redacted.\n\n${excerpt.text}`;
      } else text = JSON.stringify(await api.workbenchDiagnostics(), null, 2);
      if (generation !== shareSerial || !preview.open) return;
      if (new TextEncoder().encode(text).length > 524288) throw new Error('Diagnostic preview exceeds 512 KiB. No text was copied.');
      editor.value = text; editor.readOnly = false; $('wbDiagnosticsCopy').disabled = false;
    } catch (e) { if (generation === shareSerial && preview.open) { editor.value = 'Could not prepare this preview: ' + e.message; editor.readOnly = true; } }
  }
  $('wbReview').onclick = review; $('wbRun').onclick = execute;
  $('wbOpenLocal').onclick = () => localOpen(false); $('wbOpenFolder').onclick = () => localOpen(true);
  $('wbDetect').onclick = async () => { if (busy || !target.value) return; const id = target.value; invalidate(); setBusy(true);
    try { await api.workbenchDetect(id, sourceKey); } catch (e) { error(e); } finally { setBusy(false); await loadActions(); } };
  target.onchange = () => { if (sourceKey) { invalidate(); $('wbFeedback').textContent = 'This action belongs to its original pane. Close and reopen the workbench to choose another destination.'; return; } template = null; $('wbFeedback').textContent = 'Destination changed. Existing command text has not been translated; review the shell syntax.'; loadActions(); };
  code.oninput = () => { template = null; invalidate(); }; search.oninput = renderActions;
  $('wbArgument').oninput = () => { /* Existing template retains its reviewed argument; selecting another action uses the new field. */ };
  $('wbImport').onclick = () => { try {
    const blocks = BetterSSHCommandReview.extractBlocks($('wbChat').value); $('wbBlocks').replaceChildren();
    const blank = element('option', '', 'Choose one block to stage'); blank.value = ''; $('wbBlocks').append(blank);
    blocks.forEach((b, i) => { const option = element('option', '', `${i + 1}. ${b.language} · ${b.code.split('\n').length} lines`); option.value = String(i); $('wbBlocks').append(option); });
    $('wbBlocks').onchange = () => { const i = $('wbBlocks').value; if (i !== '') { code.value = blocks[Number(i)].code; template = null; invalidate(); } };
    $('wbFeedback').textContent = blocks.length ? 'Select ONE block. No prompts are stripped, no commands are combined, and nothing runs automatically.' : 'No fenced code blocks found. Paste the command directly into the editor.';
  } catch (e) { error(e); } };
  $('wbClear').onclick = () => { if (busy) return; invalidate(); code.value = $('wbChat').value = ''; $('wbBlocks').replaceChildren(); template = null; };
  $('wbClose').onclick = () => { if (!busy) { invalidate(); dialog.close(); } };
  dialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); else invalidate(); });
  // HTML dialog close events are queued. A reopen requested after the dialog
  // closed can still be awaiting IPC when the previous close event arrives.
  // Explicit Close/Escape revoke synchronously; an old event must not cancel
  // that new request or a newly visible dialog.
  dialog.addEventListener('close', () => { if (!dialog.open && !(pendingReopen && pendingReopen === openSerial)) invalidate(); });
  $('wbDiagnostics').onclick = () => diagnostics(false); $('wbCopyOutput').onclick = () => diagnostics(true);
  $('wbDiagnosticsClose').onclick = () => { clearDiagnostics(); $('wbDiagnosticsDialog').close(); };
  $('wbDiagnosticsDialog').addEventListener('cancel', clearDiagnostics);
  $('wbDiagnosticsDialog').addEventListener('close', () => { if (!$('wbDiagnosticsDialog').open) clearDiagnostics(); });
  $('wbDiagnosticsCopy').onclick = () => { if ($('wbDiagnosticsCopy').disabled || !$('wbDiagnosticsDialog').open) return; return run((async () => {
    const text = $('wbDiagnosticsText').value;
    if (new TextEncoder().encode(text).length > 524288) throw new Error('Reviewed text exceeds 512 KiB. Nothing was copied.');
    await api.copy(text);
  })()); };
  document.addEventListener('keydown', e => { if (e.ctrlKey && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') { e.preventDefault(); e.stopImmediatePropagation(); if (!document.querySelector('dialog[open]')) open(); } }, true);
  api.onEvent(event => {
    if (event.type === 'status' && event.state !== 'connected' && event.profileId === target.value) {
      invalidate();
      if (dialog.open) $('wbFeedback').textContent = 'Destination connection changed. Review again after reconnecting; submitted commands cannot be recalled.';
    }
    if (event.type === 'input-lock') { const v = views.get(event.key); if (v) { v.locked = event.locked; updateLock(v); } }
    if (event.type === 'status' && event.state !== 'connected') for (const v of views.values()) if (v.pane.profileId === event.profileId) { v.locked = false; updateLock(v); }
  });
  window.BetterSSHWorkbench = { open, acceptResult, onView };
  for (const v of views.values()) onView(v);
})();
