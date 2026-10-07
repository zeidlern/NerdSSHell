'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events'), { PassThrough } = require('node:stream');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { createHash } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { ElevatedPty, spawnElevatedPty, bootstrap, frame } = require('../src/elevated-pty.cjs');
const { PtyChannel, cmdPromptReady } = require('../src/local-remote.cjs');
const { consoleText } = require('../src/console-text.cjs');
const { windowsPowerShellEnvironment } = require('../src/powershell-environment.cjs');
const { createNativeBrokerFixture, observeFixtureFrames } = require('../scripts/lib/native-broker-fixture.cjs');
require('./native-broker-fixture.test.cjs');

class FakeChild extends EventEmitter {
  constructor() {
    super(); this.stdin = new PassThrough(); this.stdout = new PassThrough(); this.stderr = new PassThrough();
    this.sent = []; this.kills = 0; this.stdin.on('data', bytes => this.sent.push(Buffer.from(bytes)));
  }
  complete(code = 0) { this.emit('exit', code); this.emit('close', code); }
  kill() { this.kills++; this.complete(-1); }
}
// Responses use an independent encoder, so malformed protocol tests do not
// depend on the implementation's outgoing-frame validation.
function response(type, data = Buffer.alloc(0), declared = data.length) {
  const header = Buffer.alloc(5); header[0] = type.charCodeAt(0); header.writeUInt32LE(declared, 1);
  return Buffer.concat([header, data]);
}
function fixture(t, options) {
  const child = new FakeChild(), result = { child, cleaned: 0, output: [], exits: [] };
  result.pty = new ElevatedPty(child, () => result.cleaned++, options);
  result.ready = result.pty.ready.catch(error => error);
  result.pty.onData(text => result.output.push(text)); result.pty.onExit(event => result.exits.push(event));
  t.after(() => { child.complete(); result.pty.finish(); });
  return result;
}
function sourceFixture(t, bytes = Buffer.from('// isolated, inert helper fixture')) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nerdsshell-admin-test-'));
  const filename = path.join(directory, 'fixture.cs'); fs.writeFileSync(filename, bytes);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return filename;
}

test('fragmented response headers and UTF-8 output preserve exact order until resume', async t => {
  const h = fixture(t), text = 'first 😀 λ\r\nPS C:\\fixture> ';
  const bytes = Buffer.from(text), split = bytes.indexOf(0xf0) + 2;
  const wire = Buffer.concat([response('R'), response('D', bytes.subarray(0, split)), response('D', bytes.subarray(split))]);
  for (const byte of wire) h.child.stdout.write(Buffer.from([byte]));
  assert.equal(await h.ready, h.pty); assert.deepEqual(h.output, []);
  h.pty.resume(); assert.equal(h.output.join(''), text); assert.equal(h.pty.pendingBytes, 0);
  h.child.stdout.write(response('D', Buffer.from('next'))); assert.equal(h.output.join(''), text + 'next');
});

test('disposed terminal callbacks receive no output or exit', async t => {
  const h = fixture(t); let calls = 0;
  const data = h.pty.onData(() => calls++), exit = h.pty.onExit(() => calls++);
  data.dispose(); exit.dispose(); h.pty.receive(response('R')); await h.ready;
  h.pty.resume(); h.pty.receive(response('D', Buffer.from('visible')));
  h.child.complete(); assert.equal(calls, 0); assert.equal(h.cleaned, 1);
});

test('unauthenticated output fails closed without delivering text or accepting later ready', async t => {
  const h = fixture(t); h.pty.receive(response('D', Buffer.from('untrusted')));
  assert.match((await h.ready).message, /preceded authentication/);
  h.pty.receive(response('R')); h.pty.resume();
  assert.deepEqual(h.output, []); assert.equal(h.cleaned, 1); assert.equal(h.pty.started, undefined);
  assert.equal(Buffer.concat(h.child.sent).toString('hex'), response('C').toString('hex'));
});

test('duplicate ready response terminates the established bridge exactly once', async t => {
  const h = fixture(t); h.pty.receive(response('R')); assert.equal(await h.ready, h.pty);
  h.pty.receive(response('R')); h.pty.receive(response('R')); h.child.emit('exit', 0);
  assert.equal(h.pty.ended, true); assert.deepEqual(h.exits, [{ exitCode: -1 }]); assert.equal(h.cleaned, 1);
});

test('UAC cancellation is distinguishable, cleans up once and never retries', async t => {
  const h = fixture(t); h.pty.receive(response('X')); const error = await h.ready;
  assert.equal(error.code, 'NERDSSHELL_UAC_CANCELLED');
  h.pty.receive(response('R')); h.pty.kill(); h.child.emit('exit', 0);
  assert.equal(h.cleaned, 1); assert.equal(h.child.kills, 0);
  assert.equal(Buffer.concat(h.child.sent).toString('hex'), response('C').toString('hex'));
});

for (const [label, wire] of [
  ['unknown type', response('Z')], ['oversized data header', response('D', Buffer.alloc(0), 65537)],
  ['ready payload', response('R', Buffer.from('x'))], ['cancel payload', response('X', Buffer.from('x'))],
  ['invalid exit length', response('E', Buffer.alloc(3))], ['oversized failure', response('F', Buffer.alloc(0), 1025)]
]) test('malformed administrator response rejects ' + label + ' before waiting for payload', async t => {
  const h = fixture(t); h.pty.receive(wire);
  assert.match((await h.ready).message, /Invalid administrator helper response/);
  assert.equal(h.cleaned, 1); assert.deepEqual(h.output, []); assert.equal(h.pty.buffer.length, 0);
});

test('an oversized raw response chunk is discarded without retaining attacker bytes', async t => {
  const h = fixture(t);
  h.pty.receive(response('D', Buffer.alloc(2 * 1024 * 1024, 97)));
  assert.ok(await h.ready instanceof Error); assert.equal(h.pty.buffer.length, 0); assert.equal(h.cleaned, 1);
});

