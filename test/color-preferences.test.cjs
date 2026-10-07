'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { appearance, colorKeys, paletteLabels, exampleRoles } = require('../ui/appearance.js');
const { StateStore } = require('../src/storage.cjs');
const { assetPath } = require('../src/app-protocol.cjs');

test('default accent matches the canonical logo blue and remains consistent before renderer startup', () => {
  const logo = fs.readFileSync(path.join(__dirname, '../assets/branding/nerdsshell/production/wordmark-dark.svg'), 'utf8');
  const logoBlue = /<tspan fill="(#[0-9a-f]{6})">SSH<\/tspan>/i.exec(logo)?.[1];
  assert.equal(logoBlue, '#00aaf0');
  assert.equal(appearance().accent, logoBlue);
  for (const file of ['style.css', 'compact-ui.css']) {
    const css = fs.readFileSync(path.join(__dirname, '../ui', file), 'utf8');
    assert.ok(css.includes('--accent:' + logoBlue + ';'), file + ' has the same initial default');
  }
  const html = fs.readFileSync(path.join(__dirname, '../ui/index.html'), 'utf8');
  assert.ok(html.includes('name="accent" type="color" value="' + logoBlue + '"'));
});

test('logo-blue defaults do not replace explicit saved accents or custom terminal palette entries', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nerdsshell-logo-colors-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new StateStore(directory);
  const custom = appearance({ accent: '#bba3ee', terminalBackground: '#102030', uiBackground: '#314159',
    text: '#eef0f2', palette: { blue: '#123456', brightBlue: '#234567' } });
  custom.palette.extendedAnsi[0] = '#345678';
  store.setAppearance(custom); const bytes = fs.readFileSync(store.file);
  const restored = new StateStore(directory);
  assert.deepEqual(restored.data.appearance, custom);
  assert.deepEqual(fs.readFileSync(store.file), bytes, 'loading settings preserves the original file');
  const blue = appearance({ ...custom, accent: appearance().accent });
  assert.equal(blue.accent, '#00aaf0');
  assert.deepEqual(blue.palette, custom.palette);
  for (const key of ['terminalBackground', 'uiBackground', 'text', 'copyOnSelect']) assert.equal(blue[key], custom[key]);
});

test('copy-on-selection defaults on and preserves an explicit false preference', () => {
  assert.equal(appearance().copyOnSelect, true); assert.equal(appearance({ copyOnSelect: false }).copyOnSelect, false);
});
for (const value of [null, 'false', 1, [], {}]) test(`reject invalid copy preference ${JSON.stringify(value)}`, () => {
  assert.throws(() => appearance({ copyOnSelect: value }), /on or off/);
});
test('existing colors and indexed overrides survive the copy-preference addition', () => {
  const old = appearance(); delete old.copyOnSelect; old.palette.red = '#123456'; old.palette.extendedAnsi[0] = '#654321';
  const next = appearance(old); assert.equal(next.copyOnSelect, true); assert.equal(next.palette.red, '#123456'); assert.equal(next.palette.extendedAnsi[0], '#654321');
});
test('settings roundtrip retains copy preference, palette, profiles and pins', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'betterssh-preferences-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new StateStore(directory);
  store.putProfile({ id: 'example', name: 'Example', host: 'host.example', username: 'tester', sessionMode: 'standard' });
  store.data.pins['host.example:22'] = 'synthetic-test-pin';
  store.setAppearance({ copyOnSelect: false, palette: { red: '#123456' }, unexpected: 'do-not-persist' });
  const loaded = new StateStore(directory);
  assert.equal(loaded.data.appearance.copyOnSelect, false); assert.equal(loaded.data.appearance.palette.red, '#123456');
  assert.equal(loaded.data.profiles[0].sessionMode, 'standard'); assert.equal(loaded.data.pins['host.example:22'], 'synthetic-test-pin');
  assert.equal(loaded.data.appearance.unexpected, undefined);
});
test('old persisted settings without copy preference migrate without changing colors', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'betterssh-old-prefs-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new StateStore(directory); delete store.data.appearance.copyOnSelect; store.data.appearance.palette.green = '#abcdef'; store.save();
  const loaded = new StateStore(directory); assert.equal(loaded.data.appearance.copyOnSelect, true); assert.equal(loaded.data.appearance.palette.green, '#abcdef');
});
test('every named palette slot has a distinct readable label; bright black is labeled gray', () => {
  assert.equal(paletteLabels.length, 16); assert.equal(new Set(paletteLabels).size, 16); assert.match(paletteLabels[8], /Gray/);
  for (const key of Object.keys(exampleRoles)) assert.ok(colorKeys.includes(key));
});
test('copy helper is allowlisted without exposing backend files', () => {
  assert.ok(assetPath('betterssh://app/ui/selection-copy.js', 'betterssh://app', '/app'));
  assert.equal(assetPath('betterssh://app/src/storage.cjs', 'betterssh://app', '/app'), null);
});
test('HTML labels syntax as an example and keeps advanced slots collapsed', () => {
  const html = fs.readFileSync(path.join(__dirname, '../ui/index.html'), 'utf8');
  assert.match(html, /palette colors, not universal syntax settings/);
  assert.match(html, /data-role="Strings"/); assert.match(html, /data-role="Keywords"/);
  assert.match(html, /<details id="advancedColors">/); assert.doesNotMatch(html, /<details id="advancedColors"[^>]*\bopen/);
  assert.match(html, /name="copyOnSelect" type="checkbox" checked/);
});
test('auto-copy integration retains OSC52 blocking and manual-copy behavior', () => {
  const js = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
  assert.match(js, /registerOscHandler\(52, \(\) => true\)/);
  assert.match(js, /v\.selectionCopy = BetterSSHSelectionCopy\.attach/);
  assert.match(js, /v\.selectionCopy\?\.dispose\(\)/);
  assert.match(js, /terminal\.hasSelection\(\) \|\| e\.shiftKey/);
  assert.match(js, /copyOnSelect: form\.elements\.copyOnSelect\.checked/);
});
