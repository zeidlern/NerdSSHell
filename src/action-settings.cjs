'use strict';
const { randomUUID } = require('node:crypto');
const { actions, compileAction, availableActions, scriptText } = require('./action-catalog.cjs');
const OS_TYPES = Object.freeze(['Windows', 'Linux', 'Ubuntu', 'Debian', 'Fedora', 'Arch', 'macOS']);
function osType(facts) {
  facts ||= {};
  if (facts.system === 'Windows') return 'Windows';
  if (facts.system === 'Darwin') return 'macOS';
  if (facts.system !== 'Linux') return 'Unknown';
  return ({ ubuntu: 'Ubuntu', debian: 'Debian', fedora: 'Fedora', arch: 'Arch' })[facts.id] || 'Linux';
}
function validateSettings(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid action configuration.');
  const custom = value.custom || [], favoritesByOS = value.favoritesByOS || {};
  if (!Array.isArray(custom) || custom.length > 64 || !favoritesByOS || typeof favoritesByOS !== 'object' || Array.isArray(favoritesByOS)) throw new Error('Action configuration is too large or invalid.');
  const seen = new Set();
  const checked = custom.map(item => {
    if (!item || typeof item.id !== 'string' || !/^custom\.[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(item.id) || seen.has(item.id) || !OS_TYPES.includes(item.os) || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 80 || /[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u.test(item.title)) throw new Error('Invalid custom action identity, operating system or title.');
    const code = scriptText(item.code); if (Buffer.byteLength(code) > 8192) throw new Error('Saved custom actions are limited to 8 KiB.');
    if (item.shell !== undefined && (item.os !== 'Windows' || !['powershell', 'cmd'].includes(item.shell))) throw new Error('Choose PowerShell or Command Prompt for a Windows action.');
    seen.add(item.id); return { id: item.id, os: item.os, title: item.title.trim(), code, ...(item.os === 'Windows' ? { shell: item.shell || 'powershell' } : {}) };
  });
  const favorites = {};
  for (const [os, ids] of Object.entries(favoritesByOS)) {
    if (!OS_TYPES.includes(os) || !Array.isArray(ids) || ids.length > 32 || ids.some(id => !actions.some(a => a.id === id) && !checked.some(a => a.id === id && (a.os === os || a.os === 'Linux' && ['Ubuntu','Debian','Fedora','Arch'].includes(os))))) throw new Error('Choose up to 32 applicable favorites for each OS.');
    favorites[os] = [...new Set(ids)];
  }
  return { custom: checked, favoritesByOS: favorites };
}
function applicable(item, os, shell) {
  if (item.os === 'Windows') return os === 'Windows' && (item.shell || 'powershell') === (shell || 'powershell');
  return item.os === os || item.os === 'Linux' && ['Ubuntu','Debian','Fedora','Arch'].includes(os);
}
function configuredActions(facts, settings) {
  const os = osType(facts);
  return [...availableActions(facts), ...settings.custom.filter(a => applicable(a, os, facts.shell)).map(a => ({ id: a.id, title: a.title, group: 'Custom', description: 'User-saved command. Runs in this session with the current account’s permissions.', risk: 'custom', argument: null, keywords: a.title, enabled: true, shell: a.shell }))];
}
function compileConfigured(id, facts, argument, settings) {
  if (typeof id !== 'string' || id.length > 100) throw new Error('Choose a valid action.');
  if (!id.startsWith('custom.')) return compileAction(id, facts, argument);
  const item = settings.custom.find(a => a.id === id && applicable(a, osType(facts), facts.shell));
  if (!item) throw new Error('This custom action is unavailable for the detected OS or shell.');
  return { id, code: item.code, title: item.title, shell: facts.system === 'Windows' ? (facts.shell || 'powershell') : 'posix', risk: 'custom', description: 'User-saved command', note: 'This command runs with the selected account’s permissions. Saving an action does not certify it as safe.' };
}
function previewFacts(os, shell = 'powershell') {
  if (!OS_TYPES.includes(os)) throw new Error('Choose a supported OS.');
  if (!['powershell', 'cmd'].includes(shell)) throw new Error('Choose PowerShell or Command Prompt.');
  return { system: os === 'Windows' ? 'Windows' : os === 'macOS' ? 'Darwin' : 'Linux', ...(os === 'Windows' ? { shell } : {}), id: ({ Ubuntu: 'ubuntu', Debian: 'debian', Fedora: 'fedora', Arch: 'arch' })[os] || '', caps: ['free', 'ip', 'ss', 'systemctl', 'systemd', 'journalctl', 'sudo', 'shutdown', 'docker', ...(os === 'Arch' ? ['pacman','checkupdates'] : os === 'Fedora' ? ['dnf'] : os === 'macOS' ? ['softwareupdate'] : ['apt'])] };
}
const DEFAULT_FAVORITES = Object.freeze(['system.info', 'system.disk', 'updates.check']);
function favoriteIds(settings, os, legacy = DEFAULT_FAVORITES) {
  return Object.hasOwn(settings.favoritesByOS, os) ? [...settings.favoritesByOS[os]] : [...legacy];
}
module.exports = { OS_TYPES, osType, validateSettings, configuredActions, compileConfigured, previewFacts, favoriteIds, DEFAULT_FAVORITES, newActionId: () => 'custom.' + randomUUID() };