test('zero-length data does not accumulate pending objects and paused data stays bounded', async t => {
  const h = fixture(t); h.pty.receive(response('R')); await h.ready;
  for (let i = 0; i < 10000; i++) h.pty.receive(response('D'));
  assert.equal(h.pty.pending.length, 0, 'Empty frames must not bypass the pending-byte budget');
  for (let i = 0; i < 5; i++) h.pty.receive(response('D', Buffer.alloc(65536, 97)));
  assert.equal(h.pty.ended, true); assert.equal(h.cleaned, 1); assert.equal(h.pty.pending.length, 0);
});

test('terminal input cannot precede authentication and byte-sized frames preserve Unicode', async t => {
  const h = fixture(t);
  assert.throws(() => h.pty.write('preauth'), /not connected/);
  assert.throws(() => h.pty.resize(80, 24), /not connected/); assert.deepEqual(h.child.sent, []);
  h.pty.receive(response('R')); await h.ready;
  h.pty.write('😀'.repeat(16384));
  const sent = h.child.sent.at(-1); assert.equal(sent[0], 73); assert.equal(sent.readUInt32LE(1), 65536);
  assert.equal(sent.subarray(5).toString('utf8'), '😀'.repeat(16384));
  assert.throws(() => h.pty.write('😀'.repeat(16385)), /Invalid administrator input frame/);
  for (const value of [null, {}, Buffer.from('x')]) assert.throws(() => h.pty.write(value));
});

test('geometry validates integer bounds before sending exactly one little-endian resize', async t => {
  const h = fixture(t); h.pty.receive(response('R')); await h.ready;
  for (const [cols, rows] of [[19, 24], [1001, 24], [80, 4], [80, 501], [80.1, 24], [80, NaN], ['80', 24]]) assert.throws(() => h.pty.resize(cols, rows), /geometry/);
  assert.deepEqual(h.child.sent, []);
  h.pty.resize(1000, 500);
  assert.equal(Buffer.concat(h.child.sent).toString('hex'), '5304000000e803f401');
});

test('blocked broker stdin has a bounded queue and rejected input is never replayed after drain', async t => {
  const h = fixture(t); h.pty.receive(response('R')); await h.ready;
  // Real stream backpressure: stop reading the fake broker's stdin instead of
  // replacing writableLength with a fabricated number.
  h.child.stdin.removeAllListeners('data'); h.child.stdin.pause();
  const accepted = 'a'.repeat(65531), rejected = 'SHOULD_NOT_BE_REPLAYED\r';
  for (let i = 0; i < 4; i++) h.pty.write(accepted);
  assert.equal(h.child.stdin.writableLength, 262144);
  assert.throws(() => h.pty.write(rejected), /backpressure.*not queued/);
  assert.throws(() => h.pty.resize(80, 24), /backpressure.*not queued/);
  assert.equal(h.child.stdin.writableLength, 262144);
  assert.equal(h.pty.ended, false, 'Backpressure rejects this input without replacing the console');
  const wire = []; h.child.stdin.on('data', bytes => wire.push(Buffer.from(bytes))); h.child.stdin.resume();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.child.stdin.writableLength, 0);
  h.pty.write('AFTER_DRAIN\r'); await new Promise(resolve => setImmediate(resolve));
  const bytes = Buffer.concat(wire), payloads = [];
  for (let offset = 0; offset < bytes.length;) {
    assert.equal(bytes[offset], 73);
    const length = bytes.readUInt32LE(offset + 1);
    payloads.push(bytes.subarray(offset + 5, offset + 5 + length).toString('utf8')); offset += 5 + length;
  }
  assert.deepEqual(payloads, [accepted, accepted, accepted, accepted, 'AFTER_DRAIN\r']);
});

test('outgoing frame allowlist rejects wrong payload types and unbounded or unexpected commands', () => {
  for (const [kind, data] of [['D', Buffer.alloc(0)], ['I', 'text'], ['I', Buffer.alloc(65537)], ['S', Buffer.alloc(3)], ['C', Buffer.from('extra')]]) assert.throws(() => frame(kind, data), /Invalid administrator input/);
  assert.equal(frame('C').toString('hex'), '4300000000');
});

test('bounded startup timeout closes once, rejects ready, and ignores late authentication', async t => {
  const h = fixture(t, { startupMs: 10 }); const error = await h.ready;
  assert.match(error.message, /timed out.*not retried/);
  h.pty.receive(response('R')); h.child.emit('exit', 0);
  assert.equal(h.cleaned, 1); assert.equal(h.pty.started, undefined); assert.equal(h.child.kills, 0);
});

test('repeated cancellation sends one close and forces only the owned child after a bounded wait', async t => {
  const h = fixture(t); h.pty.receive(response('R')); await h.ready;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  h.pty.kill(); h.pty.kill();
  assert.equal(Buffer.concat(h.child.sent).toString('hex'), response('C').toString('hex'));
  t.mock.timers.tick(1999); assert.equal(h.child.kills, 0);
  t.mock.timers.tick(1); assert.equal(h.child.kills, 1); assert.equal(h.cleaned, 1);
  t.mock.timers.tick(10000); assert.equal(h.child.kills, 1);
});

test('broker and transport errors reject startup without leaking stderr or retrying', async t => {
  for (const which of ['error', 'stdin', 'stdout', 'F']) {
    const h = fixture(t); h.child.stderr.write('private compiler path and credentials');
    if (which === 'F') h.pty.receive(response('F', Buffer.from('sensitive path')));
    else if (which === 'error') h.child.emit('error', Error('private process details'));
    else h.child[which].emit('error', Error('private stream details'));
    const error = await h.ready; assert.ok(error instanceof Error);
    assert.doesNotMatch(error.message, /private|sensitive|credentials/); assert.deepEqual(h.output, []);
    assert.equal(h.cleaned, 1); h.child.emit('exit', 0);
  }
});

test('exit frame preserves signed code, cleans once and ignores subsequent output', async t => {
  const h = fixture(t); h.pty.receive(response('R')); await h.ready; h.pty.resume();
  const code = Buffer.alloc(4); code.writeInt32LE(-42);
  h.pty.receive(response('E', code)); h.pty.receive(response('D', Buffer.from('late'))); h.child.emit('exit', 0);
  assert.deepEqual(h.exits, [{ exitCode: -42 }]); assert.deepEqual(h.output, []); assert.equal(h.cleaned, 1);
  assert.throws(() => h.pty.write('late'), /not connected/);
});

