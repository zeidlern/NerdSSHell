'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { createNativeBrokerFixture, fixtureEnvironment, observeFixtureFrames } = require('../scripts/lib/native-broker-fixture.cjs');

function temporaryProfile(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nerdsshell-fixture-unit-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function response(type, payload = Buffer.alloc(0), length = payload.length) {
  const header = Buffer.alloc(5); header[0] = type.charCodeAt(0); header.writeUInt32LE(length, 1);
  return Buffer.concat([header, payload]);
}

test('native fixture replaces every Temp casing only in its cloned child environment', () => {
  const directory = path.resolve('isolated-fixture');
  const original = Object.freeze({ TEMP: 'unsafe-a', temp: 'unsafe-b', Tmp: 'unsafe-c', TMP: 'unsafe-d',
    PSModulePath: 'fixed;personal', PATH: 'unchanged', CUSTOM: 'retained' });
  const prior = { ...process.env };
  const child = fixtureEnvironment(original, directory);
  assert.deepEqual(child, { PSModulePath: 'fixed;personal', PATH: 'unchanged', CUSTOM: 'retained', TEMP: directory, TMP: directory });
  assert.equal(original.temp, 'unsafe-b'); assert.equal(original.Tmp, 'unsafe-c');
  assert.ok(JSON.stringify({ ...process.env }) === JSON.stringify(prior), 'parent environment remains unchanged');
  assert.throws(() => fixtureEnvironment(original, 'relative'), /Invalid native fixture environment/);
  assert.throws(() => fixtureEnvironment(original, directory + '\n'), /Invalid native fixture environment/);
});

test('native fixture exclusively creates canonical roots and removes only its owned artifacts', async t => {
  const parent = temporaryProfile(t), alias = path.join(parent, 'profile-alias'), profile = path.join(parent, 'profile');
  fs.mkdirSync(profile); fs.symlinkSync(profile, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const first = createNativeBrokerFixture({ profile: alias }), second = createNativeBrokerFixture({ profile: alias });
  assert.equal(path.dirname(first.directory), fs.realpathSync.native(profile));
  assert.notEqual(first.directory, second.directory);
  assert.equal(fs.lstatSync(first.directory).isSymbolicLink(), false);
  assert.equal(first.environment({ temp: 'ambient' }).TEMP, first.directory);
  fs.writeFileSync(path.join(first.directory, 'compiler-artifact.cs'), 'inert synthetic compiler artifact');
  fs.writeFileSync(path.join(profile, 'unrelated.txt'), 'must survive');
  await first.dispose(); await first.dispose();
  assert.equal(fs.existsSync(first.directory), false);
  assert.equal(fs.existsSync(second.directory), true);
  assert.equal(fs.readFileSync(path.join(profile, 'unrelated.txt'), 'utf8'), 'must survive');
  await second.dispose();
});

test('native fixture preserves surviving stage directories and native files', async t => {
  const fixture = createNativeBrokerFixture({ profile: temporaryProfile(t) });
  const stage = path.join(fixture.directory, 'NerdSSHell-ConPTY-synthetic'); fs.mkdirSync(stage);
  await assert.rejects(fixture.dispose({ timeoutMs: 0 }), /survived cleanup; fixture preserved/);
  assert.equal(fs.existsSync(stage), true);
  fs.rmdirSync(stage);
  const native = path.join(fixture.directory, 'OpenConsole.exe'); fs.writeFileSync(native, 'inert');
  await assert.rejects(fixture.dispose({ timeoutMs: 0 }), /survived cleanup; fixture preserved/);
  assert.equal(fs.readFileSync(native, 'utf8'), 'inert'); fs.unlinkSync(native);
  await fixture.dispose();
});

test('native fixture rejects replacement of its owned cleanup root', async t => {
  const fixture = createNativeBrokerFixture({ profile: temporaryProfile(t) }), saved = fixture.directory + '-saved';
  fs.renameSync(fixture.directory, saved); fs.mkdirSync(fixture.directory);
  await assert.rejects(fixture.dispose({ timeoutMs: 0 }), /identity changed/);
  assert.equal(fs.existsSync(fixture.directory), true); assert.equal(fs.existsSync(saved), true);
  fs.rmdirSync(fixture.directory); fs.renameSync(saved, fixture.directory); await fixture.dispose();
});

test('native fixture diagnostics retain only one bounded failure across fragmented frames', () => {
  const child = { stdout: new PassThrough() }, seen = [];
  const observation = observeFixtureFrames(child, { onFailure: message => seen.push(message) });
  const secretOutput = Buffer.alloc(65536, 97), failure = 'IOException: Native staging permits untrusted changes';
  const bytes = Buffer.concat([response('R'), response('D', secretOutput), response('F', Buffer.from(failure)), response('F', Buffer.from('second'))]);
  for (let offset = 0; offset < bytes.length; offset += 17) child.stdout.write(bytes.subarray(offset, offset + 17));
  assert.equal(observation.failure, failure); assert.equal(observation.error, ''); assert.deepEqual(seen, [failure]);
  assert.equal(observation.diagnostic().includes('aaaa'), false, 'terminal output is never retained');
  observation.dispose(); assert.equal(child.stdout.listenerCount('data'), 0); child.stdout.destroy();
});

test('native fixture diagnostics reject oversized and truncated frames without retaining their bodies', async () => {
  for (const bytes of [response('F', Buffer.from('secret'), 1025), response('D', Buffer.alloc(0), 65537), response('F', Buffer.from('partial'), 20)]) {
    const child = { stdout: new PassThrough() }, observation = observeFixtureFrames(child);
    child.stdout.end(bytes); await new Promise(resolve => child.stdout.once('end', resolve));
    assert.match(observation.error, /Invalid native fixture frame|Truncated native fixture frame/);
    assert.equal(observation.failure, ''); observation.dispose();
  }
});

if (process.platform === 'win32') test('native fixture isolates unsafe ambient Temp ancestors while unchanged native guards still reject them', { timeout: 25000 }, async t => {
  const fixture = createNativeBrokerFixture();
  t.after(async () => fixture.dispose());
  const ambient = path.join(fixture.directory, 'unsafe-ambient'), nested = path.join(ambient, 'Temp');
  fs.mkdirSync(nested, { recursive: true });
  const inherited = { ...process.env, TEMP: nested, TMP: nested }, isolated = fixture.environment(inherited);
  assert.equal(inherited.TEMP, nested); assert.equal(isolated.TEMP, fixture.directory);
  const source = path.join(__dirname, '../src/elevated-console.cs'), bytes = fs.readFileSync(source);
  const { bootstrap } = require('../src/elevated-pty.cjs');
  const production = bootstrap(source, createHash('sha256').update(bytes).digest('hex'), 'local:cmd');
  const boundary = production.indexOf('[BetterSSH.ElevatedConsole]::Broker('); assert.ok(boundary > 0);
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  // Only this exclusive inert scratch object's ACL is changed. Compile exact
  // hash-checked source and exercise read-only ancestor validation: no UAC,
  // native image load, shell process, or machine-wide ACL change occurs.
  const harness = production.slice(0, boundary) + String.raw`
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
try { $sid = $identity.User } finally { $identity.Dispose() }
$acl = [Security.AccessControl.DirectorySecurity]::new()
$acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false)
foreach ($allowed in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($allowed,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.AccessControlType]::Allow))
}
# Protect the inert child ACL before the parent changes, preventing removal of
# inherited child access from obscuring the ancestor rejection under test.
[IO.Directory]::SetAccessControl(${quote(nested)},$acl)
$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'),[Security.AccessControl.FileSystemRights]::Modify,[Security.AccessControl.AccessControlType]::Allow))
[IO.Directory]::SetAccessControl(${quote(ambient)},$acl)
$type = [BetterSSH.ElevatedConsole].GetNestedType('DirectoryPins',[Reflection.BindingFlags]::NonPublic)
$constructor = $type.GetConstructor(@([string],[bool],[string]))
try {
  $pins = $constructor.Invoke(@(${quote(nested)},$true,$sid.Value))
  try { throw 'Unsafe ambient Temp was accepted' } finally { ([IDisposable]$pins).Dispose() }
} catch {
  if ($_.Exception.GetBaseException().Message -ne 'Native staging permits untrusted changes') { throw }
  [Console]::WriteLine('UNSAFE_AMBIENT_ANCESTOR_REJECTED')
}
if ($env:TEMP -ne ${quote(fixture.directory)} -or $env:TMP -ne ${quote(fixture.directory)}) { throw 'Fixture child Temp was not isolated' }
$pins = $constructor.Invoke(@($env:TEMP,$true,$sid.Value))
try { [Console]::WriteLine('ISOLATED_FIXTURE_ANCESTORS_ACCEPTED') } finally { ([IDisposable]$pins).Dispose() }
`;
  const executable = require('../src/local-remote.cjs').installedShells().find(shell => shell.id === 'local:powershell')?.executable;
  assert.ok(executable, 'fixed Windows PowerShell is required');
  const { windowsPowerShellEnvironment } = require('../src/powershell-environment.cjs');
  const result = spawnSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(harness, 'utf16le').toString('base64')],
    { windowsHide: true, shell: false, env: windowsPowerShellEnvironment(isolated), encoding: 'utf8', timeout: 20000, maxBuffer: 65536 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /UNSAFE_AMBIENT_ANCESTOR_REJECTED/);
  assert.match(result.stdout, /ISOLATED_FIXTURE_ANCESTORS_ACCEPTED/);
  assert.equal(fs.existsSync(nested), true, 'validation does not remove the unsafe caller-owned input');
});
