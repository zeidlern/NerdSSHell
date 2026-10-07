'use strict';
// Disposable native bridge smoke. Default mode never requests elevation.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');
const { NATIVE_HASHES } = require('../src/local-remote.cjs');
const nativeNames = ['conpty.dll', 'OpenConsole.exe'];

if (process.platform !== 'win32') throw new Error('Windows is required');
const args = process.argv.slice(2);
const elevated = args.includes('--uac');
let nativeFixture;
const asarAt = args.indexOf('--asar');
const sourceAt = args.indexOf('--source');
if (asarAt >= 0 && sourceAt >= 0) throw new Error('Choose --asar or --source');
let source = sourceAt >= 0 ? path.resolve(args[sourceAt + 1]) : path.resolve(__dirname, '../src/elevated-console.cs');
let bridgeModule = path.resolve(__dirname, '../src/elevated-pty.cjs');
let xtermModule = require.resolve('@xterm/xterm');
let nativeDirectory = path.join(path.dirname(require.resolve('node-pty/package.json')), 'prebuilds', 'win32-x64', 'conpty');
let tempDir, bytes, digest;
try {
if (asarAt >= 0) {
  const asar = require('@electron/asar');
  const archive = path.resolve(args[asarAt + 1]);
  const archived = asar.extractFile(archive, 'src/elevated-console.cs');
  tempDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'betterssh-admin-smoke-')));
  source = path.join(tempDir, 'elevated-console.cs');
  fs.writeFileSync(source, archived, { flag: 'wx', mode: 0o600 });
  bridgeModule = path.join(tempDir, 'elevated-pty.cjs');
  fs.writeFileSync(bridgeModule, asar.extractFile(archive, 'src/elevated-pty.cjs'), { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(path.join(tempDir, 'console-text.cjs'), asar.extractFile(archive, 'src/console-text.cjs'), { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(path.join(tempDir, 'powershell-environment.cjs'), asar.extractFile(archive, 'src/powershell-environment.cjs'), { flag: 'wx', mode: 0o600 });
  xtermModule = path.join(tempDir, 'xterm.cjs');
  fs.writeFileSync(xtermModule, asar.extractFile(archive, path.join('node_modules', '@xterm', 'xterm', 'lib', 'xterm.js')), { flag: 'wx', mode: 0o600 });
  assert.equal(JSON.parse(asar.extractFile(archive, path.join('node_modules', '@xterm', 'xterm', 'package.json'))).version, '6.0.0', 'packaged xterm version');
  nativeDirectory = path.join(tempDir, 'native');
  fs.mkdirSync(nativeDirectory, { mode: 0o700 });
  for (const name of nativeNames) {
    fs.writeFileSync(path.join(nativeDirectory, name), asar.extractFile(archive,
      path.join('node_modules', 'node-pty', 'prebuilds', 'win32-x64', 'conpty', name)), { flag: 'wx', mode: 0o600 });
  }
}
nativeDirectory = fs.realpathSync.native(nativeDirectory);
for (const name of nativeNames) {
  const file = path.join(nativeDirectory, name);
  assert.ok(fs.lstatSync(file).isFile(), 'provider source must be a regular file: ' + name);
  assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'), NATIVE_HASHES['conpty/' + name], 'exact packaged provider bytes: ' + name);
}
bytes = fs.readFileSync(source);
assert.ok(bytes.length <= 131072 && bytes.length > 0, 'helper source size');
digest = createHash('sha256').update(bytes).digest('hex');
} catch (error) { cleanupArtifacts(); throw error; }
try { nativeFixture = elevated ? null : require('./lib/native-broker-fixture.cjs').createNativeBrokerFixture(); }
catch (error) { cleanupArtifacts(); throw error; }
const systemRoot = process.env.SystemRoot || 'C:\\Windows';
const windowsPowerShell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const pwsh7 = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe');
const ps5ModuleRoot = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'WindowsPowerShell', 'Modules', 'PSReadLine');
const moduleRoot = shell => shell === 'local:powershell'
  ? [path.join(path.dirname(windowsPowerShell), 'Modules', 'PSReadLine'), ps5ModuleRoot]
  : [path.join(path.dirname(pwsh7), 'Modules', 'PSReadLine')];
function hasProtectedManifest(shell) {
  for (const root of moduleRoot(shell)) {
    if (fs.existsSync(path.join(root, 'PSReadLine.psd1'))) return true;
    if (shell === 'local:powershell' && fs.existsSync(root)) {
      for (const name of fs.readdirSync(root).slice(0, 33)) {
        if (/^\d+\.\d+(\.\d+){0,2}$/.test(name) && fs.existsSync(path.join(root, name, 'PSReadLine.psd1'))) return true;
      }
    }
  }
  return false;
}
function insideProtectedRoot(actual, roots) {
  const value = path.win32.normalize(actual).toLowerCase();
  return roots.some(root => {
    const expected = path.win32.normalize(root).toLowerCase();
    return value === expected || value.startsWith(expected + path.win32.sep);
  });
}
const { bootstrap } = require(bridgeModule);
const { consoleText } = require(path.join(path.dirname(bridgeModule), 'console-text.cjs'));
const { windowsPowerShellEnvironment } = require(path.join(path.dirname(bridgeModule), 'powershell-environment.cjs'));
const { Terminal } = require(xtermModule);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

class Bridge {
  constructor(shell, { helperSource = source, helperDigest = digest, onOutput = () => {}, renderTerminal = true } = {}) {
    this.shell = shell;
    const production = bootstrap(helperSource, helperDigest, shell, nativeDirectory);
    assert.ok(production.includes('[BetterSSH.ElevatedConsole]::Broker('), 'packaged bridge bootstrap');
    const script = elevated ? production : production.replace('[BetterSSH.ElevatedConsole]::Broker(', '[BetterSSH.ElevatedConsole]::BrokerFixture(');
    this.child = spawn(windowsPowerShell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: nativeFixture ? nativeFixture.environment(windowsPowerShellEnvironment()) : windowsPowerShellEnvironment() });
    this.child.stdin.on('error', () => {}); // EOF/close races are asserted through process exit.
    this.frames = [];
    this.waiters = [];
    this.buffer = Buffer.alloc(0);
    this.output = '';
    this.decoder = new StringDecoder('utf8');
    this.stderr = '';
    this.exit = null;
    this.render = Promise.resolve();
    this.automaticReplies = [];
    this.terminal = renderTerminal ? new Terminal({ cols: 120, rows: 36, scrollback: 2000,
      allowProposedApi: true, windowsPty: { backend: 'conpty' } }) : null;
    this.automatic = this.terminal?.onData(data => {
      if (this.exit !== null || this.child.stdin.destroyed || this.child.stdin.writableEnded) return;
      this.automaticReplies.push(data); if (this.automaticReplies.length > 32) this.automaticReplies.shift();
      this.send('I', Buffer.from(data, 'utf8'));
    });
    const output = text => {
      this.output += text; onOutput(text);
      if (text && this.terminal) this.render = this.render.then(() => new Promise(resolve => this.terminal.write(text, resolve)))
        .catch(error => { this.renderError = error; });
    };
    this.child.stdout.on('data', chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      while (this.buffer.length >= 5) {
        const length = this.buffer.readUInt32LE(1);
        if (length > 65536) throw new Error('Oversized helper frame');
        if (this.buffer.length < 5 + length) break;
        const frame = { type: String.fromCharCode(this.buffer[0]), data: this.buffer.subarray(5, 5 + length) };
        this.buffer = this.buffer.subarray(5 + length);
        this.frames.push(frame);
        if (frame.type === 'D') {
          output(this.decoder.write(frame.data));
        }
        for (const wake of this.waiters.splice(0)) wake();
      }
    });
    this.child.stderr.on('data', chunk => { this.stderr += chunk.toString(); });
    this.closed = new Promise(resolve => this.child.once('close', code => { output(this.decoder.end()); this.exit = code; for (const wake of this.waiters.splice(0)) wake(); resolve(code); }));
  }
  get plain() { return consoleText(this.output); }
  diagnostic() {
    const control = this.frames.filter(frame => frame.type !== 'D').slice(-8).map(frame => ({
      type: frame.type,
      value: frame.type === 'E' && frame.data.length === 4 ? frame.data.readInt32LE(0) : frame.data.toString('utf8').slice(-512)
    }));
    return JSON.stringify({ shell: this.shell, brokerExit: this.exit, control, automaticReplies: this.automaticReplies,
      renderError: this.renderError?.message, raw: this.output.slice(-4096), stderr: this.stderr.slice(-1024) });
  }
  send(type, data = Buffer.alloc(0)) {
    assert.ok(data.length <= 65536);
    if (type === 'S' && this.terminal) {
      assert.equal(data.length, 4);
      this.terminal.resize(data.readUInt16LE(0), data.readUInt16LE(2));
    }
    const header = Buffer.alloc(5);
    header[0] = type.charCodeAt(0);
    header.writeUInt32LE(data.length, 1);
    this.child.stdin.write(Buffer.concat([header, data]));
  }
  async until(check, label, timeout = 180000) {
    const deadline = Date.now() + timeout;
    while (!check()) {
      if (this.renderError) throw new Error(`${label}: terminal rendering failed; ${this.diagnostic()}`, { cause: this.renderError });
      if (this.exit !== null) throw new Error(`${label}: broker exited ${this.exit}; ${this.diagnostic()}`);
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`${label}: timed out; ${this.diagnostic()}`);
      await Promise.race([new Promise(resolve => this.waiters.push(resolve)), delay(Math.min(left, 1000))]);
    }
  }
  async ready() {
    await this.until(() => this.frames.some(f => f.type === 'R' || f.type === 'F' || f.type === 'X'), 'ready');
    const terminal = this.frames.find(f => ['R', 'F', 'X'].includes(f.type));
    if (terminal.type === 'F') throw new Error(`helper failed: ${this.diagnostic()}`);
    return terminal.type;
  }
  async outputContains(text) { await this.until(() => this.plain.includes(text), `output ${text}`, 15000); }
  async exitFrame() {
    await this.until(() => this.frames.some(f => f.type === 'E'), 'exit frame', 15000);
    return this.frames.find(f => f.type === 'E').data.readInt32LE(0);
  }
  async waitClosed(timeout = 10000) {
    let timer;
    try {
      return await Promise.race([this.closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('broker exit timed out; ' + this.diagnostic())), timeout); })]);
    } finally { clearTimeout(timer); }
  }
  async drain() {
    let timer;
    try {
      await Promise.race([this.render, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('terminal output drain timed out; ' + this.diagnostic())), 5000); })]);
      if (this.renderError) throw this.renderError;
    } finally { clearTimeout(timer); }
  }
  async stop() {
    try {
    if (this.exit === null) {
      if (!this.child.stdin.destroyed && !this.child.stdin.writableEnded) {
        try { this.send('C'); } catch { }
      }
      await Promise.race([this.closed, delay(5000)]);
      if (this.exit === null) this.child.kill();
      await this.waitClosed(5000);
    }
    if (this.nativeStage) {
      const deadline = Date.now() + 5000;
      while (fs.existsSync(this.nativeStage) && Date.now() < deadline) await delay(25);
      assert.equal(fs.existsSync(this.nativeStage), false, 'the owned provider stage must be removed after native shutdown: ' + this.nativeStage);
    }
    await this.drain();
    } finally { this.automatic?.dispose(); this.terminal?.dispose(); }
  }
}