test('paused final output remains readable and late exit subscriptions observe the original code once', async t => {
  const h = fixture(t); h.pty.receive(response('R')); await h.ready;
  h.pty.receive(response('D', Buffer.from('final output 😀')));
  const code = Buffer.alloc(4); code.writeInt32LE(7); h.pty.receive(response('E', code));
  assert.deepEqual(h.output, []);
  h.pty.resume(); h.pty.resume(); assert.equal(h.output.join(''), 'final output 😀');
  const late = [], disposed = [];
  h.pty.onExit(event => late.push(event));
  h.pty.onExit(event => disposed.push(event)).dispose();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(late, [{ exitCode: 7 }]); assert.deepEqual(disposed, []); assert.equal(h.cleaned, 1);
});

test('PTY adapter drains a completed administrator task before EOF even when its reader attaches later', async t => {
  const h = fixture(t); h.pty.receive(response('R')); await h.ready;
  const text = 'LAST_ADMIN_LINE 😀\r\n';
  h.pty.receive(Buffer.concat([response('D', Buffer.from(text)), response('E', Buffer.alloc(4))]));
  const channel = new PtyChannel(h.pty); channel.pause();
  t.after(() => channel.destroy());
  await new Promise(resolve => setImmediate(resolve));
  const chunks = []; channel.on('data', bytes => chunks.push(bytes));
  channel.resume();
  await new Promise((resolve, reject) => { channel.once('end', resolve); channel.once('error', reject); });
  assert.equal(Buffer.concat(chunks).toString('utf8'), text);
  assert.equal(h.pty.pending.length, 0); assert.equal(h.cleaned, 1);
});

test('broker process exit preserves final OS-pipe output until stdio closes', async t => {
  const h = fixture(t); h.child.stdout.write(response('R')); await h.ready; h.pty.resume();
  h.child.emit('exit', 7);
  assert.equal(h.pty.ended, false); assert.equal(h.cleaned, 0);
  const text = 'LAST_OS_PIPE_BYTES 😀\r\n', wire = response('D', Buffer.from(text));
  h.child.stdout.write(wire.subarray(0, 8)); h.child.stdout.write(wire.subarray(8));
  h.child.stdout.end(); h.child.emit('close', 7);
  assert.equal(h.output.join(''), text); assert.deepEqual(h.exits, [{ exitCode: 7 }]); assert.equal(h.cleaned, 1);
});

for (const [label, bytes] of [
  ['partial header', Buffer.from([68, 3])],
  ['partial payload', response('D', Buffer.from('part'), 10)]
]) test('stdio close with ' + label + ' rejects a truncated helper stream and clears retained bytes', async t => {
  const h = fixture(t);
  h.child.stdout.write(bytes); h.child.emit('exit', 0); h.child.emit('close', 0);
  assert.match((await h.ready).message, /Truncated administrator helper output/);
  assert.deepEqual(h.output, []); assert.deepEqual(h.exits, [{ exitCode: -1 }]);
  assert.equal(h.pty.buffer.length, 0); assert.equal(h.cleaned, 1);
});

test('once closing starts input and resize cannot be sent even before child exit', async t => {
  const h = fixture(t); h.pty.receive(response('R')); await h.ready; h.pty.kill();
  assert.throws(() => h.pty.write('must not run'), /not connected/);
  assert.throws(() => h.pty.resize(80, 24), /not connected/);
  assert.equal(Buffer.concat(h.child.sent).toString('hex'), response('C').toString('hex'));
});

test('bootstrap validates shell, path and digest and quotes paths as literals', () => {
  const file = path.resolve("fixture'; $(malicious).cs"), digest = 'a'.repeat(64);
  for (const id of [null, {}, 'remote:server', 'local:pwsh;evil']) assert.throws(() => bootstrap(file, digest, id), /Invalid administrator/);
  for (const hash of ['', 'A'.repeat(64), 'a'.repeat(63), "'; evil #"]) assert.throws(() => bootstrap(file, hash, 'local:pwsh'), /Invalid administrator/);
  assert.throws(() => bootstrap('relative.cs', digest, 'local:pwsh'), /Invalid administrator/);
  const script = bootstrap(file, digest, 'local:pwsh');
  assert.match(script, /fixture''; \$\(malicious\).cs/);
  assert.match(script, /New-Object byte\[\] 131073/); assert.doesNotMatch(script, /ReadAllBytes/);
  assert.match(script, /\$b=\$exact;.*ComputeHash\(\$b\).*GetString\(\$b\)/);
  assert.ok(script.endsWith(",'local:pwsh'," + process.pid + ')'));
  assert.ok(script.indexOf('ComputeHash') < script.indexOf('Add-Type'));
  assert.match(script, /Helper integrity failure/);
  assert.doesNotMatch(script, /Invoke-Expression|ExecutionPolicy|Credential|Install-Module/);
});

test('bootstrap treats the native provider directory as an absolute literal, never a command', () => {
  const file = path.resolve('fixture.cs'), digest = 'a'.repeat(64);
  for (const directory of [null, {}, ['native'], '', 'relative/native', path.resolve('native\npath'), path.resolve('native\0path'), path.resolve('x'.repeat(1025))]) {
    assert.throws(() => bootstrap(file, digest, 'local:powershell', directory), /Invalid administrator/);
  }
  const directory = path.resolve("provider'; $(UNREVIEWED_NATIVE) & 日本語");
  const script = bootstrap(file, digest, 'local:powershell', directory);
  assert.ok(script.includes("'" + directory.replaceAll("'", "''") + "','local:powershell'," + process.pid + ')'));
  assert.doesNotMatch(script, /Invoke-Expression|Start-Process|ExecutionPolicy/);
});

