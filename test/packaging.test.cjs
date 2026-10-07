'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { UI_URL, ORIGIN, assetPath } = require('../src/app-protocol.cjs');

const root = path.resolve(__dirname, '..');

test('renderer protocol serves the exact UI and bundled dependencies', () => {
  assert.equal(assetPath(UI_URL, undefined, root), path.join(root, 'ui', 'index.html'));
  assert.equal(assetPath(`${ORIGIN}/node_modules/@xterm/xterm/lib/xterm.js`, ORIGIN, root), path.join(root, 'node_modules', '@xterm', 'xterm', 'lib', 'xterm.js'));
  for (const file of ['session-attention.js', 'branding/app-dark-64.png', 'branding/app-light-64.png', 'branding/app-dark-512.png', 'branding/app-light-512.png']) assert.equal(assetPath(`${ORIGIN}/ui/${file}`, ORIGIN, root), path.join(root, 'ui', ...file.split('/')));
  assert.equal(assetPath(`${ORIGIN}/ui/app.js`, ORIGIN, root), path.join(root, 'ui', 'app.js'));
  assert.equal(assetPath(`${ORIGIN}/ui/appearance.js`, ORIGIN, root), path.join(root, 'ui', 'appearance.js'));
  assert.equal(assetPath(`${ORIGIN}/ui/files.js`, ORIGIN, root), path.join(root, 'ui', 'files.js'));
});

test('renderer protocol denies non-UI code, traversal and foreign initiators', () => {
  for (const url of [
    `${ORIGIN}/src/main.cjs`,
    `${ORIGIN}/src/session-notifications.cjs`,
    `${ORIGIN}/assets/branding/nerdsshell/production/manifest.json`,
    `${ORIGIN}/ui/../src/main.cjs`,
    `${ORIGIN}/ui/%2e%2e/src/main.cjs`,
    `${ORIGIN}/ui/%2f..%2fsrc/main.cjs`,
    `${ORIGIN}/ui/index.html?file=src/main.cjs`,
    `${ORIGIN}/ui/index.html#section`,
    `${ORIGIN}/ui/appearance.js?file=settings.json`,
    `${ORIGIN}/ui/files.js?file=settings.json`,
    `${ORIGIN}/ui/branding/app-dark-512.png?file=settings.json`,
    `${ORIGIN}/ui/branding/app-light-256.png`,
    `${ORIGIN}/spellcheck-dictionaries/en-us.bdic`,
    'file:///C:/Windows/win.ini',
    'https://app/ui/index.html',
    'betterssh://other/ui/index.html',
    'invalid-url'
  ]) assert.equal(assetPath(url, ORIGIN, root), null, url);
  assert.equal(assetPath(UI_URL, 'https://evil.example', root), null);
  assert.equal(assetPath(UI_URL, 'null', root), null);
  assert.equal(assetPath(`${ORIGIN}/ui/appearance.js`, 'https://evil.example', root), null);
  assert.equal(assetPath(`${ORIGIN}/ui/files.js`, 'https://evil.example', root), null);
});
