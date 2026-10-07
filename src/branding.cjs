'use strict';

// Visible identity is deliberately separate from compatibility identifiers.
// Existing settings, IPC protocols and tmux names keep their BetterSSH namespace.
const PRODUCT_NAME = 'NerdSSHell';
const TAGLINE = 'Built for Windows nerds with Linux problems';
const APP_ID = 'cc.zeidler.betterssh';
const LEGACY_PACKAGE_NAME = 'betterssh';
const WINDOW_ICON = 'ui/branding/nerdsshell.ico';
const ICON_SIZES = Object.freeze([16, 20, 24, 32, 40, 48, 64, 128, 256, 512]);
const ICO_SIZES = Object.freeze(ICON_SIZES.filter(size => size <= 256));
const UI_ICONS = Object.freeze({
  light: 'ui/branding/app-light-64.png',
  dark: 'ui/branding/app-dark-64.png'
});

module.exports = { PRODUCT_NAME, TAGLINE, APP_ID, LEGACY_PACKAGE_NAME, WINDOW_ICON, ICON_SIZES, ICO_SIZES, UI_ICONS };