const nativeCmdStartup = '\x1b[?9001h\x1b[?1004h\x1b[?25l\x1b[2J\x1b[m\x1b[HMicrosoft Windows [Version 10.0.26100.33438]\x1b]0;C:\\Windows\\System32\\cmd.exe\x07\x1b[?25h\x1b[?25l\r\n(c) Microsoft Corporation. All rights reserved.\x1b[4;1HC:\\Users\\runneradmin>\x1b]0;Administrator: C:\\Windows\\System32\\cmd.exe\x07\x1b[?25h';

test('console text preserves only column-one CUP/HVP boundaries and keeps other CSI markers', () => {
  for (const final of ['H', 'f']) for (const position of ['', '4', '4;', ';', '0;0', '4;0', '4;1', '4;001']) {
    const raw = `Copyright\x1b[${position}${final}C:\\Fixture>`;
    assert.equal(consoleText(raw), 'Copyright\nC:\\Fixture>');
    assert.equal(cmdPromptReady(raw), true);
  }
  for (const sequence of ['\x1b[4;2H', '\x1b[4;2f', '\x1b[?1H', '\x1b[4;1;1H', '\x1b[0m', '\x1b[?25h', '\x1b[2J']) {
    assert.equal(consoleText(`before${sequence}CMD_MARKER`), 'beforeCMD_MARKER');
    assert.equal(cmdPromptReady(`Copyright${sequence}C:\\Fixture>`), false);
  }
  assert.equal(cmdPromptReady('C:\\Fixture>\x1b[4;1'), false, 'an incomplete CSI must not disappear into a ready prompt');
  assert.equal(consoleText('\x1b]0;hidden\x1b[4;1HC:\\Hidden>'), '', 'unfinished OSC hides cursor codes and prompt-shaped title text');
});

test('administrator readiness recognizes the actual ConPTY CMD startup cursor-positioned prompt', async t => {
  assert.equal(consoleText(nativeCmdStartup), '\nMicrosoft Windows [Version 10.0.26100.33438]\r\n(c) Microsoft Corporation. All rights reserved.\nC:\\Users\\runneradmin>');
  assert.equal(cmdPromptReady(nativeCmdStartup), true);
  const h = fixture(t, { shellId: 'local:cmd' }); h.pty.receive(response('R')); await h.ready;
  h.pty.receive(response('D', Buffer.from(nativeCmdStartup)));
  await h.pty.readyForInput();
  assert.deepEqual(h.child.sent, [], 'readiness never injects probe input');
});

test('administrator readiness handles native CMD startup fragmented within CSI, OSC and bridge frames', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = fixture(t, { shellId: 'local:cmd' }); h.pty.receive(response('R')); await h.ready;
  let ready = false; const pending = h.pty.readyForInput().then(() => { ready = true; });
  const promptEnd = nativeCmdStartup.indexOf('runneradmin>') + 'runneradmin>'.length;
  for (let i = 0; i < nativeCmdStartup.length; i++) {
    for (const byte of response('D', Buffer.from(nativeCmdStartup[i]))) h.pty.receive(Buffer.from([byte]));
    if (i + 1 < promptEnd) {
      assert.equal(cmdPromptReady(h.pty.promptText), false, `startup prefix ${i + 1} is not a prompt`);
      t.mock.timers.tick(50); await Promise.resolve(); assert.equal(ready, false);
    }
  }
  t.mock.timers.tick(50); await pending;
  assert.equal(ready, true); assert.equal(h.pty.promptText, nativeCmdStartup); assert.deepEqual(h.child.sent, []);
});

test('administrator CMD bootstrap includes only its fixed shell ID and readiness expects its own prompt', async t => {
  const script = bootstrap(path.resolve('fixture.cs'), 'a'.repeat(64), 'local:cmd');
  assert.ok(script.endsWith(",'local:cmd'," + process.pid + ')'));
  assert.doesNotMatch(script, /cmd\.exe|\/k|Invoke-Expression/);
  const h = fixture(t, { shellId: 'local:cmd' }); h.pty.receive(response('R')); await h.ready;
  h.pty.receive(response('D', Buffer.from('\x1b]0;Command Prompt\x07C:\\Folder & 日本語>\x1b[0m')));
  await h.pty.readyForInput(); assert.equal(h.pty.shellId, 'local:cmd'); assert.deepEqual(h.child.sent, []);
  h.pty.kill(); await assert.rejects(h.pty.readyForInput(), /ended/);
});

test('administrator readiness preserves the prompt between fragmented ST-terminated OSC titles', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = fixture(t, { shellId: 'local:cmd' }); h.pty.receive(response('R')); await h.ready;
  h.pty.receive(response('D', Buffer.from('\x1b]0;hidden\r\nC:\\NotReady>')));
  let ready = false; const pending = h.pty.readyForInput().then(() => { ready = true; });
  t.mock.timers.tick(50); await Promise.resolve(); assert.equal(ready, false);
  const tail = '\x1b\\\r\nCMD_MARKER_one\r\nC:\\Fixture>\x1b]0;second title\x1b\\';
  const wire = response('D', Buffer.from(tail));
  for (const byte of wire) h.pty.receive(Buffer.from([byte]));
  t.mock.timers.tick(50); await pending; assert.equal(ready, true); assert.deepEqual(h.child.sent, []);
});

test('source failures and hostile shell IDs fail before any native launch', async t => {
  let attempts = 0; const execute = () => { attempts++; throw Error('Unexpected native launch'); };
  const sourceFile = sourceFixture(t);
  for (const id of [undefined, {}, ['local:pwsh'], 'local:pwsh;evil', 'local:cmd /k echo evil', 'C:\\evil.exe']) await assert.rejects(spawnElevatedPty(id, { sourceFile, execute }), /supported administrator shell/);
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(131073)]) {
    fs.writeFileSync(sourceFile, bytes);
    await assert.rejects(spawnElevatedPty('local:powershell', { sourceFile, execute }), /unavailable/);
  }
  await assert.rejects(spawnElevatedPty('local:pwsh', { sourceFile: path.dirname(sourceFile), execute }));
  await assert.rejects(spawnElevatedPty('local:pwsh', { sourceFile: sourceFile + '.missing', execute }));
  assert.equal(attempts, 0);
});