async function observeNativeProvider(bridge) {
  assert.equal(elevated, false, 'provider observation never requests UAC');
  assert.ok(Number.isInteger(bridge.child.pid) && bridge.child.pid > 0, 'owned broker PID');
  // Inspect only the live owned broker's direct helper and that helper's direct
  // children. Hold their process handles to exclude PID reuse while observing.
  // An asynchronous observer leaves bridge output and xterm replies draining.
  const script = String.raw`$ErrorActionPreference='Stop'
$held = [Collections.Generic.List[Diagnostics.Process]]::new()
try {
  Microsoft.PowerShell.Core\Import-Module -Name ([IO.Path]::Combine($PSHOME,'Modules','CimCmdlets','CimCmdlets.psd1')) -ErrorAction Stop
  Microsoft.PowerShell.Core\Import-Module -Name ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Utility','Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
  Microsoft.PowerShell.Utility\Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NerdSSHellProviderObservation {
  [DllImport("advapi32.dll", SetLastError=true)] public static extern bool OpenProcessToken(IntPtr process, uint desired, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError=true)] public static extern bool GetTokenInformation(IntPtr token, int kind, out int value, int size, out int returned);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr handle);
}
'@
  $broker = [Diagnostics.Process]::GetProcessById(${bridge.child.pid})
  $held.Add($broker); [void]$broker.Handle
  if ($broker.HasExited) { throw 'Owned broker exited before observation' }
  $fixedPowerShell = [IO.Path]::Combine($PSHOME,'powershell.exe')
  $helpers = [Collections.Generic.List[Diagnostics.Process]]::new()
  foreach ($entry in @(CimCmdlets\Get-CimInstance -ClassName Win32_Process -Filter ('ParentProcessId=' + $broker.Id) -Property ProcessId,ParentProcessId)) {
    $candidate = [Diagnostics.Process]::GetProcessById([int]$entry.ProcessId)
    $held.Add($candidate); [void]$candidate.Handle
    if (![string]::Equals($candidate.MainModule.FileName,$fixedPowerShell,[StringComparison]::OrdinalIgnoreCase)) { continue }
    if ($candidate.HasExited -or $candidate.StartTime -lt $broker.StartTime) { throw 'Owned helper identity changed' }
    $helpers.Add($candidate)
  }
  if ($helpers.Count -ne 1) { throw 'Expected exactly one owned PowerShell helper' }
  $helper = $helpers[0]; $helper.Refresh()
  $libraries = [Collections.Generic.List[string]]::new()
  foreach ($module in $helper.Modules) {
    if ([string]::Equals($module.ModuleName,'conpty.dll',[StringComparison]::OrdinalIgnoreCase)) { $libraries.Add($module.FileName) }
  }
  if ($libraries.Count -ne 1) { throw 'Expected one loaded bundled ConPTY library' }
  $expectedHost = [IO.Path]::Combine([IO.Path]::GetDirectoryName($libraries[0]),'OpenConsole.exe')
  $hosts = [Collections.Generic.List[Diagnostics.Process]]::new()
  foreach ($entry in @(CimCmdlets\Get-CimInstance -ClassName Win32_Process -Filter ('ParentProcessId=' + $helper.Id) -Property ProcessId,ParentProcessId)) {
    $candidate = [Diagnostics.Process]::GetProcessById([int]$entry.ProcessId)
    $held.Add($candidate); [void]$candidate.Handle
    if (![string]::Equals($candidate.MainModule.FileName,$expectedHost,[StringComparison]::OrdinalIgnoreCase)) { continue }
    if ($candidate.HasExited -or $candidate.StartTime -lt $helper.StartTime) { throw 'Owned console host identity changed' }
    $hosts.Add($candidate)
  }
  if ($hosts.Count -ne 1) { throw 'Expected exactly one matching owned OpenConsole process' }
  $token = [IntPtr]::Zero
  try {
    if (![NerdSSHellProviderObservation]::OpenProcessToken($helper.Handle,8,[ref]$token)) { throw 'Cannot query owned helper token' }
    [int]$elevation = 0; [int]$returned = 0
    if (![NerdSSHellProviderObservation]::GetTokenInformation($token,20,[ref]$elevation,4,[ref]$returned) -or $returned -ne 4) { throw 'Cannot read owned helper elevation' }
  } finally { if ($token -ne [IntPtr]::Zero) { [void][NerdSSHellProviderObservation]::CloseHandle($token) } }
  $stage = [IO.Path]::GetDirectoryName($libraries[0])
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  try { [Console]::WriteLine('PROVIDER_USER:' + $identity.User.Value) } finally { $identity.Dispose() }
  [Console]::WriteLine('PROVIDER_ELEVATED:' + ($elevation -ne 0))
  $aclPaths = @{ DIRECTORY=$stage; DLL=$libraries[0]; HOST=$hosts[0].MainModule.FileName }
  foreach ($label in @('DIRECTORY','DLL','HOST')) {
    $acl = if ($label -eq 'DIRECTORY') { [IO.Directory]::GetAccessControl($aclPaths[$label]) } else { [IO.File]::GetAccessControl($aclPaths[$label]) }
    [Console]::WriteLine('PROVIDER_' + $label + '_OWNER:' + $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value)
    [Console]::WriteLine('PROVIDER_' + $label + '_DACL_PROTECTED:' + $acl.AreAccessRulesProtected)
    foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
      [Console]::WriteLine('PROVIDER_' + $label + '_ACE:' + $rule.IdentityReference.Value + '|' + $rule.AccessControlType + '|' + $rule.IsInherited + '|' + [int]$rule.FileSystemRights + '|' + [int]$rule.InheritanceFlags + '|' + [int]$rule.PropagationFlags)
    }
  }
  if ($broker.HasExited -or $helper.HasExited -or $hosts[0].HasExited) { throw 'Owned provider exited during observation' }
  [Console]::WriteLine('PROVIDER_HELPER:' + $helper.Id)
  [Console]::WriteLine('PROVIDER_HOST_PID:' + $hosts[0].Id)
  [Console]::WriteLine('PROVIDER_DLL:' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($libraries[0])))
  [Console]::WriteLine('PROVIDER_HOST:' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($hosts[0].MainModule.FileName)))
} finally { foreach ($process in $held) { $process.Dispose() } }`;
  const result = await new Promise((resolve, reject) => {
    const child = spawn(windowsPowerShell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false, env: windowsPowerShellEnvironment() });
    let stdout = '', stderr = '', failure, settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const stop = error => { failure ||= error; child.kill(); finish(Error(`Native provider observation failed: ${failure.message}; ${stderr}; ${bridge.diagnostic()}`)); };
    const timer = setTimeout(() => stop(Error('provider observer timed out')), 15000);
    child.stdout.on('data', data => { if (failure) return; stdout += data.toString('utf8'); if (Buffer.byteLength(stdout) > 16384) { stdout = stdout.slice(0, 16384); stop(Error('provider observation exceeded its output bound')); } });
    child.stderr.on('data', data => { stderr = (stderr + data.toString('utf8')).slice(-2048); });
    child.once('error', error => { failure ||= error; finish(error); });
    child.once('close', code => {
      if (failure || code !== 0) finish(Error(`Native provider observation failed: ${failure?.message || 'exit ' + code}; ${stderr}; ${bridge.diagnostic()}`));
      else finish(null, stdout);
    });
  });
  const field = key => {
    const matches = [...result.matchAll(new RegExp('^' + key + ':([^\\r\\n]+)', 'gm'))];
    assert.equal(matches.length, 1, 'one provider observation field: ' + key);
    return matches[0][1];
  };
  const dll = Buffer.from(field('PROVIDER_DLL'), 'base64').toString('utf8');
  const host = Buffer.from(field('PROVIDER_HOST'), 'base64').toString('utf8');
  const staged = path.dirname(dll);
  const helperElevated = field('PROVIDER_ELEVATED');
  assert.ok(['True', 'False'].includes(helperElevated), 'actual helper TokenElevation');
  const expectedOwner = helperElevated === 'True' ? 'S-1-5-32-544' : field('PROVIDER_USER');
  for (const label of ['DIRECTORY', 'DLL', 'HOST']) {
    assert.equal(field('PROVIDER_' + label + '_OWNER'), expectedOwner, label + ': owner matches the actual helper token branch');
    assert.equal(field('PROVIDER_' + label + '_DACL_PROTECTED'), 'True', label + ': DACL must disable inherited access');
    const rules = [...result.matchAll(new RegExp('^PROVIDER_' + label + '_ACE:([^\\r\\n]+)', 'gm'))].map(match => match[1].split('|'));
    assert.deepEqual(rules.map(rule => rule[0]).sort(), [expectedOwner, 'S-1-5-18'].sort(), label + ': access permits only the expected owner and SYSTEM');
    for (const rule of rules) {
      assert.deepEqual(rule.slice(1, 4), ['Allow', 'False', '2032127'], label + ': explicit full-control access');
      assert.equal(rule[5], '0', label + ': access applies to the owned object itself');
      assert.equal(rule[4], '0', label + ': each object has its own explicit descriptor');
    }
  }
  assert.match(path.basename(staged), /^NerdSSHell-ConPTY-[0-9a-f]{32}$/i, 'fresh owned provider staging directory');
  const expectedRoot = helperElevated === 'True' ? process.env.ProgramFiles || 'C:\\Program Files' : nativeFixture.directory;
  assert.equal(path.win32.normalize(path.dirname(staged)).toLowerCase(), path.win32.normalize(expectedRoot).toLowerCase(), 'provider stage uses the root for its actual helper token branch');
  assert.equal(path.win32.normalize(host).toLowerCase(), path.win32.join(staged, 'OpenConsole.exe').toLowerCase(), 'loaded DLL and actual OpenConsole use the same owned directory');
  assert.equal(fs.lstatSync(staged).isSymbolicLink(), false, 'observed provider stage is not a link');
  for (const [name, file] of [['conpty.dll', dll], ['OpenConsole.exe', host]]) {
    assert.equal(fs.lstatSync(file).isFile(), true, 'observed provider is a regular file');
    assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'), NATIVE_HASHES['conpty/' + name], 'actual loaded provider backing file: ' + name);
  }
  bridge.nativeStage = staged;
  console.log(bridge.shell + ': observed owned helper ' + field('PROVIDER_HELPER') + ', OpenConsole ' + field('PROVIDER_HOST_PID') + ', matching native hashes and protected ' + (helperElevated === 'True' ? 'BA/SY production' : 'current-user/SY fixture') + ' stage');
}

