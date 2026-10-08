/* global $, api, views, button, element, run, message */
'use strict';
(() => {
  let config = null, selected = null, editorDirty = false, blocked = false, storing = false;
  let serial = 0, editing = 0, actionLoad = 0, favoriteLoad = 0, entries = [], favoriteEntries = [];
  const templates = new Map();
  const defaultFavorites = () => config.defaults || ['system.info', 'system.disk', 'updates.check'];
  const current = v => views.get(v.pane.key) === v && v.ready;
  const configure = (category = 'actions') => window.NerdSSHellPreferences.open(category);

  function favoriteButtons(v, data = { favorites: [], actions: [] }) {
    const own = v.actionBar, generation = own.generation, viewGeneration = v.generation, target = own.target;
    own.favorites.replaceChildren(); own.favoriteButtons.clear();
    for (const id of data.favorites) {
      const action = data.actions.find(item => item.id === id); if (!action) continue;
      const favorite = element('button', 'pane-favorite-button', action.title); favorite.type = 'button';
      favorite.setAttribute('data-action-id', id); favorite.title = action.reason || action.description || 'Run in this session';
      favorite.onclick = event => {
        event?.stopPropagation?.();
        if (event?.detail > 1 || favorite.disabled || own.generation !== generation || v.generation !== viewGeneration || own.target !== target || own.favoriteButtons.get(id) !== favorite) return;
        return run(launch(v, id));
      };
      own.favoriteButtons.set(id, favorite); own.favorites.append(favorite);
    }
  }
  function menuState(v) {
    const own = v.actionBar;
    own.all.disabled = own.unsupported || own.loading || own.busy || !current(v) || !own.target;
    for (const [id, favorite] of own.favoriteButtons) favorite.disabled = own.unsupported || own.loading || own.busy || !current(v) || !own.target || v.locked || !own.actions.get(id)?.enabled;
  }
  function onView(v, refreshReady = true) {
    if (v.actionBar) return;
    const bar = element('div', 'pane-actions'), all = element('select', 'pane-action-select'), favorites = element('div', 'pane-favorites');
    const configureFavorites = element('button', 'pane-favorites-configure', 'Configure Favorites…'); configureFavorites.type = 'button';
    configureFavorites.onclick = () => run(configure('favorites'));
    all.setAttribute('aria-label', 'Actions for this session'); favorites.setAttribute('aria-label', 'Favorites for this session');
    favorites.setAttribute('role', 'group'); favorites.tabIndex = 0;
    const hint = element('option', '', 'Actions · detecting…'); hint.value = ''; all.append(hint);
    bar.append(all, favorites, configureFavorites); v.wrapper.insertBefore(bar, v.wrapper.querySelector('.pane-body'));
    bar.hidden = v.pane.terminalType === 'generic';
    v.actionBar = { unsupported: v.pane.terminalType === 'generic', bar, all, favorites, configureFavorites, favoriteButtons: new Map(), actions: new Map(), generation: 0, target: null, loading: true, busy: false, cancelArgument: null };
    favoriteButtons(v); menuState(v);
    all.onchange = () => {
      const value = all.value; all.value = '';
      if (value === '__detect' && !v.actionBar.unsupported && current(v) && !all.disabled) return run(api.workbenchDetect(v.pane.profileId, v.pane.key).then(() => refresh(v)));
      if (value) return run(launch(v, value));
    };
    if (v.ready && refreshReady) run(refresh(v));
  }
  async function refresh(v) {
    if (!v.actionBar) onView(v, false);
    const own = v.actionBar, generation = ++own.generation;
    own.cancelArgument?.(); own.busy = false; own.target = null; own.loading = true; own.actions.clear(); favoriteButtons(v); menuState(v);
    if (!current(v)) { own.loading = false; return; }
    const unsupported = data => {
      if (v.pane.terminalType !== 'generic' && data.capabilities?.automaticDetection !== false) return false;
      own.unsupported = true; own.bar.hidden = true; own.loading = false; own.actions.clear(); favoriteButtons(v); menuState(v); return true;
    };
    try {
      let data = await api.paneActions(v.pane.key);
      if (own.generation !== generation || !current(v)) return;
      if (unsupported(data)) return;
      own.unsupported = false; own.bar.hidden = false;
      if (data.os === 'Unknown') { await api.workbenchDetect(v.pane.profileId, v.pane.key); data = await api.paneActions(v.pane.key); }
      if (own.generation !== generation || !current(v)) return;
      if (unsupported(data)) return;
      own.actions = new Map(data.actions.map(action => [action.id, action])); own.target = data.target;
      const os = data.os === 'Windows' && data.platform?.shell === 'cmd' ? 'Command Prompt' : data.os;
      const hint = element('option', '', `Actions · ${os}`); hint.value = ''; own.all.replaceChildren(hint);
      for (const action of data.actions) {
        const option = element('option', '', action.title + (action.enabled ? '' : ' — unavailable'));
        option.value = action.id; option.disabled = !action.enabled; option.title = action.reason || action.description; own.all.append(option);
      }
      if (data.os !== 'Windows') { const detect = element('option', '', 'Detect system again'); detect.value = '__detect'; own.all.append(detect); }
      favoriteButtons(v, data); own.all.title = `${data.title}\nRuns the selected command in this session.`;
      own.loading = false; menuState(v);
    } catch (error) {
      if (own.generation === generation && current(v) && !own.unsupported) {
        own.all.replaceChildren(); const hint = element('option', '', 'Actions unavailable · retry'); hint.value = '';
        const retry = element('option', '', 'Detect system again'); retry.value = '__detect'; own.all.append(hint, retry);
        own.all.disabled = false; own.all.title = error.message; own.loading = false;
      }
    }
  }
  function argumentFor(v, action) {
    const own = v.actionBar, form = element('form', 'pane-action-argument'), label = element('label', '', action.argument === 'container' ? 'Container name' : 'Service name');
    const input = element('input'); input.type = 'text'; input.maxLength = 128; input.required = true; input.autocomplete = 'off';
    input.setAttribute('aria-label', label.textContent); label.append(input);
    const submit = element('button', 'primary', 'Run'); submit.type = 'submit';
    form.append(element('span', 'pane-action-argument-title', action.title), label, submit);
    return new Promise(resolve => {
      const finish = value => { if (own.cancelArgument !== cancel) return; own.cancelArgument = null; form.remove(); resolve(value); };
      const cancel = () => finish(null), dismiss = button('Cancel', cancel); dismiss.type = 'button'; form.append(dismiss);
      own.cancelArgument = cancel; own.bar.append(form);
      form.onsubmit = event => {
        event.preventDefault(); const value = input.value.trim();
        const pattern = action.argument === 'container' ? /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/ : /^[A-Za-z0-9_][A-Za-z0-9_.@:-]{0,127}$/;
        if (!pattern.test(value)) { message('Enter the exact name, without spaces, options or shell punctuation.'); return; }
        finish(value);
      };
      form.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); cancel(); } };
      input.focus();
    });
  }
  async function launch(v, actionId) {
    const own = v.actionBar, action = own?.actions.get(actionId);
    if (!own || own.loading || own.busy || !own.target || !current(v) || !action?.enabled) return;
    if (v.locked) return message('Input is locked. Unlock this session before running an Action or Favorite.');
    const generation = own.generation, viewGeneration = v.generation, target = own.target;
    own.busy = true; menuState(v);
    try {
      const argument = action.argument ? await argumentFor(v, action) : '';
      if (argument === null || own.generation !== generation || v.generation !== viewGeneration || !current(v) || v.locked || own.target !== target) return;
      v.terminal.focus();
      const attention = v.attentionTracker?.captureInput();
      await api.paneActionRun(v.pane.key, { target, actionId, argument,
        bracketedPaste: !!v.terminal.modes?.bracketedPasteMode && v.terminal.options?.ignoreBracketedPasteMode !== true });
      if (current(v) && v.generation === viewGeneration) v.attentionTracker?.acceptInput('\r', attention);
    } finally { if (own.generation === generation) { own.busy = false; menuState(v); } }
  }

  function mutable() { return !!config && !blocked && !storing; }
  function shellFor(prefix) { return $(prefix + 'OS').value === 'Windows' ? $(prefix + 'Shell').value || 'powershell' : 'powershell'; }
  function applies(action, os, shell) {
    if (action.os === 'Windows') return os === 'Windows' && (action.shell || 'powershell') === shell;
    return action.os === os || action.os === 'Linux' && ['Ubuntu', 'Debian', 'Fedora', 'Arch'].includes(os);
  }
  function resetEditor() { editing++; selected = null; editorDirty = false; $('actionName').value = $('actionCode').value = ''; }
  async function beginConfiguration(value) {
    const generation = ++serial; config = null; blocked = false; storing = false; templates.clear(); resetEditor();
    entries = favoriteEntries = []; $('actionConfigList').replaceChildren(); $('favoriteConfigList').replaceChildren();
    const result = value || await api.actionConfiguration(); if (generation !== serial) return false;
    config = structuredClone(result);
    for (const prefix of ['action', 'favorite']) {
      $(prefix + 'OS').replaceChildren();
      for (const os of config.osTypes) { const option = element('option', '', os); option.value = os; $(prefix + 'OS').append(option); }
      $(prefix + 'Shell').value = 'powershell';
    }
    $('actionConfigStatus').textContent = $('favoriteConfigStatus').textContent = '';
    await Promise.all([loadActions(), loadFavorites()]); return generation === serial;
  }
  async function listFor(os, shell) {
    const key = os + '/' + shell;
    if (!templates.has(key)) templates.set(key, api.actionTemplates(os, shell).then(list => list.filter(action => !action.id.startsWith('custom.'))));
    return templates.get(key);
  }
  async function loadActions() {
    if (!config) return;
    const own = config, generation = ++actionLoad, os = $('actionOS').value, shell = shellFor('action');
    entries = []; $('actionShellField').hidden = os !== 'Windows'; paintActions();
    const list = await listFor(os, shell); if (config !== own || generation !== actionLoad) return;
    entries = [...list, ...config.custom.filter(action => applies(action, os, shell)).map(action => ({ ...action, enabled: true }))]; paintActions();
  }
  async function loadFavorites() {
    if (!config) return;
    const own = config, generation = ++favoriteLoad, os = $('favoriteOS').value, shell = shellFor('favorite');
    favoriteEntries = []; $('favoriteShellField').hidden = os !== 'Windows'; paintFavorites();
    const list = await listFor(os, shell); if (config !== own || generation !== favoriteLoad) return;
    favoriteEntries = [...list, ...config.custom.filter(action => applies(action, os, shell)).map(action => ({ ...action, enabled: true }))]; paintFavorites();
  }
  function paintActions() {
    const root = $('actionConfigList'); root.replaceChildren(); if (!config) return;
    const own = config, os = $('actionOS').value, shell = shellFor('action'), listing = actionLoad;
    for (const action of entries) {
      const choose = button(action.title, async () => {
        if (!mutable() || config !== own || listing !== actionLoad || $('actionOS').value !== os || shellFor('action') !== shell) return;
        const revision = ++editing, generation = serial;
        selected = action.id; editorDirty = false; $('actionName').value = action.title;
        const custom = config.custom.find(item => item.id === action.id);
        if (custom) $('actionCode').value = custom.code;
        else {
          $('actionCode').value = ''; const plan = await api.actionPreview(os, action.id, action.argument === 'container' ? 'example-container' : 'example-service', shell);
          if (revision !== editing || generation !== serial || !config || selected !== action.id || $('actionOS').value !== os || shellFor('action') !== shell) return;
          $('actionCode').value = plan.code;
        }
        $('actionEditHint').textContent = custom ? 'Edit this saved action, then choose Keep custom action. Save in Preferences applies the change.' : 'Built-in recipe preview. Editing creates a custom action; replace any example service or container name with your own.';
      }, 'wb-action', action.reason || action.description);
      choose.type = 'button'; choose.disabled = blocked || storing || action.enabled === false; choose.setAttribute('aria-pressed', String(action.id === selected)); root.append(choose);
    }
  }
  function paintFavorites() {
    const root = $('favoriteConfigList'); root.replaceChildren(); if (!config) return;
    const own = config, os = $('favoriteOS').value, shell = shellFor('favorite'), listing = favoriteLoad, favorites = config.favoritesByOS[os] ?? defaultFavorites();
    for (const action of favoriteEntries) {
      const row = element('label', 'favorite-config-row'), checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.checked = favorites.includes(action.id);
      checkbox.disabled = blocked || storing || action.enabled === false && !checkbox.checked;
      checkbox.onchange = () => {
        if (!mutable() || config !== own || listing !== favoriteLoad || $('favoriteOS').value !== os || shellFor('favorite') !== shell) return;
        const prior = config.favoritesByOS[os] ?? defaultFavorites();
        const next = checkbox.checked ? [...new Set([...prior, action.id])] : prior.filter(id => id !== action.id);
        if (next.length > 32) { checkbox.checked = false; return message('Choose up to 32 favorites per operating system.'); }
        config.favoritesByOS[os] = next; paintFavorites();
      };
      row.title = action.reason || action.description || 'Saved command'; row.append(checkbox, element('span', '', action.title)); root.append(row);
    }
    $('favoriteConfigStatus').textContent = `${favorites.length} of 32 favorites selected for ${os}. Save in Preferences applies changes.`;
  }
  function blockConfiguration(value) {
    blocked = value;
    for (const id of ['actionOS', 'actionShell', 'actionNew', 'actionName', 'actionCode', 'actionStore', 'actionDelete', 'favoriteOS', 'favoriteShell']) $(id).disabled = blocked || storing;
    paintActions(); paintFavorites();
  }
  function stageConfiguration() {
    if (!config) throw new Error('Wait for Actions and Favorites to finish loading.');
    if (storing || blocked) throw new Error('Wait for the current action edit to finish.');
    if (editorDirty) throw new Error('Choose Keep custom action to stage your command changes before saving Preferences.');
    return structuredClone({ custom: config.custom, favoritesByOS: config.favoritesByOS });
  }
  function cancelConfiguration() {
    serial++; actionLoad++; favoriteLoad++; config = null; blocked = false; storing = false; templates.clear(); resetEditor();
    entries = favoriteEntries = []; paintActions(); paintFavorites();
  }
  function commitConfiguration() { cancelConfiguration(); for (const v of views.values()) run(refresh(v)); }
  $('actionOS').onchange = $('actionShell').onchange = () => { if (!mutable()) return; resetEditor(); run(loadActions()); };
  $('favoriteOS').onchange = $('favoriteShell').onchange = () => { if (mutable()) run(loadFavorites()); };
  $('actionNew').onclick = () => { if (!mutable()) return; resetEditor(); $('actionName').focus(); };
  $('actionName').oninput = $('actionCode').oninput = () => { if (!mutable()) return; editing++; editorDirty = true; };
  $('actionStore').onclick = () => run((async () => {
    if (!mutable()) return;
    const own = config, generation = serial, os = $('actionOS').value, shell = shellFor('action'), title = $('actionName').value.trim(), code = $('actionCode').value;
    if (!title || !code.trim()) throw new Error('Enter a name and command.');
    storing = true; blockConfiguration(false);
    try {
      const existing = own.custom.find(action => action.id === selected && action.os === os && applies(action, os, shell));
      const id = existing?.id || await api.actionNewId(); if (config !== own || serial !== generation) return;
      own.custom = own.custom.filter(action => action.id !== id); own.custom.push({ id, os, title, code, ...(os === 'Windows' ? { shell } : {}) });
      selected = id; editorDirty = false; $('actionConfigStatus').textContent = 'Custom action staged. Save in Preferences applies it.';
      await Promise.all([loadActions(), loadFavorites()]);
    } finally { if (serial === generation) { storing = false; blockConfiguration(false); } }
  })());
  $('actionDelete').onclick = () => {
    if (!mutable() || !selected?.startsWith('custom.')) return;
    const custom = config.custom.find(action => action.id === selected);
    if (custom?.os !== $('actionOS').value) return message('Choose ' + custom.os + ' to remove this shared action.');
    config.custom = config.custom.filter(action => action.id !== selected);
    for (const os of Object.keys(config.favoritesByOS)) config.favoritesByOS[os] = config.favoritesByOS[os].filter(id => id !== selected);
    resetEditor(); run(Promise.all([loadActions(), loadFavorites()]));
  };
  window.NerdSSHellPanes = { configure, onView, refresh, beginConfiguration, stageConfiguration, blockConfiguration, commitConfiguration, cancelConfiguration };
  api.onEvent?.(event => { if (event.type === 'input-lock') { const v = views.get(event.key); if (v?.actionBar) menuState(v); } });
  for (const v of views.values()) onView(v);
})();