if (process.platform === 'win32') test('Windows PowerShell rejects a grown helper copy using bounded reads before compilation or UAC', t => {
  const file = sourceFixture(t, Buffer.alloc(2 * 1024 * 1024, 97));
  const script = bootstrap(file, 'a'.repeat(64), 'local:powershell');
  // Shadow compilation as a fail-fast sentinel. Only the bootstrap's bounded
  // read of this disposable file executes; no helper compilation or UAC runs.
  const harness = "function Add-Type { [Console]::Error.WriteLine('UNEXPECTED_COMPILE'); throw 'Compilation is forbidden in this fixture' }; try { " + script +
    "; throw 'Oversized helper was accepted' } catch { if ($_.Exception.Message -ne 'Helper too large' -or $n -ne 131073 -or $b.Length -ne 131073) { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }; [Console]::WriteLine('BOUNDED_REJECT_BEFORE_COMPILE'); exit 0 }";
  const executable = require('../src/local-remote.cjs').installedShells().find(s => s.id === 'local:powershell')?.executable;
  assert.ok(executable, 'Windows PowerShell 5.1 must be installed for Windows acceptance');
  const result = spawnSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(harness, 'utf16le').toString('base64')],
    { encoding: 'utf8', timeout: 20000, windowsHide: true, shell: false, maxBuffer: 65536 });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  assert.match(result.stdout, /BOUNDED_REJECT_BEFORE_COMPILE/); assert.doesNotMatch(result.stderr, /UNEXPECTED_COMPILE/);
  // The read handle was disposed even on the rejection path.
  fs.renameSync(file, file + '.closed'); assert.equal(fs.existsSync(file + '.closed'), true);
});