function guardDiagnosticSource(original) {
  const matches = [...original.matchAll(/const string syntax = @"((?:[^"]|"")*)";/g)];
  assert.equal(matches.length, 1, 'one embedded PowerShell bootstrap to instrument');
  const match = matches[0], syntax = match[1].replaceAll('""', '"');
  assert.ok(/^& \{\r?\n/.test(syntax), 'fixed bootstrap script scope');
  const guards = [];
  const marked = syntax.replace(/\bexit 2\b/g, (statement, offset) => {
    const id = 'NERDSSH_PS_GUARD_' + String(guards.length + 1).padStart(2, '0');
    const lineStart = syntax.lastIndexOf('\n', offset) + 1;
    guards.push({ id, guard: syntax.slice(lineStart, offset + statement.length).trim().slice(-200) });
    return `__NerdSShellSmokeGuard '${id}' $_; ${statement}`;
  });
  assert.ok(guards.length > 0 && guards.length <= 32, 'bounded existing bootstrap exit guards');
  // Use only .NET output/string operations and the already-used Core command.
  // Utility autoload itself may be the failure being diagnosed in this process.
  const trace = String.raw`
            function __NerdSShellSmokeGuard {
              param([string]$guard, $failure)
              [Console]::WriteLine($guard)
              try {
                $details = [Text.StringBuilder]::new()
                $pairs = @(
                  @('selectedModule', [string]$bettersshModule, 512),
                  @('PSModulePath', [string]$env:PSModulePath, 1024),
                  @('error', [string]$failure.Exception.Message, 512),
                  @('PSVersion', [string]$PSVersionTable.PSVersion, 32),
                  @('PSHOME', [string]$PSHOME, 256)
                )
                $modules = @(Microsoft.PowerShell.Core\Get-Module PSReadLine)
                [void]$details.Append('loadedCount=' + $modules.Count + '; ')
                foreach ($module in $modules) {
                  $pairs += @(@('loadedPath', [string]$module.Path, 512), @('loadedVersion', [string]$module.Version, 32), @('loadedBase', [string]$module.ModuleBase, 256), @('loadedType', [string]$module.ModuleType, 32))
                  if ($pairs.Count -ge 13) { break }
                }
                foreach ($pair in $pairs) {
                  $value = [string]$pair[1]
                  [void]$details.Append($pair[0] + '=' + $value.Substring(0, [Math]::Min($value.Length, [int]$pair[2])) + '; ')
                }
                [Console]::WriteLine($guard + ' ' + $details.ToString().Substring(0, [Math]::Min($details.Length, 3500)))
              } catch {
                $message = [string]$_.Exception.Message
                [Console]::WriteLine($guard + ' snapshot-error=' + $message.Substring(0, [Math]::Min($message.Length, 512)))
              }
            }
`;
  const instrumented = marked.replace(/^& \{\r?\n/, start => start + trace).replaceAll('"', '""');
  const replacement = 'const string syntax = @"' + instrumented + '";';
  const text = original.slice(0, match.index) + replacement + original.slice(match.index + match[0].length);
  return { bytes: Buffer.from(text, 'utf8'), guards };
}

async function probePowerShellGuards(shell) {
  assert.equal(elevated, false, 'diagnostic clones never request UAC');
  let directory, probe;
  try {
    const diagnostic = guardDiagnosticSource(bytes.toString('utf8'));
    assert.ok(diagnostic.bytes.length > 0 && diagnostic.bytes.length <= 131072, 'diagnostic helper source size');
    directory = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'betterssh-guard-smoke-')));
    const helperSource = path.join(directory, 'elevated-console.cs');
    fs.writeFileSync(helperSource, diagnostic.bytes, { flag: 'wx', mode: 0o600 });
    const helperDigest = createHash('sha256').update(diagnostic.bytes).digest('hex');
    console.error('PowerShell failure-only guard probe; original packaged failure is retained. ' + JSON.stringify(diagnostic.guards));
    probe = new Bridge(shell, { helperSource, helperDigest });
    await probe.until(() => probe.exit !== null || probe.frames.some(frame => ['E', 'F', 'X'].includes(frame.type)) || /PS [^\r\n]*>/.test(probe.plain), 'PowerShell guard probe', 15000);
    if (probe.frames.some(frame => ['E', 'F', 'X'].includes(frame.type))) await probe.waitClosed(5000);
  } catch (error) {
    console.error('PowerShell guard probe diagnostic failure: ' + String(error.message).slice(-6144));
  } finally {
    if (probe) {
      try { await probe.stop(); } catch (error) { console.error('Guard probe cleanup: ' + String(error.message).slice(-512)); }
      console.error('PowerShell guard probe result: ' + probe.diagnostic());
    }
    if (directory) {
      try { fs.unlinkSync(path.join(directory, 'elevated-console.cs')); fs.rmdirSync(directory); }
      catch (error) { console.error('Guard probe file cleanup: ' + String(error.message).slice(-512)); }
    }
  }
}


