'use strict';

const { appearance } = require('../ui/appearance.js');
const { integer } = require('./core.cjs');
const { validateSettings } = require('./action-settings.cjs');

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}.`);
  return value;
}
function boolean(value, fallback, label) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${label} must be on or off.`);
  return value;
}
function notifications(value = {}) {
  record(value, 'notification preferences');
  return {
    enabled: boolean(value.enabled, true, 'Waiting-for-input detection'),
    audio: boolean(value.audio, true, 'Audio alerts'),
    desktop: boolean(value.desktop, true, 'Windows notifications'),
    visual: boolean(value.visual, true, 'Visual session indicators')
  };
}
function sessionDefaults(value = {}) {
  record(value, 'session defaults');
  const startup = value.startup === undefined ? 'all' : value.startup;
  if (!['all', 'restore', 'none'].includes(startup)) throw new Error('Invalid startup policy.');
  return {
    scrollback: integer(value.scrollback === undefined ? 100000 : value.scrollback, 1000, 500000, 'scrollback'),
    archiveMB: integer(value.archiveMB === undefined ? 256 : value.archiveMB, 16, 4096, 'archive size'),
    record: boolean(value.record, false, 'Recording'),
    autoConnect: boolean(value.autoConnect, true, 'Automatic connection'),
    startup
  };
}
function preferences(value, current = {}) {
  record(value, 'preferences');
  const allowed = ['appearance', 'notifications', 'sessionDefaults', 'actionConfiguration'];
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unknown preferences section.');
  return {
    appearance: appearance(value.appearance === undefined ? current.appearance : value.appearance),
    notifications: notifications(value.notifications === undefined ? current.notifications : value.notifications),
    sessionDefaults: sessionDefaults(value.sessionDefaults === undefined ? current.sessionDefaults : value.sessionDefaults),
    actionConfiguration: validateSettings(value.actionConfiguration === undefined ? current.actionConfiguration : value.actionConfiguration)
  };
}
module.exports = { notifications, sessionDefaults, preferences };
