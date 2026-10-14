'use strict';
// Real consumer installation is restricted to a disposable GitHub-hosted VM.
// Never invoke this fixture on a maintainer workstation or a self-hosted runner.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { Module } = require('node:module');
const asar = require('@electron/asar');
const { readMetadata, publishedRelease, downloadInstaller, API_URL } = require('../src/release-updater.cjs');
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
    const finish = error => { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolve(stdout.trim()); };
    child.stdout.on('data', bytes => { if (settled) return; if (stdout.length + bytes.length > 1024 * 1024) finish(new Error('Acceptance output exceeded its bound.')); else stdout += bytes; });
    child.stderr.on('data', bytes => { stderr += bytes.toString().slice(0, Math.max(0, 16384 - stderr.length)); });
    child.once('error', finish);
    timer = setTimeout(() => finish(new Error('Owned acceptance process exceeded its timeout.')), timeout);
    child.once('close', code => finish(code === 0 ? null : new Error('Owned acceptance process failed (' + code + '): ' + stderr.slice(0, 2048))));
  });
}
const powershell = (code, options) => execute(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from("$ErrorActionPreference='Stop';" + code, 'utf16le').toString('base64')], options);
function updaterFromArchive(archive) {
  const file = path.join(archive, 'src', 'release-updater.cjs');
  const loaded = new Module(file, module); loaded.filename = file; loaded.paths = module.paths;
  loaded._compile(asar.extractFile(archive, 'src/release-updater.cjs').toString('utf8'), file);
  return loaded.exports;
}
// Accessibility actions are scoped to the exact owned root PID and executable.
// No debugging switch or altered ASAR is used, so startup eligibility is real.
async function accessibleAction(pid, executable, action, requiredName = '') {
  assert.ok(['Not now', 'Upgrade', 'close', 'inspect'].includes(action));
  const code = `Add-Type -AssemblyName UIAutomationClient;Add-Type -AssemblyName UIAutomationTypes;
    $owned=[Diagnostics.Process]::GetProcessById(${pid});try{
      if(-not [string]::Equals($owned.MainModule.FileName,${psquote(executable)},[StringComparison]::OrdinalIgnoreCase)){throw 'Owned app identity changed'};
      if(${psquote(action)} -eq 'close'){if(-not $owned.CloseMainWindow()){throw 'Normal close request failed'};return};
      $limit=[DateTime]::UtcNow.AddSeconds(20);$root=$null;
      while([DateTime]::UtcNow -lt $limit){$owned.Refresh();if($owned.HasExited){throw 'Owned application exited before accessibility action'};
        if($owned.MainWindowHandle -ne [IntPtr]::Zero){$root=[Windows.Automation.AutomationElement]::FromHandle($owned.MainWindowHandle);break};Start-Sleep -Milliseconds 100};
      if($null -eq $root){throw 'No owned application window'};
      while([DateTime]::UtcNow -lt $limit){
        $elements=$root.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition);
        if($elements.Count -gt 5000){throw 'Accessibility tree exceeded its bound'};$names=@();$button=$null;
        for($index=0;$index -lt $elements.Count;$index++){$element=$elements.Item($index);$current=$element.Current;
          if($current.Name){$names+=$current.Name};if($current.Name -ceq ${psquote(action)} -and $current.ControlType -eq [Windows.Automation.ControlType]::Button){$button=$element}};
        $required=${psquote(requiredName)};if($required -and @($names|Where-Object {$_.StartsWith($required,[StringComparison]::Ordinal)}).Count -eq 0){Start-Sleep -Milliseconds 100;continue};
        if(${psquote(action)} -eq 'inspect'){@{names=$names;pid=$owned.Id}|ConvertTo-Json -Depth 3 -Compress;return};
        if($button){if(-not $button.Current.IsEnabled){throw 'Owned consent button is disabled'};
          $invoke=$button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern);$invoke.Invoke();
          @{invoked=${psquote(action)};requiredNameObserved=$true;pid=$owned.Id}|ConvertTo-Json -Compress;return};Start-Sleep -Milliseconds 100
      };throw 'Expected owned update consent was unavailable'
    }finally{$owned.Dispose()}`;
  const result = await powershell(code);
  return result ? JSON.parse(result) : null;
}
async function registrations() {
  return JSON.parse(await powershell(`$entries=@();foreach($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryHive]::LocalMachine)){
    $root=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,[Microsoft.Win32.RegistryView]::Registry64);try{
      $key=$root.OpenSubKey('Software\\${GUID}',$false);if($key){try{$entries+=@{directory=$key.GetValue('InstallLocation');scope=$hive.ToString()}}finally{$key.Dispose()}}
    }finally{$root.Dispose()}};ConvertTo-Json -InputObject @($entries) -Compress`));
}
async function applications() {
  return JSON.parse(await powershell(`$records=@();foreach($name in @('NerdSSHell','BetterSSH')){foreach($owned in @([Diagnostics.Process]::GetProcessesByName($name))){try{
    $records+=@{pid=$owned.Id;executable=$owned.MainModule.FileName}
  }finally{$owned.Dispose()}}};ConvertTo-Json -InputObject @($records) -Compress`));
}
async function executableVersion(executable) {
  return powershell(`$value=[Diagnostics.FileVersionInfo]::GetVersionInfo(${psquote(executable)});if($value.ProductName -cne 'NerdSSHell'){throw 'Wrong installed product'};$value.ProductVersion`);
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
  const report = { status: 'running', scope: 'Real published unsigned 1.2.1 to 1.2.2 current-user NSIS installation on disposable GitHub-hosted Windows, actual unchanged fused application startup updater, Windows accessibility consent, real download/handoff/restart, isolated synthetic data. No real user profile, clipboard, remote session, UAC or physical mouse acceptance.', source: process.env.GITHUB_SHA, checks: [], from: FROM, to: TO };
  const persist = () => fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  const check = (name, value = true) => { assert.equal(value, true, name); report.checks.push(name); persist(); console.log(name); };
  const staged = []; let app, restarted;
  const trackApp = () => {
    const child = spawn(executable, ['--force-renderer-accessibility', '--user-data-dir=' + data], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.resume(); child.stderr.resume(); child.once('error', error => { child.launchError = error; }); child.once('close', () => { child.ended = true; });
    return child;
  };
  try {
    check('Hosted runner starts without NerdSSHell registration or running applications', (await registrations()).length === 0 && (await applications()).length === 0);
    const target = await readMetadata(fetch, FROM.version);
    check('Unauthenticated latest endpoint offers exact published 1.2.2 to 1.2.1', target?.version === TO.version && target.sha256 === TO.sha256);
    const baselineResponse = await fetch('https://api.github.com/repos/' + REPOSITORY + '/releases/tags/v' + FROM.version, { redirect: 'error', credentials: 'omit', headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
    assert.equal(baselineResponse.status, 200);
    const baseline = publishedRelease(await baselineResponse.json(), '0.0.0');
    check('Published baseline installer digest matches immutable 1.2.1', baseline.version === FROM.version && baseline.sha256 === FROM.sha256);
    const ready = await downloadInstaller(fetch, baseline, '0.0.0'); staged.push(ready);
    check('Public 1.2.1 download verifies exact size, EXE magic and SHA-256', digest(ready.installerPath) === FROM.sha256);
    await powershell(`$options=New-Object Diagnostics.ProcessStartInfo;$options.FileName=${psquote(ready.installerPath)};$options.Arguments=${psquote('/S /currentuser /D=' + install)};$options.UseShellExecute=$true;$options.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden;
      $installer=[Diagnostics.Process]::Start($options);try{if(-not $installer.WaitForExit(120000)){throw 'Baseline installer did not finish'};if($installer.ExitCode -ne 0){throw 'Baseline installer failed'}}finally{$installer.Dispose()}`, { timeout: 150000 });
    check('Real current-user NSIS installs exact baseline version', (await executableVersion(executable)) === FROM.version + '.0');
    const registration = await registrations();
    check('Baseline registration uses only the owned installation directory', registration.length === 1 && registration[0].scope === 'CurrentUser' && path.resolve(registration[0].directory).toLowerCase() === install.toLowerCase());
    const archive = path.join(install, 'resources', 'app.asar');
    report.fromAsarSha256 = digest(archive);
    const actualUpdater = updaterFromArchive(archive), packedMetadata = JSON.parse(asar.extractFile(archive, 'package.json'));
    check('Exact installed 1.2.1 updater discovers real latest 1.2.2', packedMetadata.version === FROM.version && (await actualUpdater.readMetadata(fetch, FROM.version))?.sha256 === TO.sha256);
    check('Exact installed updater recognizes real same-version latest as already current', await actualUpdater.readMetadata(fetch, TO.version) === null);
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
    const declined = await accessibleAction(app.pid, executable, 'Not now', 'NerdSSHell ' + TO.version + ' is available. Upgrade now?');
    await delay(1000);
    check('Actual eligible fused 1.2.1 shows update and honors native-accessibility Not now', declined.invoked === 'Not now' && !app.ended && !app.launchError && (await executableVersion(executable)) === FROM.version + '.0');
    check('Actual Not now never creates an installer download stage', !fs.readdirSync(fs.realpathSync.native(os.tmpdir())).some(name => name.startsWith('nerdsshell-update-' + app.pid + '-')));
    await accessibleAction(app.pid, executable, 'close'); await until(() => app.ended, 'Declined baseline app did not exit normally.');
    app = trackApp(); const oldPid = app.pid;
    const approved = await accessibleAction(oldPid, executable, 'Upgrade', 'NerdSSHell ' + TO.version + ' is available. Upgrade now?');
    check('Actual eligible fused application receives explicit accessibility Upgrade approval', approved.invoked === 'Upgrade');
    let handoff;
    await until(() => {
      for (const name of fs.readdirSync(fs.realpathSync.native(os.tmpdir()))) {
        if (!name.startsWith('nerdsshell-update-' + oldPid + '-')) continue;
        const directory = path.join(fs.realpathSync.native(os.tmpdir()), name), manifest = path.join(directory, 'update-manifest.json');
        if (!fs.existsSync(manifest)) continue;
        try { const value = JSON.parse(fs.readFileSync(manifest, 'utf8'));
          if (value.parentPid !== oldPid || value.targetVersion !== TO.version) continue;
          const installer = path.join(directory, 'NerdSSHell-' + TO.version + '-x64-Setup.exe');
          if (fs.statSync(installer).size !== target.size || digest(installer) !== TO.sha256) continue;
          handoff = { sha256: value.sha256, size: value.size, targetVersion: value.targetVersion, parentPid: value.parentPid, originalExecutable: value.executablePath.toLowerCase() === executable.toLowerCase(), originalUserData: value.userDataDirectory.toLowerCase() === data.toLowerCase() }; return true;
        } catch {}
      } return false;
    }, 'Actual old application did not stage and arm the verified published update.', 600000);
    report.handoff = handoff;
    check('Actual updater downloads exact public installer and binds original app/profile/parent', handoff.sha256 === TO.sha256 && handoff.size === target.size && handoff.originalExecutable && handoff.originalUserData);
    await until(() => app.ended, 'Actual old app did not complete its normal updater quit.', 120000);
    await until(async () => { try { return await executableVersion(executable) === TO.version + '.0'; } catch { return false; } }, 'Real installer did not finish exact 1.2.2 installation.', 180000);
    await until(async () => { restarted = (await applications()).find(value => value.pid !== oldPid && value.executable.toLowerCase() === executable.toLowerCase()); return !!restarted; }, 'Actual helper did not restart the upgraded application.', 120000);
    report.restartedPid = restarted.pid;
    check('Real helper waits for old app exit, installs 1.2.2 and restarts actual application', app.ended && restarted.pid !== oldPid);
    const visible = await accessibleAction(restarted.pid, executable, 'inspect', 'Synthetic preserved connection');
    check('Restarted actual app uses its original synthetic saved connection', visible.names.some(name => name.startsWith('Synthetic preserved connection')));
    const after = JSON.parse(fs.readFileSync(store.file, 'utf8'));
    check('Upgrade preserves saved profiles, host pins, preferences and archive bytes', JSON.stringify(after.profiles) === JSON.stringify(original.profiles) && JSON.stringify(after.pins) === JSON.stringify(original.pins) && JSON.stringify(after.appearance) === JSON.stringify(original.appearance) && JSON.stringify(after.notifications) === JSON.stringify(original.notifications) && JSON.stringify(after.sessionDefaults) === JSON.stringify(original.sessionDefaults) && digest(sentinel) === sentinelHash);
    const updatedUpdater = updaterFromArchive(archive);
    check('Exact installed 1.2.2 updater recognizes real published latest as already current', await updatedUpdater.readMetadata(fetch, TO.version) === null);
    report.toAsarSha256 = digest(archive);
    await accessibleAction(restarted.pid, executable, 'close');
    await until(async () => (await applications()).length === 0, 'Owned upgraded app did not close normally.');
    check('All actual installed application processes close normally', (await applications()).length === 0);
    report.status = 'passed'; persist();
  } catch (error) {
    report.status = 'failed'; report.failure = error.message; persist(); throw error;
  } finally {
    // The VM is discarded. Never force-kill consumer applications or recursively
    // delete an installation/user profile to make an acceptance failure disappear.
    for (const ready of staged) { try { ready.cleanup(); } catch {} }
    for (const pid of new Set([app && !app.ended ? app.pid : null, restarted?.pid].filter(Boolean))) {
      try { await accessibleAction(pid, executable, 'close'); } catch {} // Only normal close requests, never forced termination.
    }
    report.disposableRunnerOnly = true; persist();
  }
}
module.exports = { hostedEnvironment, FROM, TO, updaterFromArchive };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