// No-UAC bundled-ConPTY gate for the terminal.resize operation used by plain
// FitAddon fitting. Real DOM measurement remains covered by the packaged UI.
async function packagedConptyResizeSmoke(shell) {
  assert.equal(elevated, false, 'native resize fixture never requests UAC');
  const terminal = new Terminal({ cols: 120, rows: 36, scrollback: 2000,
    allowProposedApi: true, windowsPty: { backend: 'conpty' } });
  let render = Promise.resolve(), renderError, phase = 'startup';
  const replies = [];
  const bridge = new Bridge(shell, { renderTerminal: false, onOutput: text => {
    if (!text) return;
    render = render.then(() => new Promise(resolve => terminal.write(text, resolve)))
      .catch(error => { renderError = error; });
  } });
  // Forward only replies produced by xterm itself. No query, predicted cursor
  // position, synthesized CPR, terminal reset or PSReadLine option is injected.
  const automatic = terminal.onData(data => {
    if (bridge.exit !== null || bridge.child.stdin.destroyed || bridge.child.stdin.writableEnded) return;
    replies.push(data); if (replies.length > 32) replies.shift();
    bridge.send('I', Buffer.from(data, 'utf8'));
  });
  const currentLine = () => {
    const buffer = terminal.buffer.active;
    return buffer.getLine(buffer.baseY + buffer.cursorY)?.translateToString(true) || '';
  };
  const text = () => {
    const buffer = terminal.buffer.active;
    return Array.from({ length: buffer.length }, (_, row) => buffer.getLine(row)?.translateToString(true) || '').join('\n');
  };
  const diagnostic = () => {
    const buffer = terminal.buffer.active;
    return JSON.stringify({ phase, shell, cols: terminal.cols, rows: terminal.rows,
      baseY: buffer.baseY, cursorY: buffer.cursorY, cursorX: buffer.cursorX,
      cursorLine: currentLine(), screen: Array.from({ length: terminal.rows }, (_, row) =>
        ({ row, text: buffer.getLine(buffer.baseY + row)?.translateToString(true) || '' })),
      automaticReplies: replies, bridge: JSON.parse(bridge.diagnostic()) });
  };
  const bounded = async (promise, label, timeout) => {
    phase = label; let timer;
    try {
      return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label + ': timed out')), timeout); })]);
    } finally { clearTimeout(timer); }
  };
  const drain = async () => {
    await bounded(render, 'xterm output drain', 5000);
    if (renderError) throw renderError;
  };
  const until = async (check, label, timeout = 15000) => {
    const deadline = Date.now() + timeout;
    do {
      await drain(); phase = label;
      if (check()) return;
      if (bridge.exit !== null) break;
      await delay(25);
    } while (Date.now() < deadline);
    throw Error(label + ': ' + diagnostic());
  };
  const prompt = () => /^PS .*?>\s*$/.test(currentLine());
  const input = value => bridge.send('I', Buffer.from(value, 'utf8'));
  const plainFit = async cols => {
    await drain();
    terminal.resize(cols, 36);
    const size = Buffer.alloc(4); size.writeUInt16LE(cols, 0); size.writeUInt16LE(36, 2);
    bridge.send('S', size);
    await delay(300); // Same bounded layout-settle interval as packaged UI acceptance.
    await drain();
  };
  const suffix = shell === 'local:pwsh' ? 'PWSH' : 'WINDOWS';
  try {
    assert.equal(await bounded(bridge.ready(), 'system bridge ready', 20000), 'R');
    await until(prompt, 'system PowerShell prompt');
    input("1..48 | ForEach-Object { [Console]::WriteLine(('SYSTEM_HISTORY_{0:D2}_' -f $_)+('x'*90)) }; Write-Output ('SYSTEM_UNICODE_'+'é漢字😀'); Write-Output ('SYSTEM_'+'SEEDED')\r");
    await until(() => text().includes('SYSTEM_SEEDED') && prompt(), 'system wrapped scrollback');
    assert.ok(terminal.buffer.active.baseY > 0, 'fixture must contain scrollback before resize');
    for (let cycle = 0; cycle < 3; cycle++) {
      await plainFit(60); await plainFit(120);
      phase = 'cycle ' + (cycle + 1) + ' before input';
      assert.ok(prompt(), 'resize must retain the current displayed prompt: ' + diagnostic());
      const command = `Write-Output ('SYSTEM_CYCLE_' + '${suffix}_${cycle}')`;
      const marker = `SYSTEM_CYCLE_${suffix}_${cycle}`;
      input(command);
      await until(() => currentLine().includes(command) || text().includes(command), 'fresh editing displayed');
      phase = 'cycle ' + (cycle + 1) + ' before Enter';
      assert.match(currentLine(), /^PS .*?> Write-Output /, 'fresh editing must stay on its prompt row: ' + diagnostic());
      assert.ok(!text().includes(marker), 'fixture command must not execute before Enter');
      input('\r');
      await until(() => text().includes(marker) && prompt(), 'cycle command and fresh prompt');
      assert.ok(text().includes('SYSTEM_UNICODE_é漢字😀'), 'resize must preserve Unicode scrollback');
      assert.equal(bridge.exit, null, 'resizing must preserve the same owned console');
    }
    input(`Write-Output ('SYSTEM_TAIL_'+'${suffix}'); exit 7\r`);
    assert.equal(await bridge.exitFrame(), 7);
    assert.equal(await bridge.waitClosed(), 0); await drain();
    assert.ok(text().includes('SYSTEM_TAIL_' + suffix), 'system bridge final output drains through real xterm');
    console.log(shell + ': bundled ConPTY with exact packaged xterm: three plain-fit editing cycles, Unicode and final tail passed');
  } catch (error) {
    console.error('Bundled ConPTY resize failure: ' + diagnostic()); throw error;
  } finally {
    try { await bridge.stop(); await drain(); }
    finally { automatic.dispose(); terminal.dispose(); }
  }
}

