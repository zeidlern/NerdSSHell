'use strict';

// Current product identity is separate from the legacy saved-data directory.
const PRODUCT_NAME = 'NerdSSHell';
const TAGLINE = 'Built for Windows nerds with Linux problems';
const APP_ID = 'app.nerdsshell.desktop';
const PACKAGE_NAME = 'nerdsshell';
// Explicitly pinned to the original installer's identity for in-place upgrades.
const INSTALLER_GUID = '48ee049e-c2f6-57b2-ab6e-7f5df516dcc0';
const WINDOW_ICON = 'ui/branding/nerdsshell.ico';
const ICON_SIZES = Object.freeze([16, 20, 24, 32, 40, 48, 64, 128, 256, 512]);
const ICO_SIZES = Object.freeze(ICON_SIZES.filter(size => size <= 256));
const UI_ICONS = Object.freeze({
  light: 'ui/branding/app-light-64.png',
  dark: 'ui/branding/app-dark-64.png'
});

module.exports = { PRODUCT_NAME, TAGLINE, APP_ID, PACKAGE_NAME, INSTALLER_GUID, WINDOW_ICON, ICON_SIZES, ICO_SIZES, UI_ICONS };