if (process.platform === 'win32') {
  const nativePair = path.join(path.dirname(require.resolve('node-pty/package.json')), 'prebuilds', 'win32-x64', 'conpty');
  const nativeNames = ['conpty.dll', 'OpenConsole.exe'];
  function providerFixture(t) {
    const requested = fs.mkdtempSync(path.join(os.tmpdir(), 'nerdsshell-provider-test-'));
    const directory = fs.realpathSync.native(requested);
    t.diagnostic('Owned native fixture path: ' + JSON.stringify({ requested, canonical: directory }));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const native = path.join(directory, 'native'); fs.mkdirSync(native);
    for (const name of nativeNames) fs.copyFileSync(path.join(nativePair, name), path.join(native, name), fs.constants.COPYFILE_EXCL);
    return { directory, native };
  }
  async function rejectNativeProvider(native) {
    const source = path.join(__dirname, '../src/elevated-console.cs');
    const digest = createHash('sha256').update(fs.readFileSync(source)).digest('hex');
    const script = bootstrap(source, digest, 'local:cmd', native)
      .replace('[NerdSSHell.ElevatedConsole]::Broker(', '[NerdSSHell.ElevatedConsole]::BrokerFixture(');
    const executable = require('../src/local-remote.cjs').installedShells().find(shell => shell.id === 'local:powershell')?.executable;
    assert.ok(executable, 'fixed Windows PowerShell is required for native provider rejection');
    const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'], env: windowsPowerShellEnvironment() });
    let stdout = Buffer.alloc(0), stderr = '', failure, closed = false;
    child.stdin.on('error', () => {});
    child.on('error', error => { failure ||= error; });
    child.stdout.on('data', data => {
      if (stdout.length + data.length > 65536) { failure ||= Error('Native rejection exceeded its output bound'); child.kill(); return; }
      stdout = Buffer.concat([stdout, data]);
      // Keep stdin alive until a complete response, so helper-side validation
      // cannot race the broker's independent EOF/owner shutdown path.
      if (stdout.length >= 5 && stdout.length >= 5 + stdout.readUInt32LE(1)) child.stdin.end();
    });
    child.stderr.on('data', data => { stderr = (stderr + data.toString('utf8')).slice(-4096); });
    const ended = new Promise(resolve => child.once('close', code => { closed = true; resolve(code); }));
    const bounded = async (promise, timeout) => {
      let timer;
      try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Native provider rejection timed out: ' + stderr)), timeout); })]); }
      finally { clearTimeout(timer); }
    };
    let status;
    try { status = await bounded(ended, 15000); }
    finally {
      if (!closed) { child.stdin.end(); child.kill(); await bounded(ended, 3000); }
      assert.equal(closed, true, 'owned rejection broker must close');
      assert.ok([child.stdin, child.stdout, child.stderr].every(stream => stream.destroyed), 'owned rejection transport must close');
    }
    assert.ifError(failure);
    assert.equal(status, 0, stderr);
    assert.ok(stdout.length >= 5, 'rejection must use the framed bridge failure response');
    assert.equal(stdout[0], 'F'.charCodeAt(0), 'unsafe provider must fail before a ready response');
    const length = stdout.readUInt32LE(1);
    assert.ok(length > 0 && length <= 1024, 'bounded native rejection');
    assert.equal(stdout.length, 5 + length, 'unsafe provider sends no shell output or other frame');
  }
  for (const name of nativeNames) for (const mutation of ['changed', 'truncated']) {
    test(`native broker rejects ${mutation} ${name} before opening a console`, { timeout: 20000 }, async t => {
      const { native } = providerFixture(t), file = path.join(native, name);
      const original = fs.readFileSync(file);
      const damaged = mutation === 'truncated' ? original.subarray(0, 32) : Buffer.from(original);
      if (mutation === 'changed') damaged[Math.floor(damaged.length / 2)] ^= 1;
      fs.writeFileSync(file, damaged);
      await rejectNativeProvider(native);
      assert.deepEqual(fs.readFileSync(file), damaged, 'rejection does not modify the caller-owned native input');
      const sibling = nativeNames.find(value => value !== name);
      assert.deepEqual(fs.readFileSync(path.join(native, sibling)), fs.readFileSync(path.join(nativePair, sibling)), 'unrelated native sibling remains unchanged');
    });
  }
  test('native broker rejects an owned junction in the provider path without following or removing its target', { timeout: 20000 }, async t => {
    const { directory, native } = providerFixture(t), junction = path.join(directory, 'linked-native');
    fs.symlinkSync(native, junction, 'junction');
    assert.equal(fs.lstatSync(junction).isSymbolicLink(), true, 'fixture must exercise a real Windows reparse point');
    await rejectNativeProvider(junction);
    assert.equal(fs.existsSync(junction), true, 'rejection leaves caller-owned junction cleanup to its owner');
    for (const name of nativeNames) assert.deepEqual(fs.readFileSync(path.join(native, name)), fs.readFileSync(path.join(nativePair, name)));
  });
  test('native staging validates directory and file owners and rejects an untrusted explicit ACL', { timeout: 20000 }, t => {
    const { directory, native } = providerFixture(t), stage = path.join(directory, 'controlled-stage'); fs.mkdirSync(stage);
    // Keep the objects independent: replacing the directory ACL must not
    // propagate into the file before its own owner/ACL assertions begin.
    const image = path.join(directory, 'inert-image.bin'); fs.writeFileSync(image, 'owned inert fixture');
    const source = path.join(__dirname, '../src/elevated-console.cs');
    const digest = createHash('sha256').update(fs.readFileSync(source)).digest('hex');
    const production = bootstrap(source, digest, 'local:cmd');
    const beforeBroker = production.indexOf('[NerdSSHell.ElevatedConsole]::Broker(');
    assert.ok(beforeBroker > 0);
    const literal = value => "'" + value.replaceAll("'", "''") + "'";
    // Compile the exact hash-checked source, then exercise only its read-only
    // validation on objects created by this fixture. No broker/UAC/image load.
    const harness = production.slice(0, beforeBroker) + String.raw`
$binding = [Reflection.BindingFlags]'Static,NonPublic'
$type = [NerdSSHell.ElevatedConsole]
$open = $type.GetMethod('OpenDiskPath',$binding)
$validate = $type.GetMethod('ValidateProtectedDirectory',$binding)
$close = $type.GetMethod('CloseHandle',$binding)
[void]$type.GetMethod('ValidateNativePair',$binding).Invoke($null,@(${literal(native)}))
[Console]::WriteLine('CANONICAL_NATIVE_PAIR_ACCEPTED')
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
try { $sid = $identity.User } finally { $identity.Dispose() }
$targets = @{ DIRECTORY=${literal(stage)}; FILE=${literal(image)} }
foreach ($label in @('DIRECTORY','FILE')) {
  $isDirectory = $label -eq 'DIRECTORY'
  $acl = if ($isDirectory) { [Security.AccessControl.DirectorySecurity]::new() } else { [Security.AccessControl.FileSecurity]::new() }
  $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false)
  foreach ($allowed in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($allowed,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.AccessControlType]::Allow))
  }
  if ($isDirectory) { [IO.Directory]::SetAccessControl($targets[$label],$acl) } else { [IO.File]::SetAccessControl($targets[$label],$acl) }
  $handle = [IntPtr]$open.Invoke($null,@($targets[$label],$isDirectory,[uint32]0x20080,[uint32]3))
  try {
    [void]$validate.Invoke($null,@($handle,$false,$sid.Value,$true))
    [Console]::WriteLine('FIXTURE_STAGE_ACCEPTED:'+$label)
    try {
      [void]$validate.Invoke($null,@($handle,$false,$null,$true))
      throw 'Expected production owner rejection'
    } catch {
      if ($_.Exception.GetBaseException().Message -ne 'Native staging owner or protected ACL rejected') { throw }
      [Console]::WriteLine('USER_OWNER_REJECTED:'+$label)
    }
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'),[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.AccessControlType]::Allow))
    if ($isDirectory) { [IO.Directory]::SetAccessControl($targets[$label],$acl) } else { [IO.File]::SetAccessControl($targets[$label],$acl) }
    try {
      [void]$validate.Invoke($null,@($handle,$false,$sid.Value,$true))
      throw 'Expected untrusted ACL rejection'
    } catch {
      if ($_.Exception.GetBaseException().Message -ne 'Native staging permits untrusted changes') { throw }
      [Console]::WriteLine('UNTRUSTED_ACL_REJECTED:'+$label)
    }
  } finally { [void]$close.Invoke($null,@($handle)) }
}`;
    const executable = require('../src/local-remote.cjs').installedShells().find(shell => shell.id === 'local:powershell')?.executable;
    const result = spawnSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(harness, 'utf16le').toString('base64')],
      { encoding: 'utf8', timeout: 15000, windowsHide: true, shell: false, maxBuffer: 65536, env: windowsPowerShellEnvironment() });
    assert.equal(result.status, 0, `ACL harness stdout:\n${result.stdout}\nACL harness stderr:\n${result.stderr}\n${result.error?.message || ''}`);
    assert.ok(result.stdout.includes('CANONICAL_NATIVE_PAIR_ACCEPTED'), 'the same canonical fixture factory must pass valid-pair verification before any ACL mutation');
    for (const label of ['DIRECTORY', 'FILE']) for (const marker of ['FIXTURE_STAGE_ACCEPTED', 'USER_OWNER_REJECTED', 'UNTRUSTED_ACL_REJECTED']) assert.ok(result.stdout.includes(marker + ':' + label), result.stdout);
    assert.equal(fs.readFileSync(image, 'utf8'), 'owned inert fixture', 'security validation does not modify the caller-owned image');
    fs.renameSync(image, image + '.closed'); assert.equal(fs.existsSync(image + '.closed'), true, 'validation releases its exact handle');
  });
}