async function main() {
  const cmd = new Bridge('local:cmd');
  try {
    const state = await cmd.ready();
    if (state === 'X') { console.log('local:cmd: UAC cancelled'); assert.ok(elevated); return; }
    await cmd.until(() => /(?:^|[\r\n])[A-Za-z]:\\[^\r\n]*>\s*$/.test(cmd.plain), 'Command Prompt prompt', 15000);
    if (!elevated) await observeNativeProvider(cmd);
    await cmd.drain();
    cmd.send('S', Buffer.from([100, 0, 30, 0]));
    cmd.send('I', Buffer.from('set "NERDSSH_CMD_VALUE=one"\recho CMD_VALUE_%NERDSSH_CMD_VALUE%\rset "NERDSSH_CMD_QUOTED=two & three é漢字😀"\recho "CMD_QUOTED_%NERDSSH_CMD_QUOTED%"\recho CMD_CARET_^\rCONTINUED\rfor %i in (1 2) do (\recho CMD_LOOP_%i\r)\r', 'utf8'));
    for (const marker of ['CMD_VALUE_one', 'CMD_QUOTED_two & three é漢字😀', 'CMD_CARET_CONTINUED', 'CMD_LOOP_1', 'CMD_LOOP_2']) await cmd.outputContains(marker);
    cmd.send('I', Buffer.from('mode con\r'));
    await cmd.until(() => /Columns:\s+100/.test(cmd.plain) && /Lines:\s+30/.test(cmd.plain), 'CMD dimensions', 15000);
    cmd.send('I', Buffer.from('ping -n 31 127.0.0.1 >nul\r'));
    await cmd.outputContains('ping -n 31 127.0.0.1'); await delay(1000);
    const interruptedAt = Date.now(); cmd.send('I', Buffer.from([3]));
    await cmd.until(() => /(?:^|[\r\n])[A-Za-z]:\\[^\r\n]*>\s*$/.test(cmd.plain), 'CMD prompt after Ctrl+C', 15000);
    cmd.send('I', Buffer.from('echo CMD_INTERRUPT_%NERDSSH_CMD_VALUE%\r')); await cmd.outputContains('CMD_INTERRUPT_one');
    assert.ok(Date.now() - interruptedAt < 20000, 'CMD Ctrl+C must end the disposable wait before its natural completion');
    cmd.send('I', Buffer.from('echo CMD_TAIL_%NERDSSH_CMD_VALUE% & exit 7\r'));
    assert.equal(await cmd.exitFrame(), 7); assert.ok(cmd.plain.includes('CMD_TAIL_one'), 'CMD native output tail');
    assert.equal(await cmd.waitClosed(), 0);
    console.log('local:cmd: Unicode, multiline, quoting, caret, groups, resize, Ctrl+C and exit tail passed');
  } finally { await cmd.stop(); }
  const shells = ['local:powershell'];
  if (fs.existsSync(pwsh7)) shells.push('local:pwsh');
  for (const shell of shells) {
    const bridge = new Bridge(shell);
    try {
      const state = await bridge.ready();
      if (state === 'X') { console.log(`${shell}: UAC cancelled`); assert.ok(elevated); return; }
      try {
        await bridge.until(() => /PS [^\r\n]*>/.test(bridge.plain), 'PowerShell prompt', 15000);
      } catch (error) {
        if (!elevated) {
          try { await bridge.stop(); await probePowerShellGuards(shell); }
          catch (probeError) { console.error('PowerShell guard probe could not run: ' + String(probeError.message).slice(-512)); }
        }
        throw error; // The diagnostic clone can never satisfy the exact-ASAR gate.
      }
      if (!elevated) await observeNativeProvider(bridge);
      await bridge.drain();
      bridge.send('S', Buffer.from([100, 0, 30, 0]));
      bridge.send('I', Buffer.from("Write-Output ('SMOKE_'+'Ω€')\r", 'utf8'));
      await bridge.outputContains('SMOKE_Ω€');
      bridge.send('I', Buffer.from("if(Get-Module PSReadLine){Write-Output ('STYLE_'+(Get-PSReadLineOption).HistorySaveStyle)}else{Write-Output 'STYLE_UNAVAILABLE'}\r"));
      await bridge.until(() => /\r?\nSTYLE_(SaveNothing|UNAVAILABLE)\r?\n/.test(bridge.plain), 'PSReadLine status', 15000);
      const psReadLine = bridge.plain.includes('\nSTYLE_SaveNothing\r\n') ? 'SaveNothing' : 'unavailable';
      if (psReadLine === 'unavailable') assert.equal(hasProtectedManifest(shell), false, 'protected PSReadLine exists but was not loaded');
      else {
        bridge.send('I', Buffer.from("Write-Output ('MODULE_BASE:'+(Get-Module PSReadLine).ModuleBase)\r"));
        await bridge.until(() => /\r?\nMODULE_BASE:([^\r\n]+)\r?\n/.test(bridge.plain), 'PSReadLine module base', 15000);
        const base = bridge.plain.match(/\r?\nMODULE_BASE:([^\r\n]+)\r?\n/)[1];
        assert.ok(insideProtectedRoot(base, moduleRoot(shell)), `unexpected PSReadLine module base: ${base}`);
      }
      bridge.send('I', Buffer.from("Write-Output ('SIZE_'+$Host.UI.RawUI.WindowSize.Width+'x'+$Host.UI.RawUI.WindowSize.Height)\r"));
      await bridge.outputContains('SIZE_100x30');
      bridge.send('I', Buffer.from("Start-Sleep -Seconds 30; Write-Output ('UNINTERRUPTED_'+'END')\r"));
      await bridge.outputContains('Start-Sleep -Seconds 30');
      await delay(1000); // Let PowerShell enter Start-Sleep before sending ETX.
      bridge.send('I', Buffer.from([3]));
      await delay(600);
      bridge.send('I', Buffer.from("Write-Output ('INTERRUPT_'+'OK')\r"));
      await bridge.outputContains('INTERRUPT_OK');
      assert.ok(!bridge.plain.includes('UNINTERRUPTED_END'), 'Ctrl+C should cancel the running statement');
      bridge.send('I', Buffer.from('exit 7\r'));
      assert.equal(await bridge.exitFrame(), 7);
      assert.equal(await bridge.waitClosed(), 0);
      console.log(`${shell}: Unicode, resize, Ctrl+C, exit 7 passed; PSReadLine ${psReadLine}`);
    } finally { await bridge.stop(); }
  }
  if (elevated) return;
  for (const shell of shells) await packagedConptyResizeSmoke(shell);

  const childPid = async (bridge, shell) => {
    const command = shell === 'local:cmd'
      ? '"' + windowsPowerShell + '" -NoLogo -NoProfile -NonInteractive -Command "[Console]::WriteLine(\'CHILD_PID:\'+(Get-CimInstance Win32_Process -Filter (\'ProcessId=\'+$PID)).ParentProcessId)"\r'
      : "Write-Output ('CHILD_PID:'+$PID)\r";
    bridge.send('I', Buffer.from(command));
    await bridge.until(() => /CHILD_PID:\d+/.test(bridge.plain), 'owned child pid', 15000);
    return Number(bridge.plain.match(/CHILD_PID:(\d+)/)[1]);
  };
  for (const shell of ['local:powershell', 'local:cmd']) {
  const detached = new Bridge(shell);
  try {
    assert.equal(await detached.ready(), 'R');
    const pid = await childPid(detached, shell);
    detached.child.stdin.end();
    assert.equal(await detached.waitClosed(), 0);
    const found = spawnSync(windowsPowerShell, ['-NoProfile', '-Command', `[bool](Get-Process -Id ${pid} -ErrorAction SilentlyContinue)`], { encoding: 'utf8' });
    assert.equal(found.stdout.trim(), 'False', 'owned shell must end after broker stdin EOF');
    console.log(shell + ': broker stdin EOF killed owned shell');
  } finally { await detached.stop(); }

  const invalid = new Bridge(shell);
  try {
    assert.equal(await invalid.ready(), 'R');
    const oversized = Buffer.alloc(5);
    oversized[0] = 'I'.charCodeAt(0);
    oversized.writeUInt32LE(65537, 1);
    invalid.child.stdin.write(oversized);
    assert.equal(await invalid.waitClosed(), 0);
    console.log(shell + ': oversized input frame rejected');
  } finally { await invalid.stop(); }

  const stalled = new Bridge(shell);
  try {
    assert.equal(await stalled.ready(), 'R');
    const pid = await childPid(stalled, shell);
    stalled.child.stdout.pause();
    const flood = Buffer.alloc(65536, 0x78);
    for (let i = 0; i < 4; i++) stalled.send('I', flood);
    await delay(300);
    stalled.child.kill(); // Simulate app killing a broker stalled on output/input.
    stalled.child.stdout.resume();
    await stalled.waitClosed(5000);
    const deadline = Date.now() + 5000;
    let alive = true;
    while (alive && Date.now() < deadline) {
      const check = spawnSync(windowsPowerShell, ['-NoProfile', '-Command', `[bool](Get-Process -Id ${pid} -ErrorAction SilentlyContinue)`], { encoding: 'utf8' });
      alive = check.stdout.trim() === 'True';
      if (alive) await delay(100);
    }
    assert.equal(alive, false, 'owned shell must end after stalled broker dies');
    console.log(shell + ': stalled output/input plus broker death killed owned shell');
  } finally { await stalled.stop(); }
  }
}

function cleanupArtifacts() {
  if (tempDir) {
    for (const name of nativeNames) {
      try { fs.unlinkSync(path.join(tempDir, 'native', name)); } catch { }
    }
    try { fs.rmdirSync(path.join(tempDir, 'native')); } catch { }
    for (const name of ['elevated-console.cs', 'elevated-pty.cjs', 'console-text.cjs', 'powershell-environment.cjs', 'xterm.cjs']) {
      try { fs.unlinkSync(path.join(tempDir, name)); } catch { }
    }
    try { fs.rmdirSync(tempDir); } catch { }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { cleanupArtifacts(); await nativeFixture?.dispose(); }).catch(error => { console.error(error); process.exitCode = 1; });
