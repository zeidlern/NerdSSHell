'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
function startup(t, explicit = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nerdsshell-startup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const legacy = path.join(root, 'betterssh'), current = path.join(root, 'nerdsshell'), selected = path.join(root, 'explicit');
  for (const directory of [legacy, current, selected]) fs.mkdirSync(directory);
  fs.writeFileSync(path.join(legacy, 'settings.json'), 'legacy profiles and trust pins');
  fs.writeFileSync(path.join(current, 'settings.json'), 'separate current data');
  const before = fs.readFileSync(path.join(legacy, 'settings.json'));
  const calls = [], paths = { appData: root, userData: current };
  const app = { isPackaged: true, getPath: name => paths[name],
    commandLine: { getSwitchValue: () => explicit ? selected : '' },
    setPath(name, value) { calls.push(['path', name, value]); paths[name] = value; },
    requestSingleInstanceLock() { calls.push(['lock', paths.userData]); return false; }, quit() { calls.push(['quit']); } };
  const filename = path.resolve(__dirname, '../src/main.cjs'), req = createRequire(filename);
  const electron = { app, dialog: {}, protocol: { registerSchemesAsPrivileged(value) { calls.push(['schemes', value.map(x => x.scheme)]); } } };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { require: name => name === 'electron' ? electron : req(name),
    __dirname: path.dirname(filename), Buffer, process, console, setTimeout, clearTimeout });
  assert.deepEqual(fs.readFileSync(path.join(legacy, 'settings.json')), before);
  assert.equal(fs.readFileSync(path.join(current, 'settings.json'), 'utf8'), 'separate current data');
  assert.deepEqual(Array.from(calls.find(c => c[0] === 'schemes')[1]), ['nerdsshell']);
  return { calls, wanted: explicit ? selected : legacy };
}
test('actual main startup selects the legacy data and lock before any second instance can run', t => {
  const { calls, wanted } = startup(t);
  const set = calls.findIndex(c => c[0] === 'path'), lock = calls.findIndex(c => c[0] === 'lock');
  assert.ok(set >= 0 && set < lock);
  assert.deepEqual(calls[set], ['path', 'userData', wanted]);
  assert.deepEqual(calls[lock], ['lock', wanted]);
  assert.deepEqual(calls.at(-1), ['quit']);
});
test('actual packaged main respects an explicit isolated profile without writing either default', t => {
  const { calls, wanted } = startup(t, true);
  assert.deepEqual(calls.find(c => c[0] === 'path'), ['path', 'userData', wanted]);
  assert.deepEqual(calls.find(c => c[0] === 'lock'), ['lock', wanted]);
});
