'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { windowsPowerShellEnvironment } = require('../src/powershell-environment.cjs');
const { LocalRemote } = require('../src/local-remote.cjs');
const { spawnElevatedPty } = require('../src/elevated-pty.cjs');

const kept = ['C:\\Users\\runneradmin\\Documents\\PowerShell\\Modules', 'C:\\Modules\\az_15.6.1',
  'C:\\Program Files\\WindowsPowerShell\\Modules', 'C:\\Windows\\system32\\WindowsPowerShell\\v1.0\\Modules',
  'C:\\Program Files (x86)\\Microsoft SQL Server\\160\\Tools\\PowerShell\\Modules\\', '  D:\\Custom Modules  ', '', 'D:\\Custom Modules'];
const inherited = [kept[0], 'C:\\Program Files\\PowerShell\\Modules', 'C:\\program files\\powershell\\7\\Modules', ...kept.slice(1)].join(';');

test('Windows PowerShell child removes only the confirmed PS7 paths and preserves remaining entries exactly', () => {
  const original = Object.freeze({ ProgramFiles: 'C:\\Program Files', PSModulePath: inherited, WinPSModulePath: 'D:\\do-not-trust-this-override', OTHER: 'unchanged' });
  const child = windowsPowerShellEnvironment(original);
  assert.equal(child.PSModulePath, kept.join(';')); assert.equal(original.PSModulePath, inherited);
  assert.equal(child.WinPSModulePath, original.WinPSModulePath); assert.equal(child.OTHER, original.OTHER);
  assert.notEqual(child, original); child.OTHER = 'child only'; assert.equal(original.OTHER, 'unchanged');
});

test('fixed path comparisons normalize case, separators and trailing separators without prefix removal', () => {
  const retained = ['C:\\Program Files\\PowerShell\\7\\Modules-extra', 'C:\\Program Files\\PowerShell\\7\\Modules\\Custom',
    'C:\\Program Files\\PowerShell\\7-preview\\Modules', 'D:\\Portable PowerShell\\7\\Modules', 'C:\\Program Files\\PowerShell\\8\\Modules'];
  const original = { PSModulePath: [' c:/PROGRAM FILES/PowerShell/7/Modules/ ', 'C:\\Program Files\\PowerShell\\Modules\\',
    'C:\\Program Files\\PowerShell\\7\\.\\Modules', ...retained].join(';') };
  assert.equal(windowsPowerShellEnvironment(original).PSModulePath, retained.join(';'));
});

test('Windows environment key casing and nondefault ProgramFiles select the same two fixed roots', () => {
  const original = { programfiles: 'D:\\Programs', pSmOdUlEpAtH: 'D:\\Programs\\PowerShell\\Modules;C:\\Program Files\\PowerShell\\Modules;d:\\programs\\powershell\\7\\modules;X:\\keep' };
  const child = windowsPowerShellEnvironment(original);
  assert.equal(child.pSmOdUlEpAtH, 'C:\\Program Files\\PowerShell\\Modules;X:\\keep');
  assert.equal(child.programfiles, original.programfiles); assert.equal(Object.hasOwn(child, 'PSModulePath'), false);
});

test('absent and empty module paths retain their representation without guessed user paths', () => {
  assert.deepEqual(windowsPowerShellEnvironment({ OTHER: 'value' }), { OTHER: 'value' });
  assert.deepEqual(windowsPowerShellEnvironment({ PSModulePath: '' }), { PSModulePath: '' });
  const custom = { PSModulePath: 'Z:\\Redirected Docs\\PowerShell\\Modules;X:\\PowerShell-configured-modules' };
  assert.deepEqual(windowsPowerShellEnvironment(custom), custom);
});

function inheritedEnvironment(t) {
  const original = new Map(['ProgramFiles', 'PSModulePath'].map(key => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of original) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  process.env.ProgramFiles = 'C:\\Program Files'; process.env.PSModulePath = inherited;
}

class FixturePty {
  constructor() { this.events = new EventEmitter(); }
  onData(fn) { this.events.on('data', fn); return { dispose: () => this.events.off('data', fn) }; }
  onExit(fn) { this.events.on('exit', fn); return { dispose: () => this.events.off('exit', fn) }; }
  write() {} resize() {} pause() {} resume() {} kill() {}
}

test('ordinary launch filters only Windows PowerShell while PS7 and CMD keep their original module paths', async t => {
  inheritedEnvironment(t);
  for (const id of ['local:powershell', 'local:pwsh', 'local:cmd']) {
    let spawned;
    const remote = new LocalRemote({ id, name: id, executable: 'C:\\fixed-shell.exe' }, {
      spawn: (_executable, _args, options) => { spawned = options; return new FixturePty(); }
    });
    t.after(() => remote.disconnect()); await remote.connect(); const pane = await remote.create('Fixture'); await remote.open(pane.key);
    assert.equal(spawned.env.PSModulePath, id === 'local:powershell' ? kept.join(';') : inherited);
    if (id === 'local:cmd') assert.equal(spawned.env.PROMPT, '$P$G');
    assert.notEqual(spawned.env, process.env); assert.equal(process.env.PSModulePath, inherited);
    remote.disconnect();
  }
});

test('every administrator target filters the fixed Windows PowerShell broker child before launch', async t => {
  inheritedEnvironment(t);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nerdsshell-ps-env-test-')), sourceFile = path.join(directory, 'fixture.cs');
  fs.writeFileSync(sourceFile, '// inert fixture'); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const id of ['local:powershell', 'local:pwsh', 'local:cmd']) {
    const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    let spawned, executable;
    const pty = await spawnElevatedPty(id, { sourceFile, execute: (file, _args, options) => {
      executable = file; spawned = options;
      queueMicrotask(() => child.stdout.write(Buffer.from([82, 0, 0, 0, 0]))); return child;
    } });
    try {
      assert.match(executable, /\\WindowsPowerShell\\v1\.0\\powershell\.exe$/i);
      assert.equal(spawned.env.PSModulePath, kept.join(';')); assert.notEqual(spawned.env, process.env);
      assert.equal(process.env.PSModulePath, inherited); assert.equal(spawned.shell, false); assert.equal(pty.shellId, id);
    } finally { child.emit('exit', 0); child.emit('close', 0); }
  }
});
