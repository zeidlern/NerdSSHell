'use strict';
// Real consumer installation is restricted to a disposable GitHub-hosted VM.
// Never invoke this fixture on a maintainer workstation or a self-hosted runner.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { Module, createRequire } = require('node:module');
const asar = require('@electron/asar');
const { readMetadata, publishedRelease, downloadInstaller, newer } = require('../src/release-updater.cjs');
const canonicalVersion = require('../package.json').version;
const { StateStore } = require('../src/storage.cjs');
const { profile } = require('../src/core.cjs');

const REPOSITORY = 'zeidlern/NerdSSHell';
const GUID = '48ee049e-c2f6-57b2-ab6e-7f5df516dcc0';
const FROM = Object.freeze({ version: '1.2.1', sha256: '446b31fab8a00bca32b68d2e4ca9d257392e60b21eb03e16fc7105fc91269e24' });
const TO = Object.freeze({ version: '1.2.2', sha256: '8376baa0339283db4400098c8b68f0d6ce8dfbab2bdb576d1a3a19c85b07b74c' });
function hostedEnvironment(environment = process.env, platform = process.platform) {
  assert.equal(platform, 'win32', 'Real installer acceptance requires Windows.');
  assert.equal(environment.GITHUB_ACTIONS, 'true', 'Do not run consumer installers on a workstation.');
  assert.equal(environment.RUNNER_ENVIRONMENT, 'github-hosted', 'Self-hosted machines must never run this fixture.');
  assert.equal(environment.GITHUB_REPOSITORY, REPOSITORY, 'Use only the official repository hosted acceptance.');
  assert.ok(environment.RUNNER_TEMP && path.isAbsolute(environment.RUNNER_TEMP), 'A disposable runner directory is required.');
  assert.ok(['workflow_dispatch', 'pull_request'].includes(environment.GITHUB_EVENT_NAME), 'Use only owner dispatch or an internal reviewed PR acceptance.');
  if (environment.GITHUB_EVENT_NAME === 'workflow_dispatch') assert.equal(environment.GITHUB_REF, 'refs/heads/main', 'Dispatch only the reviewed main workflow.');
  else assert.equal(environment.NERDSSHELL_ACCEPTANCE_HEAD_REPOSITORY, REPOSITORY, 'Fork pull requests must never run consumer installation acceptance.');
  assert.equal(environment.GITHUB_ACTOR, 'zeidlern', 'Only the owner may dispatch real consumer installation acceptance.');
}
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const psquote = value => "'" + value.replaceAll("'", "''") + "'";
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(operation, label, milliseconds = 30000) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) { if (await operation()) return; await delay(100); }
  throw new Error(label);
}
function execute(file, args, { timeout = 30000, ...options } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let stdout = '', stderr = '', settled = false, timer;
    const finish = error => { if (settled) return; settled = true; clearTimeout(timer); if (error) { child.unref(); child.stdout.unref?.(); child.stderr.unref?.(); reject(error); } else resolve(stdout.trim()); };
    child.stdout.on('data', bytes => { if (settled) return; if (stdout.length + bytes.length > 1024 * 1024) finish(new Error('Acceptance output exceeded its bound.')); else stdout += bytes; });
    child.stderr.on('data', bytes => { stderr += bytes.toString().slice(0, Math.max(0, 16384 - stderr.length)); });
    child.once('error', finish);
    timer = setTimeout(() => finish(new Error('Owned acceptance process exceeded its timeout.')), timeout);
    child.once('close', code => finish(code === 0 ? null : new Error('Owned acceptance process failed (' + code + '): ' + stderr.slice(0, 2048))));
  });
}
const powershell = (code, options) => execute(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from("$ErrorActionPreference='Stop';" + code, 'utf16le').toString('base64')], options);
const ownedWindowType = `Add-Type -TypeDefinition @'
using System;using System.Text;using System.Runtime.InteropServices;
public static class NerdSSHellPublishedWindow {
 delegate bool Visitor(IntPtr window,IntPtr state);
 [DllImport("user32.dll")]static extern bool EnumWindows(Visitor visitor,IntPtr state);
 [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetClassName(IntPtr window,StringBuilder name,int size);
 [DllImport("user32.dll")]static extern bool PostMessage(IntPtr window,uint message,IntPtr first,IntPtr second);
 public static IntPtr Find(uint process){IntPtr found=IntPtr.Zero;EnumWindows((window,state)=>{uint owner;GetWindowThreadProcessId(window,out owner);if(owner==process){var name=new StringBuilder(256);GetClassName(window,name,name.Capacity);if(name.ToString()=="Chrome_WidgetWin_1"){found=window;return false;}}return true;},IntPtr.Zero);return found;}
 public static bool Close(IntPtr window,uint process){uint owner;GetWindowThreadProcessId(window,out owner);return owner==process&&PostMessage(window,0x0010,IntPtr.Zero,IntPtr.Zero);}
}
'@;`;
function updaterFromArchive(archive) {
  const file = path.join(archive, 'src', 'release-updater.cjs');
  const loaded = new Module(file, module); loaded.filename = file; loaded.paths = module.paths;
  loaded._compile(asar.extractFile(archive, 'src/release-updater.cjs').toString('utf8'), file);
  return loaded.exports;
}
function candidateController(archive, plan, output) {
  const data = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'nerdsshell-candidate-controller-'));
  const file = path.join(data, 'controller-plan.json'); fs.writeFileSync(file, JSON.stringify({ archive, ...plan, output }));
  const child = spawn(require('electron'), [__filename, '--candidate-controller', file, '--user-data-dir=' + data], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '', pending, timer, closed = false, current;
  const fail = error => { if (pending) { clearTimeout(timer); const item = pending; pending = null; item.reject(error); } };
  child.stdout.on('data', bytes => {
    buffer += bytes.toString(); if (buffer.length > 32768) return fail(new Error('Candidate controller protocol exceeded its bound.'));
    while (buffer.includes('\n')) { const at = buffer.indexOf('\n'), line = buffer.slice(0, at).trim(); buffer = buffer.slice(at + 1); if (!line.startsWith('FIXTURE ')) continue;
      try { current = JSON.parse(line.slice(8)); if (current.type === 'ERROR') fail(new Error(current.message));
        else if (pending && current.type === pending.expected) { clearTimeout(timer); const item = pending; pending = null; item.resolve(current); }
      } catch (error) { fail(error); }
    }
  });
  child.stderr.resume(); child.stdin.on('error', fail); child.once('error', fail); child.once('close', code => { closed = true; fail(new Error('Candidate controller exited before its expected response (' + code + ').')); });
  const wait = (expected, milliseconds = 600000) => new Promise((resolve, reject) => {
    if (closed) return reject(new Error('Candidate controller is unavailable.')); if (pending) return reject(new Error('Candidate controller already has a pending command.'));
    if (current?.type === 'ERROR') return reject(new Error(current.message));
    if (current?.type === expected) return resolve(current);
    pending = { expected, resolve, reject }; timer = setTimeout(() => fail(new Error('Candidate controller timed out awaiting ' + expected + '.')), milliseconds);
  });
  const command = async (name, expected) => { const result = wait(expected, 30000); child.stdin.write(name + '\n'); return result; };
  return { ready: () => wait('READY'), release: () => command('GO', 'GO'), async complete() { await command('DONE', 'DONE'); await until(() => closed, 'Candidate SDK controller did not exit.'); },
    async cancel() { if (!closed) { try { await command('CANCEL', 'CANCEL'); } catch {} } },
    detach() { clearTimeout(timer); child.unref(); child.stdin.unref?.(); child.stdout.unref?.(); child.stderr.unref?.(); }
  };
}
async function runCandidateController() {
  hostedEnvironment();
  assert.equal(process.argv[2], '--candidate-controller'); const file = process.argv[3];
  const directory = fs.realpathSync.native(path.dirname(file));
  assert.equal(path.dirname(directory).toLowerCase(), fs.realpathSync.native(os.tmpdir()).toLowerCase());
  assert.ok(path.basename(directory).startsWith('nerdsshell-candidate-controller-'));
  const plan = JSON.parse(fs.readFileSync(file, 'utf8')), { app, net } = require('electron');
  let handoff, ready, failure;
  const send = value => process.stdout.write('FIXTURE ' + JSON.stringify(value) + '\n');
  const report = { scope: 'Exact canonical candidate-ASAR modules under locked SDK with controlled current-version identity from actual installed legacy parent and pinned tagged public 1.2.2 selection. Real public HTTPS, fixed Windows helper, consent-release, old parent exit and actual NSIS; not candidate production startup.', status: 'running' };
  const persist = () => fs.writeFileSync(plan.output, JSON.stringify(report, null, 2) + '\n');
  try {
    await app.whenReady(); const packed = createRequire(path.join(plan.archive, 'src', 'main.cjs'));
    const metadata = packed('../package.json');
    assert.equal(metadata.version, plan.candidateVersion, 'Use the exact canonical candidate package.');
    assert.ok(newer(metadata.version, TO.version), 'The patched candidate must be newer than the immutable sample.');
    report.candidateVersion = metadata.version; report.candidateAsarSha256 = createHash('sha256').update(require('original-fs').readFileSync(plan.archive)).digest('hex');
    const updater = packed('./release-updater.cjs');
    // Filled with the exact candidate transport's public export; never substitute
    // Node fetch for the Chromium API that failed in published legacy clients.
    const transport = packed('./release-transport.cjs').createReleaseFetch(net);
    const latest = await updater.readMetadata(transport, metadata.version);
    report.realLatestCheck = { currentVersion: metadata.version, status: latest ? 'available' : 'current', ...(latest ? { availableVersion: latest.version, releaseId: latest.releaseId } : {}) };
    const tagged = await transport('https://api.github.com/repos/' + REPOSITORY + '/releases/tags/v' + TO.version, { method: 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(15000), headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'NerdSSHell/' + metadata.version, 'X-GitHub-Api-Version': '2022-11-28' } });
    assert.equal(tagged.status, 200); const reader = tagged.body.getReader(); let total = 0; const chunks = [];
    try { while (true) { const part = await reader.read(); if (part.done) break; total += part.value.byteLength; assert.ok(total <= updater.MAX_METADATA); chunks.push(Buffer.from(part.value)); } } finally { await reader.cancel(); }
    const release = updater.publishedRelease(JSON.parse(Buffer.concat(chunks, total).toString('utf8')), FROM.version); assert.equal(release.version, TO.version); assert.equal(release.sha256, TO.sha256);
    report.controlledSelection = { taggedVersion: TO.version, currentVersion: FROM.version, actualLatestFeedUnmodified: true };
    ready = await updater.downloadInstaller(transport, release, FROM.version);
    report.installerSha256 = digest(ready.installerPath); assert.equal(report.installerSha256, TO.sha256);
    handoff = await packed('./update-handoff.cjs').armUpdate({ ...ready, executablePath: plan.executablePath, userDataDirectory: plan.userDataDirectory, parentPid: plan.parentPid });
    report.status = 'prepared'; persist(); send({ type: 'READY', sha256: release.sha256, size: release.size, targetVersion: release.version, parentPid: plan.parentPid, candidateVersion: metadata.version, candidateAsarSha256: report.candidateAsarSha256, realLatestCheck: report.realLatestCheck });
    const readline = require('node:readline').createInterface({ input: process.stdin });
    for await (const command of readline) {
      if (command === 'GO') { assert.equal(report.status, 'prepared'); await handoff.release(); report.status = 'released'; persist(); send({ type: 'GO' }); }
      else if (command === 'CANCEL') { await handoff.cancel(); ready = null; report.status = 'cancelled'; persist(); send({ type: 'CANCEL' }); break; }
      else if (command === 'DONE') { assert.equal(report.status, 'released'); ready = null; report.status = 'passed'; persist(); send({ type: 'DONE' }); break; }
      else throw new Error('Unexpected candidate controller command.');
    }
    readline.close();
  } catch (error) { failure = error; report.status = 'failed'; report.failure = error.message; persist(); send({ type: 'ERROR', message: error.message }); }
  finally { if (failure && handoff) try { await handoff.cancel(); } catch {} if (ready) try { ready.cleanup(); } catch {} app.exit(failure ? 1 : 0); }
}
// Accessibility actions are scoped to the exact owned root PID and executable.
// No debugging switch or altered ASAR is used, so startup eligibility is real.
async function accessibleAction(pid, executable, action, requiredName = '') {
  assert.ok(['Not now', 'Upgrade', 'close', 'inspect', 'observe'].includes(action));
  const code = String.raw`Add-Type -AssemblyName UIAutomationClient;Add-Type -AssemblyName UIAutomationTypes;${ownedWindowType}
    $owned=[Diagnostics.Process]::GetProcessById(${pid});try{
      if(-not [string]::Equals($owned.MainModule.FileName,${psquote(executable)},[StringComparison]::OrdinalIgnoreCase)){throw 'Owned app identity changed'};
      $limit=[DateTime]::UtcNow.AddSeconds(20);$root=$null;
      while([DateTime]::UtcNow -lt $limit){$owned.Refresh();if($owned.HasExited){throw 'Owned application exited before accessibility action'};
        $window=[NerdSSHellPublishedWindow]::Find([uint32]$owned.Id);
        if($window -ne [IntPtr]::Zero){if(${psquote(action)} -eq 'close'){if(-not [NerdSSHellPublishedWindow]::Close($window,[uint32]$owned.Id)){throw 'Normal owned WM_CLOSE failed'};return};$root=[Windows.Automation.AutomationElement]::FromHandle($window);break};Start-Sleep -Milliseconds 100};
      if($null -eq $root){throw 'No owned application window'};
      $observations=0;$observedNewerOffer=$false;
      if(${psquote(action)} -eq 'observe'){$observationClock=[Diagnostics.Stopwatch]::StartNew();$limit=[DateTime]::UtcNow.AddMilliseconds(17000)};
      while([DateTime]::UtcNow -lt $limit){
        $elements=$root.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition);
        if($elements.Count -gt 5000){throw 'Accessibility tree exceeded its bound'};$names=@();$button=$null;
        for($index=0;$index -lt $elements.Count;$index++){$element=$elements.Item($index);$current=$element.Current;
          if($current.Name){$names+=$current.Name};if($current.Name -ceq ${psquote(action)} -and $current.ControlType -eq [Windows.Automation.ControlType]::Button){$button=$element}};
        if(${psquote(action)} -eq 'observe'){
          $observations++;if(@($names|Where-Object {$_.StartsWith('The update check or download could not finish.',[StringComparison]::Ordinal)}).Count){throw 'Actual fused startup displayed an update-check failure'};
          foreach($name in $names){if($name -match '^NerdSSHell ([0-9]+\.[0-9]+\.[0-9]+) is available\. Upgrade now\?'){
            if([version]$Matches[1] -le [version]${psquote(canonicalVersion)}){throw 'Actual fused startup offered an obsolete release'};$observedNewerOffer=$true}};
          Start-Sleep -Milliseconds 200;continue
        };
        $required=${psquote(requiredName)};if($required -and @($names|Where-Object {$_.StartsWith($required,[StringComparison]::Ordinal)}).Count -eq 0){Start-Sleep -Milliseconds 100;continue};
        if(${psquote(action)} -eq 'inspect'){@{names=$names;pid=$owned.Id}|ConvertTo-Json -Depth 3 -Compress;return};
        if($button){if(-not $button.Current.IsEnabled){throw 'Owned consent button is disabled'};
          $invoke=$button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern);$invoke.Invoke();
          @{invoked=${psquote(action)};requiredNameObserved=$true;pid=$owned.Id}|ConvertTo-Json -Compress;return};Start-Sleep -Milliseconds 100
      };if(${psquote(action)} -eq 'observe'){@{observedMilliseconds=$observationClock.ElapsedMilliseconds;snapshots=$observations;newerOfferObserved=$observedNewerOffer;completionClaimed=$false}|ConvertTo-Json -Compress;return};throw 'Expected owned update consent was unavailable'
    }finally{$owned.Dispose()}`;
  const result = await powershell(code, { timeout: action === 'observe' ? 45000 : 30000 });
  return result ? JSON.parse(result) : null;
}
async function registrations() {
  return JSON.parse(await powershell(`$entries=@();foreach($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryHive]::LocalMachine)){
    $root=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,[Microsoft.Win32.RegistryView]::Registry64);try{
      $key=$root.OpenSubKey('Software\\${GUID}',$false);if($key){try{$entries+=@{directory=$key.GetValue('InstallLocation');scope=$hive.ToString()}}finally{$key.Dispose()}}
    }finally{$root.Dispose()}};ConvertTo-Json -InputObject @($entries) -Compress`));
}
async function applications({ rootWindowOnly = false } = {}) {
  return JSON.parse(await powershell(`${rootWindowOnly ? ownedWindowType : ''}$records=@();foreach($name in @('NerdSSHell','BetterSSH')){foreach($owned in @([Diagnostics.Process]::GetProcessesByName($name))){try{
    if(${rootWindowOnly ? '$true' : '$false'}){if([NerdSSHellPublishedWindow]::Find([uint32]$owned.Id) -eq [IntPtr]::Zero){continue}};
    $records+=@{pid=$owned.Id;executable=$owned.MainModule.FileName}
  }finally{$owned.Dispose()}}};ConvertTo-Json -InputObject @($records) -Compress`));
}
async function executableVersion(executable) {
  return powershell(`$value=[Diagnostics.FileVersionInfo]::GetVersionInfo(${psquote(executable)});if($value.ProductName -cne 'NerdSSHell'){throw 'Wrong installed product'};$value.ProductVersion`);
}
async function installConsumer(installer, directory) {
  await powershell(`$options=New-Object Diagnostics.ProcessStartInfo;$options.FileName=${psquote(installer)};$options.Arguments=${psquote('/S /currentuser /D=' + directory)};$options.UseShellExecute=$true;$options.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden;
    $installer=[Diagnostics.Process]::Start($options);try{if(-not $installer.WaitForExit(120000)){throw 'Owned installer did not finish'};if($installer.ExitCode -ne 0){throw 'Owned installer failed'}}finally{$installer.Dispose()}`, { timeout: 150000 });
}
async function main() {
  hostedEnvironment();
  assert.equal(process.argv.length, 2, 'This immutable acceptance accepts no installer/path/version arguments.');
  const temporary = fs.realpathSync.native(process.env.RUNNER_TEMP);
  const fixture = fs.mkdtempSync(path.join(temporary, 'nerdsshell-published-update-'));
  const install = path.join(fixture, 'Installation with spaces');
  const data = path.join(fixture, 'Synthetic profile with spaces');
  const output = path.join(process.cwd(), '.local', 'published-update-acceptance');
  fs.mkdirSync(output, { recursive: true }); fs.mkdirSync(data);
  const executable = path.join(install, 'NerdSSHell.exe');
  const report = { status: 'running', scope: 'Actual published 1.2.1 startup discovers the current real latest stable release and refuses its broken legacy download safely after accessibility consent. Separate exact canonical candidate-ASAR SDK controller selects pinned tagged public 1.2.2 using a controlled current-version identity, exercises patched Chromium transport and real helper against that actual old parent, then real public NSIS/restart/data preservation. Final manual candidate NSIS bootstrap verifies the exact new installed ASAR and actual fused application. This does not claim legacy clients automatically install. Disposable GitHub-hosted Windows, synthetic data; no clipboard, remote session, UAC or physical mouse acceptance.', source: process.env.GITHUB_SHA, checks: [], from: FROM, to: TO };
  const persist = () => fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  const check = (name, value = true) => { assert.equal(value, true, name); report.checks.push(name); persist(); console.log(name); };
  const staged = []; let app, restarted, controller;
  const trackApp = () => {
    const child = spawn(executable, ['--force-renderer-accessibility', '--user-data-dir=' + data], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stderrText = ''; child.stdout.resume(); child.stderr.on('data', bytes => { child.stderrText += bytes.toString().slice(0, Math.max(0, 16384 - child.stderrText.length)); }); child.once('error', error => { child.launchError = error; }); child.once('close', () => { child.ended = true; });
    return child;
  };
  try {
    check('Hosted runner starts without NerdSSHell registration or running applications', (await registrations()).length === 0 && (await applications()).length === 0);
    const target = await readMetadata(fetch, FROM.version);
    check('Unauthenticated latest endpoint offers a valid stable release to legacy 1.2.1', !!target && (target.version === TO.version || newer(target.version, TO.version)));
    report.actualLatest = { version: target.version, releaseId: target.releaseId, sha256: target.sha256 };
    const baselineResponse = await fetch('https://api.github.com/repos/' + REPOSITORY + '/releases/tags/v' + FROM.version, { redirect: 'error', credentials: 'omit', headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
    assert.equal(baselineResponse.status, 200);
    const baseline = publishedRelease(await baselineResponse.json(), '0.0.0');
    check('Published baseline installer digest matches immutable 1.2.1', baseline.version === FROM.version && baseline.sha256 === FROM.sha256);
    const ready = await downloadInstaller(fetch, baseline, '0.0.0'); staged.push(ready);
    check('Public 1.2.1 download verifies exact size, EXE magic and SHA-256', digest(ready.installerPath) === FROM.sha256);
    await installConsumer(ready.installerPath, install);
    check('Real current-user NSIS installs exact baseline version', (await executableVersion(executable)) === FROM.version + '.0');
    const registration = await registrations();
    check('Baseline registration uses only the owned installation directory', registration.length === 1 && registration[0].scope === 'CurrentUser' && path.resolve(registration[0].directory).toLowerCase() === install.toLowerCase());
    const archive = path.join(install, 'resources', 'app.asar');
    report.fromAsarSha256 = digest(archive);
    const actualUpdater = updaterFromArchive(archive), packedMetadata = JSON.parse(asar.extractFile(archive, 'package.json'));
    check('Exact installed 1.2.1 updater discovers real current latest', packedMetadata.version === FROM.version && (await actualUpdater.readMetadata(fetch, FROM.version))?.sha256 === target.sha256);
    check('Exact installed updater recognizes real same-version latest as already current', await actualUpdater.readMetadata(fetch, target.version) === null);
    await assert.rejects(actualUpdater.readMetadata(async () => new Response('', { status: 503 }), FROM.version));
    await assert.rejects(actualUpdater.readMetadata(async () => new Response('{"draft":true}'), FROM.version));
    check('Exact installed updater reports HTTP failure and invalid metadata as errors, not already current');
    const store = new StateStore(data);
    store.data.profiles = [profile({ id: 'published-upgrade-fixture', name: 'Synthetic preserved connection', host: '127.0.0.1', port: 65200, username: 'fixture', auth: 'agent', sessionMode: 'standard', autoConnect: false, startup: 'none', record: false, scrollback: 1000 })];
    store.data.pins['127.0.0.1:65200'] = 'SHA256:' + createHash('sha256').update('SYNTHETIC HOST KEY ONLY').digest('base64').replace(/=+$/, '');
    store.data.appearance.copyOnSelect = false; store.data.appearance.accent = '#123456';
    store.data.notifications = { enabled: false, audio: false, desktop: false, visual: false };
    store.data.sessionDefaults.autoConnect = false; store.data.sessionDefaults.startup = 'none'; store.save();
    const original = JSON.parse(fs.readFileSync(store.file, 'utf8'));
    const sentinel = path.join(data, 'history', 'published-upgrade-fixture', 'synthetic-sentinel.jsonl');
    fs.mkdirSync(path.dirname(sentinel), { recursive: true }); fs.writeFileSync(sentinel, '{"text":"SYNTHETIC PRESERVATION ONLY"}\n'); const sentinelHash = digest(sentinel);
    app = trackApp();
    const declined = await accessibleAction(app.pid, executable, 'Not now', 'NerdSSHell ' + target.version + ' is available. Upgrade now?');
    await delay(1000);
    check('Actual eligible fused 1.2.1 shows update and honors native-accessibility Not now', declined.invoked === 'Not now' && !app.ended && !app.launchError && (await executableVersion(executable)) === FROM.version + '.0');
    check('Actual Not now never creates an installer download stage', !fs.readdirSync(fs.realpathSync.native(os.tmpdir())).some(name => name.startsWith('nerdsshell-update-' + app.pid + '-')));
    await accessibleAction(app.pid, executable, 'close'); await until(() => app.ended, 'Declined baseline app did not exit normally.');
    app = trackApp(); const oldPid = app.pid;
    const approved = await accessibleAction(oldPid, executable, 'Upgrade', 'NerdSSHell ' + target.version + ' is available. Upgrade now?');
    check('Actual eligible fused application receives explicit accessibility Upgrade approval', approved.invoked === 'Upgrade');
    const refused = await accessibleAction(oldPid, executable, 'inspect', 'The update check or download could not finish.');
    check('Actual legacy download failure visibly preserves its running original version', refused.names.some(name => name.startsWith('The update check or download could not finish.')) && !app.ended && await executableVersion(executable) === FROM.version + '.0');
    check('Actual legacy download refusal leaves no installer stage or installation', !fs.readdirSync(fs.realpathSync.native(os.tmpdir())).some(name => name.startsWith('nerdsshell-update-' + oldPid + '-')));
    report.legacyAutomaticInstallation = false;
    const candidateArchive = fs.realpathSync.native(path.join(process.cwd(), 'dist', 'win-unpacked', 'resources', 'app.asar'));
    controller = candidateController(candidateArchive, { executablePath: executable, userDataDirectory: data, parentPid: oldPid, candidateVersion: canonicalVersion }, path.join(output, 'candidate-controller.json'));
    const handoff = await controller.ready();
    report.handoff = handoff;
    report.candidateRealLatestCheck = handoff.realLatestCheck;
    check('Exact candidate modules return a distinct current or available result from the real latest feed', ['current', 'available'].includes(handoff.realLatestCheck?.status) && handoff.realLatestCheck.currentVersion === canonicalVersion);
    check('Exact candidate Chromium transport downloads pinned public installer and prepares real helper for original parent', handoff.sha256 === TO.sha256 && handoff.parentPid === oldPid && handoff.candidateVersion === canonicalVersion);
    await controller.release();
    check('Candidate helper release preserves original living parent until normal close', !app.ended && await executableVersion(executable) === FROM.version + '.0');
    await accessibleAction(oldPid, executable, 'close'); await until(() => app.ended, 'Actual legacy app did not exit after normal close.', 120000);
    await until(async () => { try { return await executableVersion(executable) === TO.version + '.0'; } catch { return false; } }, 'Real installer did not finish exact 1.2.2 installation.', 180000);
    await until(async () => { restarted = (await applications({ rootWindowOnly: true })).find(value => value.pid !== oldPid && value.executable.toLowerCase() === executable.toLowerCase()); return !!restarted; }, 'Actual helper did not restart the upgraded application with its owned root window.', 120000);
    report.restartedPid = restarted.pid;
    check('Real helper waits for old app exit, installs 1.2.2 and restarts actual application', app.ended && restarted.pid !== oldPid);
    if (newer(target.version, TO.version)) await accessibleAction(restarted.pid, executable, 'Not now', 'NerdSSHell ' + target.version + ' is available. Upgrade now?');
    const visible = await accessibleAction(restarted.pid, executable, 'inspect', 'Synthetic preserved connection');
    check('Restarted actual app uses its original synthetic saved connection', visible.names.some(name => name.startsWith('Synthetic preserved connection')));
    const after = JSON.parse(fs.readFileSync(store.file, 'utf8'));
    check('Upgrade preserves saved profiles, host pins, preferences and archive bytes', JSON.stringify(after.profiles) === JSON.stringify(original.profiles) && JSON.stringify(after.pins) === JSON.stringify(original.pins) && JSON.stringify(after.appearance) === JSON.stringify(original.appearance) && JSON.stringify(after.notifications) === JSON.stringify(original.notifications) && JSON.stringify(after.sessionDefaults) === JSON.stringify(original.sessionDefaults) && digest(sentinel) === sentinelHash);
    const updatedUpdater = updaterFromArchive(archive);
    const publicSampleOffer = await updatedUpdater.readMetadata(fetch, TO.version);
    check('Exact installed public sample correctly compares the real latest release', target.version === TO.version ? publicSampleOffer === null : publicSampleOffer?.version === target.version);
    report.toAsarSha256 = digest(archive);
    await accessibleAction(restarted.pid, executable, 'close');
    await until(async () => (await applications()).length === 0, 'Owned upgraded app did not close normally.');
    check('All actual installed application processes close normally', (await applications()).length === 0);
    await controller.complete();
    const candidateVersion = handoff.candidateVersion;
    const candidateInstaller = fs.realpathSync.native(path.join(process.cwd(), 'dist', 'NerdSSHell-' + candidateVersion + '-x64-Setup.exe'));
    report.candidateBootstrap = { version: candidateVersion, installerSha256: digest(candidateInstaller), candidateAsarSha256: handoff.candidateAsarSha256, unsigned: true };
    check('Manual candidate bootstrap starts only after all owned production apps close', (await applications()).length === 0);
    await installConsumer(candidateInstaller, install);
    check('Real candidate NSIS installs exact new version and candidate-ASAR bytes', await executableVersion(executable) === candidateVersion + '.0' && digest(archive) === handoff.candidateAsarSha256);
    app = trackApp();
    if (newer(target.version, candidateVersion)) await accessibleAction(app.pid, executable, 'Not now', 'NerdSSHell ' + target.version + ' is available. Upgrade now?');
    const patchedView = await accessibleAction(app.pid, executable, 'inspect', 'Synthetic preserved connection');
    check('Actual fused patched application opens its original saved connection after bootstrap', patchedView.names.some(name => name.startsWith('Synthetic preserved connection')));
    const startupObservation = await accessibleAction(app.pid, executable, 'observe'); report.candidateBootstrap.startupObservation = startupObservation;
    check('Actual fused launch has bounded observation beyond the startup timeout without a visible failure or obsolete offer', startupObservation.observedMilliseconds > 15000 && startupObservation.snapshots > 0 && startupObservation.completionClaimed === false);
    const bootstrapped = JSON.parse(fs.readFileSync(store.file, 'utf8'));
    check('Candidate bootstrap preserves saved profiles, host pins, preferences and archive bytes', JSON.stringify(bootstrapped.profiles) === JSON.stringify(original.profiles) && JSON.stringify(bootstrapped.pins) === JSON.stringify(original.pins) && JSON.stringify(bootstrapped.appearance) === JSON.stringify(original.appearance) && JSON.stringify(bootstrapped.notifications) === JSON.stringify(original.notifications) && JSON.stringify(bootstrapped.sessionDefaults) === JSON.stringify(original.sessionDefaults) && digest(sentinel) === sentinelHash);
    await accessibleAction(app.pid, executable, 'close'); await until(() => app.ended, 'Owned patched app did not close normally.');
    await until(async () => (await applications()).length === 0, 'Owned patched app left production processes.');
    check('Actual fused patched application closes normally after bootstrap acceptance', (await applications()).length === 0);
    report.status = 'passed'; persist();
  } catch (error) {
    report.status = 'failed'; report.failure = error.message; report.ownedAppStderr = app?.stderrText; report.ownedAppEnded = app?.ended === true; persist(); throw error;
  } finally {
    // The VM is discarded. Never force-kill consumer applications or recursively
    // delete an installation/user profile to make an acceptance failure disappear.
    for (const ready of staged) { try { ready.cleanup(); } catch {} }
    if (report.status !== 'passed' && controller) await controller.cancel();
    for (const pid of new Set([app && !app.ended ? app.pid : null, restarted?.pid].filter(Boolean))) {
      try { await accessibleAction(pid, executable, 'close'); } catch {} // Only normal close requests, never forced termination.
    }
    controller?.detach();
    if (app && !app.ended) { app.unref(); app.stdout.unref?.(); app.stderr.unref?.(); }
    report.disposableRunnerOnly = true; persist();
  }
}
module.exports = { hostedEnvironment, FROM, TO, updaterFromArchive };
if (require.main === module) {
  if (process.versions.electron) runCandidateController().catch(error => { console.error(error.message); require('electron').app.exit(1); });
  else main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