if (process.platform === 'win32') test('native Windows PowerShell bridge uses trusted PSReadLine with SaveNothing after inheriting PowerShell 7 module paths', { timeout: 75000 }, async t => {
  const nativeFixture = createNativeBrokerFixture();
  const { Terminal } = require('@xterm/xterm');
  const terminal = new Terminal({ cols: 120, rows: 36, scrollback: 2000, allowProposedApi: true, windowsPty: { backend: 'conpty' } });
  let render = Promise.resolve(), renderError;
  const replies = [];
  const executable = require('../src/local-remote.cjs').installedShells().find(shell => shell.id === 'local:powershell')?.executable;
  assert.ok(executable, 'Windows PowerShell must be installed for native acceptance');
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const winModules = path.win32.join(path.win32.dirname(executable), 'Modules');
  const sharedWinModules = path.win32.join(programFiles, 'WindowsPowerShell', 'Modules');
  const inheritedModules = [path.win32.join(programFiles, 'PowerShell', '7', 'Modules'), path.win32.join(programFiles, 'PowerShell', 'Modules'), winModules, sharedWinModules].join(';');
  const originalModulePath = process.env.PSModulePath;
  let child, closedPromise, pty, copied, subscription, brokerExit, fixtureFrames, closed = false, output = '', stderr = '', phase = 'launch';
  const diagnostic = () => JSON.stringify({ phase, brokerPid: child?.pid, brokerExit, closed, shellExit: pty?.exitCode,
    automaticReplies: replies, cursor: { x: terminal.buffer.active.cursorX, y: terminal.buffer.active.cursorY }, renderError: renderError?.message,
    raw: output.slice(-4096), stderr: stderr.slice(-1024), fixtureFailure: fixtureFrames?.failure, fixtureFrameError: fixtureFrames?.error });
  const automatic = terminal.onData(data => {
    if (!pty || pty.ended || pty.closing || child.stdin.destroyed || child.stdin.writableEnded) return;
    replies.push(data); if (replies.length > 32) replies.shift();
    pty.write(data); // Only genuine replies produced by the real xterm parser.
  });
  const bounded = async (promise, label, timeout) => {
    phase = label; let timer;
    try {
      return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('timed out')), timeout); })]);
    } catch (error) { throw new Error(`${label}: ${error.message}; ${diagnostic()}`, { cause: error }); }
    finally { clearTimeout(timer); }
  };
  const until = async (label, check, timeout = 10000) => {
    phase = label; const deadline = Date.now() + timeout;
    while (!check() && !closed && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(check(), `${label}: ${diagnostic()}`);
  };
  const drain = async () => {
    await bounded(render, 'native terminal output drain', 5000);
    if (renderError) throw renderError;
  };
  t.after(async () => {
    try {
      pty?.kill();
      if (child && !closed && !child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end();
      if (child && !closed) {
        try { await bounded(closedPromise, 'owned bridge cleanup', 5000); }
        catch {
          if (!closed) child.kill(); // Only the disposable broker and its owned native job.
          await bounded(closedPromise, 'owned bridge cleanup after termination', 5000);
        }
      }
      if (child) {
        assert.equal(closed, true, diagnostic());
        assert.ok([child.stdin, child.stdout, child.stderr].every(stream => stream.destroyed), 'owned native bridge pipes must all close');
      }
      if (copied) assert.equal(fs.existsSync(copied), false, 'owned copied helper is removed');
      await drain();
    } finally { fixtureFrames?.dispose(); subscription?.dispose(); automatic.dispose(); terminal.dispose(); await nativeFixture.dispose(); }
  });
  let launch;
  // spawnElevatedPty constructs its child environment synchronously. Restore
  // this test process before awaiting or letting another test observe the input.
  try {
    process.env.PSModulePath = inheritedModules;
    launch = spawnElevatedPty('local:powershell', { execute: (file, args, options) => {
      assert.equal(file, executable);
      const key = Object.keys(options.env).find(name => name.toLowerCase() === 'psmodulepath');
      assert.equal(options.env[key], [winModules, sharedWinModules].join(';'), 'production broker filters only the fixed PS7 search paths');
      const script = Buffer.from(args[4], 'base64').toString('utf16le');
      assert.match(script, /\[NerdSSHell\.ElevatedConsole\]::Broker\(/);
      copied = /OpenRead\('((?:[^']|'')*)'\)/.exec(script)[1].replaceAll("''", "'");
      assert.deepEqual(fs.readFileSync(copied), fs.readFileSync(path.join(__dirname, '../src/elevated-console.cs')), 'native fixture compiles unchanged protected bootstrap');
      const fixtureArgs = [...args];
      fixtureArgs[4] = Buffer.from(script.replace('[NerdSSHell.ElevatedConsole]::Broker(', '[NerdSSHell.ElevatedConsole]::BrokerFixture('), 'utf16le').toString('base64');
      child = spawn(file, fixtureArgs, { ...options, env: nativeFixture.environment(options.env) });
      fixtureFrames = observeFixtureFrames(child);
      closedPromise = new Promise(resolve => child.once('close', code => { closed = true; brokerExit = code; resolve(code); }));
      child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-2048); });
      return child;
    } });
  } finally {
    if (originalModulePath === undefined) delete process.env.PSModulePath;
    else process.env.PSModulePath = originalModulePath;
  }
  assert.equal(process.env.PSModulePath, originalModulePath, 'parent module search path restored before asynchronous native startup');
  pty = await bounded(launch, 'native Windows PowerShell handshake', 20000);
  subscription = pty.onData(text => {
    output = (output + text).slice(-32768);
    render = render.then(() => new Promise(resolve => terminal.write(text, resolve))).catch(error => { renderError = error; });
  }); pty.resume();
  await bounded(pty.readyForInput(), 'native Windows PowerShell prompt', 21000);
  await drain();
  assert.match(consoleText(output), /PS [^\r\n]*> /, diagnostic());
  terminal.resize(240, 40);
  pty.resize(240, 40);
  pty.write("$m=@(Microsoft.PowerShell.Core\\Get-Module PSReadLine); [Console]::WriteLine(('NATIVE_'+'PS_COUNT=')+$m.Count)\r" +
    "[Console]::WriteLine(('NATIVE_'+'PS_BASE=')+$m[0].ModuleBase)\r" +
    "[Console]::WriteLine(('NATIVE_'+'PS_STYLE=')+(PSReadLine\\Get-PSReadLineOption).HistorySaveStyle)\r" +
    "[Console]::WriteLine(('NATIVE_'+'PS_MAJOR=')+$PSVersionTable.PSVersion.Major)\r");
  await until('native PSReadLine startup state', () => /NATIVE_PS_MAJOR=5\b/.test(consoleText(output)));
  const plain = consoleText(output);
  assert.match(plain, /NATIVE_PS_COUNT=1\b/, diagnostic());
  assert.match(plain, /NATIVE_PS_STYLE=SaveNothing/, diagnostic());
  const base = /NATIVE_PS_BASE=([^\r\n]+)/.exec(plain)?.[1].trim();
  assert.ok(base, diagnostic());
  const normalized = path.win32.normalize(base).toLowerCase();
  assert.ok([winModules, sharedWinModules].some(root => {
    const trusted = path.win32.join(root, 'PSReadLine').toLowerCase();
    return normalized === trusted || normalized.startsWith(trusted + '\\');
  }), `Native PSReadLine must come from a protected Windows PowerShell root: ${base}`);
  const exited = new Promise(resolve => pty.onExit(resolve));
  pty.write('exit 0\r');
  assert.equal((await bounded(exited, 'native Windows PowerShell exit', 5000)).exitCode, 0, diagnostic());
  assert.equal(await bounded(closedPromise, 'native broker stdio close', 5000), 0, diagnostic());
  t.diagnostic(`Native Windows PowerShell inherited PS7 paths: prompt, protected PSReadLine (${base}), SaveNothing and owned cleanup passed`);
});

