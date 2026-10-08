/* global profiles, panes, views, selectedProfile, withViewCapacity, openPane, renderConnections, render, entry, closeView */
'use strict';
(() => {
  const api = window.nerdsshell, $ = id => document.getElementById(id);
  const initialDefaults = { username: '', port: 22, auth: 'password', keyPath: '', historyEnabled: true };
  let preferences = { defaults: { ...initialDefaults }, recent: [] }, attempt = null, preferenceSaving = false, ready = false, settingsGeneration = 0;
  const promoting = new Set();
  function errorText(error) { return String(error?.message || error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''); }
  function addressOf(target) {
    const host = target.host.includes(':') ? '[' + target.host + ']' : target.host;
    return (target.username ? target.username + '@' : '') + host + (target.port !== preferences.defaults.port ? ':' + target.port : '');
  }
  function showStatus(text, failed = false) {
    $('quickStatus').textContent = text; $('quickStatus').classList.toggle('error', failed);
  }
  function refresh() {
    const busy = !!attempt;
    $('quickAddress').disabled = busy || !ready; $('quickConnect').disabled = busy || !ready;
    $('quickSettings').disabled = busy || !ready; $('quickCancel').hidden = !busy || !attempt.profileId;
    $('quickCancel').disabled = !!attempt?.cancelling;
    $('quickConnectForm').setAttribute('aria-busy', String(busy));
  }
  function update(value) {
    preferences = { defaults: { ...initialDefaults, ...value?.defaults }, recent: Array.isArray(value?.recent) ? value.recent.slice(0, 50) : [] };
    const list = $('quickRecent'); list.replaceChildren();
    if (preferences.defaults.historyEnabled) for (const target of preferences.recent) {
      const option = document.createElement('option'); option.value = addressOf(target); list.append(option);
    }
    $('quickSummary').textContent = (preferences.defaults.username || 'Ask for username') + ' · ' + (preferences.defaults.auth === 'agent' ? 'SSH agent' : preferences.defaults.auth === 'key' ? 'Private key' : 'Password') + ' · port ' + preferences.defaults.port;
    $('quickClearHistory').disabled = preferenceSaving || !preferences.recent.length;
  }
  function initialize(value) { update(value); ready = true; refresh(); }
  function acceptProfile(profile) {
    if (!attempt || attempt.invalid || !profile.temporary || attempt.profileId && attempt.profileId !== profile.id) return false;
    attempt.profileId = profile.id; refresh(); return true;
  }
  function removed(id) { if (attempt?.profileId === id) { attempt.invalid = true; $('quickCancel').hidden = true; } }
  async function connect() {
    if (!ready || attempt) return;
    const address = $('quickAddress').value;
    if (!address.trim()) { showStatus('Enter an IP address or DNS name.', true); $('quickAddress').focus(); return; }
    const current = { address, profileId: '', invalid: false, cancelling: false }; attempt = current;
    refresh(); showStatus('Connecting…');
    try {
      await withViewCapacity(async release => {
        const result = await api.quickConnect(address);
        if (attempt !== current || current.invalid || !result?.profile || !result?.pane || !profiles.has(result.profile.id) || current.profileId !== result.profile.id) return;
        release();
        selectedProfile = result.profile.id; panes.set(result.pane.key, result.pane);
        await openPane(result.pane.key);
        if (attempt === current && !current.invalid) { showStatus('Connected to ' + result.profile.host + '.'); $('quickAddress').value = ''; }
      });
    } catch (error) { if (attempt === current) showStatus(current.cancelling ? 'Connection canceled.' : errorText(error), !current.cancelling); }
    finally {
      if (attempt === current) { attempt = null; refresh(); }
    }
  }
  async function cancel() {
    const current = attempt; if (!current?.profileId || current.cancelling) return;
    current.cancelling = true; refresh();
    try {
      const result = await api.disconnect(current.profileId);
      if (result === false && attempt === current) { current.cancelling = false; refresh(); }
    }
    catch (error) { if (attempt === current) { current.cancelling = false; showStatus(errorText(error), true); refresh(); } }
  }
  function authFields() { $('quickKeyField').hidden = $('quickAuth').value !== 'key'; }
  function openSettings() {
    if (!ready || attempt || preferenceSaving) return;
    settingsGeneration++; const d = preferences.defaults;
    $('quickUsername').value = d.username; $('quickPort').value = d.port; $('quickAuth').value = d.auth;
    $('quickKeyPath').value = d.keyPath; $('quickHistoryEnabled').checked = d.historyEnabled;
    $('quickSettingsError').textContent = ''; authFields(); $('quickSettingsDialog').showModal(); $('quickUsername').focus();
  }
  function settingsBusy(value) {
    preferenceSaving = value;
    for (const control of $('quickSettingsForm').querySelectorAll('input,select,button')) control.disabled = value;
    if (!value) $('quickClearHistory').disabled = !preferences.recent.length;
  }
  async function saveSettings(event) {
    event.preventDefault(); if (preferenceSaving) return;
    const defaults = { username: $('quickUsername').value.trim(), port: Number($('quickPort').value), auth: $('quickAuth').value,
      keyPath: $('quickAuth').value === 'key' ? $('quickKeyPath').value : '', historyEnabled: $('quickHistoryEnabled').checked };
    settingsBusy(true); $('quickSettingsError').textContent = '';
    try { update(await api.quickConnectDefaults(defaults)); $('quickSettingsDialog').close(); }
    catch (error) { $('quickSettingsError').textContent = errorText(error); }
    finally { settingsBusy(false); }
  }
  async function clearHistory() {
    if (preferenceSaving) return; settingsBusy(true);
    try { update(await api.quickConnectClearHistory()); }
    catch (error) { $('quickSettingsError').textContent = errorText(error); }
    finally { settingsBusy(false); }
  }
  async function saveConnection(id) {
    const original = profiles.get(id);
    if (!original?.temporary || promoting.has(id) || ![...panes.values()].some(p => p.profileId === id && !p.dead)) return;
    promoting.add(id);
    try {
      const name = await entry('Save quick connection', 'Name this connection. The current terminal stays open; network-device mode is retained.', original.host);
      if (name === null || profiles.get(id) !== original) return;
      const saved = await api.quickConnectSave(id, name);
      if (profiles.get(id) === original) { profiles.set(saved.id, saved); renderConnections(); }
    } finally { promoting.delete(id); }
  }
  async function closeConnection(id) {
    // Closing each retained Standard view keeps the existing consequence prompts.
    for (const [key, view] of [...views]) if (view.pane.profileId === id) await closeView(key);
    if (profiles.get(id)?.temporary && ![...views.values()].some(view => view.pane.profileId === id)) await api.disconnect(id);
  }
  function focusAddress() {
    if (document.querySelector('dialog[open]')) return;
    if ($('connectionSidebar').classList.contains('collapsed')) $('sidebarToggle').click();
    $('quickAddress').focus(); $('quickAddress').select();
  }
  $('quickAddress').addEventListener('paste', event => {
    const text = event.clipboardData?.getData('text/plain');
    if (typeof text === 'string' && /[\x00-\x1f\x7f]/.test(text)) {
      event.preventDefault();
      showStatus('Paste one IP address or DNS name without line breaks or control characters.', true);
    }
  });
  $('quickConnectForm').addEventListener('submit', event => { event.preventDefault(); void connect(); });
  $('quickCancel').addEventListener('click', () => { void cancel(); });
  $('quickSettings').addEventListener('click', openSettings);
  $('quickAuth').addEventListener('change', authFields);
  $('quickSettingsForm').addEventListener('submit', event => { void saveSettings(event); });
  $('quickSettingsCancel').addEventListener('click', () => { if (!preferenceSaving) $('quickSettingsDialog').close(); });
  $('quickSettingsDialog').addEventListener('cancel', event => { if (preferenceSaving) event.preventDefault(); });
  $('quickChooseKey').addEventListener('click', async () => {
    if (preferenceSaving) return;
    const auth = $('quickAuth').value, generation = settingsGeneration;
    try { const file = await api.chooseKey(); if (settingsGeneration === generation && $('quickSettingsDialog').open && !preferenceSaving && $('quickAuth').value === auth && file) $('quickKeyPath').value = file; }
    catch (error) { if (settingsGeneration === generation) $('quickSettingsError').textContent = errorText(error); }
  });
  $('quickSettingsDialog').addEventListener('close', () => { settingsGeneration++; });
  $('quickClearHistory').addEventListener('click', () => { void clearHistory(); });
  document.addEventListener('keydown', event => {
    if (event.ctrlKey && event.altKey && !event.shiftKey && event.key.toLowerCase() === 'q' && !document.querySelector('dialog[open]')) {
      event.preventDefault(); event.stopImmediatePropagation(); focusAddress();
    }
  }, true);
  window.NerdSSHellQuick = Object.freeze({ initialize, update, acceptProfile, removed, saveConnection, closeConnection, focusAddress });
  refresh();
})();
