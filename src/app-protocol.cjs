'use strict';
const path = require('node:path');

// Every renderer resource is enumerated here. The main process and settings are
// deliberately not addressable through the renderer's protocol.
const ASSETS = new Set([
  '/ui/index.html',
  '/ui/style.css',
  '/ui/compact-ui.css',
  '/ui/preferences.css',
  '/ui/app.js',
  '/ui/session-attention.js',
  '/ui/branding/app-dark-64.png',
  '/ui/branding/app-light-64.png',
  '/ui/branding/app-dark-512.png',
  '/ui/branding/app-light-512.png',
  '/ui/appearance.js',
  '/ui/selection-copy.js',
  '/ui/files.js',
  '/ui/command-review.js',
  '/ui/workbench.js',
  '/ui/workbench.css',
  '/ui/local-files.js', '/ui/desktop-ux.js', '/ui/desktop-ux.css', '/ui/scratchpad.js', '/ui/pane-actions.js',
  '/node_modules/@xterm/xterm/css/xterm.css',
  '/node_modules/@xterm/xterm/lib/xterm.js',
  '/node_modules/@xterm/addon-fit/lib/addon-fit.js',
  '/node_modules/@xterm/addon-search/lib/addon-search.js'
]);
const ORIGIN = 'betterssh://app';
const UI_URL = `${ORIGIN}/ui/index.html`;

function assetPath(requestURL, initiatorOrigin, root) {
  let url;
  try { url = new URL(requestURL); } catch { return null; }
  if (url.protocol !== 'betterssh:' || url.host !== 'app' || url.username || url.password || url.search || url.hash || !ASSETS.has(url.pathname)) return null;
  if (initiatorOrigin !== undefined && initiatorOrigin !== ORIGIN) return null;
  return path.join(root, ...url.pathname.slice(1).split('/'));
}

module.exports = { ORIGIN, UI_URL, assetPath };