test('spawn uses one fixed unelevated broker with exact copied bytes and cleans its own source copy', async t => {
  const original = Buffer.from('// fixture 😀\r\n'), sourceFile = sourceFixture(t, original);
  const child = new FakeChild(); let call, copied;
  const pty = await spawnElevatedPty('local:pwsh', { sourceFile, systemRoot: 'C:\\Windows', execute: (...args) => {
    call = args; const script = Buffer.from(args[1][4], 'base64').toString('utf16le');
    copied = /OpenRead\('([^']+)'\)/.exec(script)[1];
    assert.deepEqual(fs.readFileSync(copied), original);
    assert.match(script, new RegExp(createHash('sha256').update(original).digest('hex')));
    queueMicrotask(() => child.stdout.write(response('R'))); return child;
  } });
  t.after(() => child.emit('exit', 0));
  assert.equal(call[0], 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.deepEqual(call[1].slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand']);
  assert.deepEqual(call[2], { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'], env: windowsPowerShellEnvironment() });
  assert.notEqual(copied, sourceFile); pty.finish(); child.emit('exit', 0);
  assert.equal(fs.existsSync(copied), false); assert.equal(fs.existsSync(path.dirname(copied)), false);
  assert.deepEqual(fs.readFileSync(sourceFile), original);
});

test('CMD administrator launch retains framing and cleanup through the fixed PowerShell broker', async t => {
  const sourceFile = sourceFixture(t), child = new FakeChild(); let call;
  const pty = await spawnElevatedPty('local:cmd', { sourceFile, systemRoot: 'C:\\Windows', execute: (...args) => {
    call = args; assert.ok(Buffer.from(args[1][4], 'base64').toString('utf16le').endsWith(",'local:cmd'," + process.pid + ')'));
    queueMicrotask(() => child.stdout.write(response('R'))); return child;
  } });
  t.after(() => child.complete());
  assert.equal(call[0], 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(call[2].shell, false); assert.equal(pty.shellId, 'local:cmd');
  pty.write('echo literal & owned\r'); assert.equal(child.sent.at(-1).subarray(5).toString(), 'echo literal & owned\r');
  pty.finish();
});

test('native spawn failure removes only its temporary copied source and does not retry', async t => {
  const sourceFile = sourceFixture(t); let attempts = 0, copy;
  await assert.rejects(spawnElevatedPty('local:powershell', { sourceFile, execute: (_exe, args) => {
    attempts++; copy = /OpenRead\('([^']+)'\)/.exec(Buffer.from(args[4], 'base64').toString('utf16le'))[1];
    throw Error('synthetic spawn failure');
  } }), /synthetic spawn failure/);
  assert.equal(attempts, 1); assert.equal(fs.existsSync(copy), false); assert.equal(fs.existsSync(path.dirname(copy)), false);
  assert.equal(fs.existsSync(sourceFile), true);
});

test('failure before the source copy is created removes its own empty directory and starts no broker', async t => {
  const sourceFile = sourceFixture(t), mkdir = fs.mkdtempSync, write = fs.writeFileSync;
  let directory, attempts = 0;
  t.mock.method(fs, 'mkdtempSync', prefix => { directory = mkdir(prefix); return directory; });
  t.mock.method(fs, 'writeFileSync', (filename, ...args) => {
    if (path.dirname(filename) === directory) throw Object.assign(Error('synthetic write denied'), { code: 'EACCES' });
    return write(filename, ...args);
  });
  // If the regression fails, remove only this test's captured disposable directory.
  t.after(() => { if (directory) fs.rmSync(directory, { recursive: true, force: true }); });
  await assert.rejects(spawnElevatedPty('local:powershell', { sourceFile, execute: () => { attempts++; throw Error('Unexpected native launch'); } }), /synthetic write denied/);
  assert.equal(attempts, 0); assert.equal(fs.existsSync(directory), false);
  assert.equal(fs.existsSync(sourceFile), true);
});

test('spawn cancellation rejects once and removes the copied helper without touching original source', async t => {
  const sourceFile = sourceFixture(t), child = new FakeChild(); let attempts = 0, copy;
  t.after(() => child.emit('exit', 0));
  await assert.rejects(spawnElevatedPty('local:powershell', { sourceFile, execute: (_exe, args) => {
    attempts++; copy = /OpenRead\('([^']+)'\)/.exec(Buffer.from(args[4], 'base64').toString('utf16le'))[1];
    queueMicrotask(() => child.stdout.write(response('X'))); return child;
  } }), error => error.code === 'NERDSSHELL_UAC_CANCELLED');
  child.emit('exit', 0);
  assert.equal(attempts, 1); assert.equal(fs.existsSync(copy), false); assert.equal(fs.existsSync(path.dirname(copy)), false);
  assert.equal(fs.existsSync(sourceFile), true);
});
