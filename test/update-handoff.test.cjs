'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createHash } = require('node:crypto'), { EventEmitter } = require('node:events'), { PassThrough, Writable } = require('node:stream');
const { armUpdate, validatePlan, bootstrap, cleanupOwned } = require('../src/update-handoff.cjs');
function fixture(t) {
  const stage = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'nerdsshell-update-'));
  const home = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'nerdsshell-handoff-test-'));
  const install = path.join(home, 'owned installation'); fs.mkdirSync(install);
  const executablePath = path.join(install, 'NerdSSHell.exe'), userDataDirectory = path.join(home, 'owned data');
  fs.mkdirSync(userDataDirectory); fs.writeFileSync(path.join(userDataDirectory, 'sentinel'), 'owned synthetic data');
  fs.writeFileSync(executablePath, 'MZ fixture application');
  const bytes = Buffer.from('MZ fixture installer'), installerPath = path.join(stage, 'NerdSSHell-1.2.3-x64-Setup.exe'); fs.writeFileSync(installerPath, bytes);
  const plan = { stageDirectory: stage, installerPath, targetVersion: '1.2.3', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), executablePath, userDataDirectory, parentPid: 1001 };
  t.after(() => { for (const directory of [stage, home]) fs.rmSync(directory, { recursive: true, force: true }); });
  return { plan, stage, home };
}
function launcher(f, { ready = true, readyLine, ack = true, closeOnCancel = true, closedEarly = false } = {}) {
  const commands = [], calls = []; let child;
  const execute = (file, args, options) => {
    calls.push({ file, args, options }); const nonce = JSON.parse(fs.readFileSync(path.join(f.stage, 'update-manifest.json'))).nonce;
    child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.unref = () => { child.unreferenced = true; };
    child.stdin = new Writable({ write(bytes, encoding, done) {
      const command = bytes.toString().trim(); commands.push(command);
      if (command === 'GO ' + nonce && ack) queueMicrotask(() => child.stdout.write('GO ' + nonce + '\n'));
      if (command === 'CANCEL ' + nonce && closeOnCancel) queueMicrotask(() => { child.stdout.write('CANCEL ' + nonce + '\n'); child.emit('close', 0); });
      done();
    }, destroy(error, done) { queueMicrotask(() => child.emit('close', 1)); done(error); } });
    queueMicrotask(() => { if (closedEarly) child.emit('close', 1); else if (ready) child.stdout.write((readyLine || 'READY ' + nonce) + '\n'); });
    return child;
  };
  return { execute, commands, calls, get child() { return child; } };
}
test('validated plan binds a direct temporary stage, strict release asset and original explicit data override', t => {
  const f = fixture(t), value = validatePlan(f.plan); assert.equal(value.manifest.installerPath, fs.realpathSync.native(f.plan.installerPath)); assert.equal(value.manifest.userDataDirectory, fs.realpathSync.native(f.plan.userDataDirectory));
  assert.equal(value.manifest.parentPid, 1001); assert.equal(value.installer.size, BigInt(f.plan.size));
  const defaultData = validatePlan({ ...f.plan, userDataDirectory: undefined }); assert.equal(Object.hasOwn(defaultData.manifest, 'userDataDirectory'), false);
});
test('version, checksum, size, PID and path ambiguities are rejected before any process is launched', t => {
  const f = fixture(t);
  for (const patch of [{ targetVersion: '1.2.3-beta' }, { targetVersion: '01.2.3' }, { targetVersion: '65536.2.3' }, { sha256: 'a'.repeat(64).toUpperCase() }, { size: 0 }, { size: 536870913 }, { parentPid: 0 }, { parentPid: 1.5 }, { stageDirectory: f.home }, { executablePath: 'relative.exe' }, { executablePath: f.plan.executablePath + '\n' }, { userDataDirectory: path.join(f.home, 'missing') }]) assert.throws(() => validatePlan({ ...f.plan, ...patch }));
  const nested = path.join(f.stage, 'nested'); fs.mkdirSync(nested); assert.throws(() => validatePlan({ ...f.plan, stageDirectory: nested }));
  const wrong = path.join(f.stage, 'other.exe'); fs.copyFileSync(f.plan.installerPath, wrong); assert.throws(() => validatePlan({ ...f.plan, installerPath: wrong }));
});
test('hardlinked installer and junction/symlink stage or explicit data are refused', t => {
  const f = fixture(t), link = path.join(f.home, 'hardlink'); fs.linkSync(f.plan.installerPath, link); assert.throws(() => validatePlan(f.plan)); fs.unlinkSync(link);
  const alias = path.join(f.home, 'alias'); fs.symlinkSync(f.stage, alias, process.platform === 'win32' ? 'junction' : 'dir'); assert.throws(() => validatePlan({ ...f.plan, stageDirectory: alias }));
  assert.throws(() => validatePlan({ ...f.plan, userDataDirectory: alias }));
});
test('explicit user data cannot be silently destroyed by installing into its directory or cleaning its stage', t => {
  const f = fixture(t), nestedData = path.join(path.dirname(f.plan.executablePath), 'nested user data'); fs.mkdirSync(nestedData);
  for (const userDataDirectory of [path.dirname(f.plan.executablePath), nestedData, f.stage, path.dirname(f.stage)]) assert.throws(() => validatePlan({ ...f.plan, userDataDirectory }));
});
test('helper bootstrap binds exact source checksum and literal paths, without policy override or shell execution', () => {
  const root = path.resolve("fixture's directory"), text = bootstrap(path.join(root, 'runner.ps1'), path.join(root, 'manifest.json'), 'a'.repeat(64), 'b'.repeat(64));
  assert.match(text, /fixture''s directory/); assert.match(text, /ComputeHash/); assert.match(text, /ScriptBlock/); assert.doesNotMatch(text, /ExecutionPolicy|cmd\.exe|Invoke-Expression/i);
  assert.throws(() => bootstrap('relative', path.join(root, 'manifest'), 'a'.repeat(64))); assert.throws(() => bootstrap(path.join(root, 'runner'), path.join(root, 'manifest'), 'bad'));
});
test('handoff hash mismatch and occupied fixed helper name fail closed without launch', async t => {
  const f = fixture(t), l = launcher(f); fs.writeFileSync(f.plan.installerPath, 'MZ different content'); await assert.rejects(armUpdate(f.plan, { platform: 'win32', execute: l.execute })); assert.equal(l.calls.length, 0);
  const g = fixture(t), m = launcher(g); fs.writeFileSync(path.join(g.stage, 'update-runner.ps1'), 'unowned'); await assert.rejects(armUpdate(g.plan, { platform: 'win32', execute: m.execute })); assert.equal(m.calls.length, 0); assert.equal(fs.readFileSync(path.join(g.stage, 'update-runner.ps1'), 'utf8'), 'unowned');
});
test('READY never implies GO: cancellation is acknowledged, leaves synthetic user data untouched and removes only owned stage files', async t => {
  const f = fixture(t), l = launcher(f); const handle = await armUpdate(f.plan, { platform: 'win32', execute: l.execute, commandMs: 50 }); assert.equal(l.commands.length, 0);
  const manifest = JSON.parse(fs.readFileSync(path.join(f.stage, 'update-manifest.json')));
  for (const name of ['stageIdentity','installerIdentity','runnerIdentity','manifestIdentity']) assert.match(manifest[name], /^\d+:\d+:\d+$/);
  assert.equal(l.calls[0].options.detached, false); assert.equal(l.calls[0].options.windowsHide, true); assert.equal(l.calls[0].options.shell, false); assert.deepEqual(l.calls[0].args.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand']);
  await handle.cancel(); assert.equal(l.commands.length, 1); assert.match(l.commands[0], /^CANCEL /); assert.equal(fs.existsSync(f.stage), false); assert.equal(fs.readFileSync(path.join(f.plan.userDataDirectory, 'sentinel'), 'utf8'), 'owned synthetic data'); await assert.rejects(handle.release());
});
test('awaited GO is nonce bound, leaves control channel open, and remains cancellable before actual parent exit', async t => {
  const f = fixture(t), l = launcher(f), handle = await armUpdate(f.plan, { platform: 'win32', execute: l.execute, commandMs: 50 }); await handle.release(); assert.match(l.commands[0], /^GO /); assert.equal(l.child.stdin.writableEnded, false); assert.equal(l.child.unreferenced, true); await assert.rejects(handle.release());
  await handle.cancel(); assert.match(l.commands[1], /^CANCEL /); assert.equal(fs.existsSync(f.stage), false);
});
test('unknown/wrong nonce readiness, early helper exit and startup timeout never issue GO', async t => {
  for (const config of [{ readyLine: 'READY wrong-nonce' }, { closedEarly: true }, { ready: false }]) {
    const f = fixture(t), l = launcher(f, config); await assert.rejects(armUpdate(f.plan, { platform: 'win32', execute: l.execute, startupMs: 20 })); await new Promise(resolve => setImmediate(resolve)); assert.equal(l.commands.some(line => line.startsWith('GO ')), false); assert.equal(fs.existsSync(f.stage), true, 'Unconfirmed independent worker state is retained.');
  }
});
test('unacknowledged GO is cancelled so a later unrelated parent quit cannot approve installation', async t => {
  const f = fixture(t), l = launcher(f, { ack: false }), handle = await armUpdate(f.plan, { platform: 'win32', execute: l.execute, commandMs: 20 }); await assert.rejects(handle.release()); await new Promise(resolve => setImmediate(resolve)); assert.match(l.commands[1], /^CANCEL /); await handle.cancel(); assert.equal(fs.existsSync(f.stage), false);
});
test('cancellation while GO acknowledgement is pending rejects release and uses one explicit cancellation', async t => {
  const f = fixture(t), l = launcher(f, { ack: false }), handle = await armUpdate(f.plan, { platform: 'win32', execute: l.execute, commandMs: 30 }); const released = handle.release(); const rejected = assert.rejects(released); await handle.cancel(); await rejected; assert.equal(l.commands.filter(line => line.startsWith('CANCEL ')).length, 1);
});
test('cancellation after acknowledged GO and broker exit reaches the independent nonce marker channel', async t => {
  const f = fixture(t), l = launcher(f), handle = await armUpdate(f.plan, { platform: 'win32', execute: l.execute, commandMs: 80 }); await handle.release(); l.child.emit('close', 0);
  const nonce = JSON.parse(fs.readFileSync(path.join(f.stage, 'update-manifest.json'))).nonce;
  const cancelled = handle.cancel();
  assert.equal(fs.readFileSync(path.join(f.stage, 'update-cancel'), 'ascii'), 'CANCEL ' + nonce + '\n');
  setTimeout(() => fs.writeFileSync(path.join(f.stage, 'update-stopped'), 'STOPPED ' + nonce + '\n'), 10);
  await cancelled; assert.equal(fs.existsSync(f.stage), false); assert.equal(fs.readFileSync(path.join(f.plan.userDataDirectory, 'sentinel'), 'utf8'), 'owned synthetic data');
});
test('unconfirmed independent cancellation rejects and preserves original installer and cancellation until a later positive stop', async t => {
  const f = fixture(t), l = launcher(f), handle = await armUpdate(f.plan, { platform: 'win32', execute: l.execute, commandMs: 25 }); await handle.release(); l.child.emit('close', 0);
  const nonce = JSON.parse(fs.readFileSync(path.join(f.stage, 'update-manifest.json'))).nonce;
  await assert.rejects(handle.cancel(), /could not be confirmed/); assert.equal(fs.existsSync(f.plan.installerPath), true); assert.equal(fs.readFileSync(path.join(f.stage, 'update-cancel'), 'ascii'), 'CANCEL ' + nonce + '\n');
  await assert.rejects(handle.release()); fs.writeFileSync(path.join(f.stage, 'update-stopped'), 'STOPPED ' + nonce + '\n'); await handle.cancel(); assert.equal(fs.existsSync(f.stage), false);
});
test('cleanup preserves unknown files and replacements and cannot traverse a substituted directory', t => {
  const f = fixture(t), checked = validatePlan(f.plan), unknown = path.join(f.stage, 'unowned'); fs.writeFileSync(unknown, 'keep'); cleanupOwned(checked.stage, [checked.installer]); assert.equal(fs.readFileSync(unknown, 'utf8'), 'keep'); assert.equal(fs.existsSync(f.plan.installerPath), false);
  fs.writeFileSync(f.plan.installerPath, 'replacement'); cleanupOwned(checked.stage, [checked.installer]); assert.equal(fs.readFileSync(f.plan.installerPath, 'utf8'), 'replacement');
});
test('Windows runner source keeps process lifetime, registry scope, no-kill, exact arguments and nonrecursive cleanup contracts', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/update-runner.ps1'), 'utf8');
  assert.match(source, /parent\.Handle/); assert.match(source, /parent\.StartTime/); assert.match(source, /parent\.MainModule\.FileName/); assert.match(source, /ReadLineAsync/); assert.match(source, /CANCEL /); assert.match(source, /parent\.HasExited/); assert.match(source, /Assert-NoUpdateInstances/); assert.match(source, /Registry64/); assert.match(source, /48ee049e-c2f6-57b2-ab6e-7f5df516dcc0/); assert.match(source, /\/S \/'\+\$Scope\+' \/D='/); assert.match(source, /\$held\.MarkDelete\(\)/); assert.match(source, /SetFileInformationByHandle/); assert.match(source, /manifest\.installerIdentity/); assert.match(source, /Conflicting registration/); assert.match(source, /targetVersion/); assert.doesNotMatch(source, /Stop-Process|\.Kill\(|taskkill|ExecutionPolicy|--force-run|--delete-app-data|Recurse/);
});
