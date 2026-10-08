'use strict';
// Owned Windows acceptance of update handoff, never a consumer installer.
// Registry/recovery enumeration is replaced only inside checksum-verified fixture
// execution. The installer and application are inert generated C# executables.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { armUpdate, bootstrap } = require('../src/update-handoff.cjs');
if (process.argv[2] === '--launch-probe-child') {
  (async () => {
    assert.ok(process.argv.length===4||process.argv.length===5);
    const strategy=process.argv[4]||'direct';assert.ok(['direct','broker'].includes(strategy));
    const marker = process.argv[3], directory = path.dirname(marker), fixtureRoot = path.dirname(directory), tempRoot = fs.realpathSync.native(os.tmpdir());
    assert.ok(path.isAbsolute(marker) && path.basename(marker) === 'probe.marker' && path.basename(directory) === 'child-independence' && path.basename(fixtureRoot).startsWith('nerdsshell-update-fixture-') && path.dirname(fs.realpathSync.native(fixtureRoot)).toLowerCase() === tempRoot.toLowerCase() && !fs.lstatSync(directory).isSymbolicLink(), 'Probe output belongs to the calling owned fixture.');
    const quote = value => "'" + value.replaceAll("'", "''") + "'";
    const probeCode = "$ErrorActionPreference='Stop';$p=[Diagnostics.Process]::GetProcessById(" + process.pid + ");$held=$p.Handle;$start=$p.StartTime.ToUniversalTime().Ticks;[Console]::Out.WriteLine('PROBE_READY');[Console]::Out.Flush();if(-not $p.WaitForExit(10000)){throw 'Owned parent did not exit'};if(-not $p.HasExited){throw 'Owned parent still alive'};[IO.File]::WriteAllText(" + quote(marker) + ",('{\"parentPid\":" + process.pid + ",\"parentExited\":true,\"helperPid\":'+$PID+',\"parentStartTicks\":\"'+$start+'\"}'));$p.Dispose()";
    const code = '[IO.File]::WriteAllText(' + quote(marker + '.trace') + ',"started");try{' + probeCode + ';[IO.File]::AppendAllText(' + quote(marker + '.trace') + ',";completed")}catch{[IO.File]::WriteAllText(' + quote(marker + '.error') + ',[string]$_);exit 1}';
    const executable = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    let launchCode=code,helperPid;
    if(strategy==='broker'){
      const ready=marker+'.runner-ready';
      const independent=code.replace("[Console]::Out.WriteLine('PROBE_READY');",()=>"[IO.File]::WriteAllText("+quote(ready)+",'ready');[Console]::Out.WriteLine('PROBE_READY');");
      launchCode="$ErrorActionPreference='Stop';$q=Start-Process -FilePath "+quote(executable)+" -ArgumentList "+quote('-NoLogo -NoProfile -NonInteractive -EncodedCommand '+Buffer.from(independent,'utf16le').toString('base64'))+" -WindowStyle Hidden -PassThru;try{$deadline=[DateTime]::UtcNow.AddSeconds(10);while(-not [IO.File]::Exists("+quote(ready)+")){if($q.HasExited){throw 'Owned grandchild exited before READY'};if([DateTime]::UtcNow -gt $deadline){throw 'Owned grandchild did not bind parent'};Start-Sleep -Milliseconds 25};[Console]::Out.WriteLine('PROBE_READY '+$q.Id);[Console]::Out.Flush()}finally{$q.Dispose()}";
    }
    const child = spawn(executable, ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(launchCode,'utf16le').toString('base64')], {detached:false,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe'],env:require('../src/powershell-environment.cjs').windowsPowerShellEnvironment()});
    child.stderr.resume(); child.stdin.on('error',()=>{});
    await new Promise((resolve,reject) => {
      let buffer = ''; const timer=setTimeout(()=>reject(new Error('Owned launch probe did not handshake.')),15000);
      child.once('error',error=>{clearTimeout(timer);reject(error)});
      child.once('exit',code=>{if(!buffer.includes('PROBE_READY')){clearTimeout(timer);reject(new Error('Owned launch probe exited before READY.'))}});
      child.stdout.on('data',bytes=>{buffer+=bytes;if(buffer.includes('PROBE_READY')){const match=/PROBE_READY (\d+)/.exec(buffer);helperPid=match?Number(match[1]):child.pid;clearTimeout(timer);resolve()}});
    });
    console.log('PROBE_HELPER ' + helperPid);
    if(strategy==='broker')console.log('PROBE_BROKER '+child.pid);
    child.unref(); child.stdin.unref?.(); child.stdout.unref?.(); child.stderr.unref?.();
  })().catch(error=>{console.error(error.message);process.exitCode=1});
} else {


const root = path.resolve(__dirname, '..'), temporaryRoot = fs.realpathSync.native(os.tmpdir());
const options = new Map();
let probeOnly=false,probeIgnore=false,probeBroker=true;
for (let index = 2; index < process.argv.length; index++) {
  const name = process.argv[index];
  if(name==='--probe-only'){probeOnly=true;probeBroker=false;continue;}
  if(name==='--probe-ignore'){probeIgnore=true;continue;}
  if(name==='--probe-broker'){probeBroker=true;probeOnly=true;continue;}
  const value = process.argv[++index];
  if (name !== '--output' || options.has(name) || !value || !path.isAbsolute(value)) throw new Error('Use --output once with an absolute path.');
  options.set(name, value);
}
const output = options.get('--output') || path.join(root, '.local', 'update-handoff');
const ownedRoot = fs.mkdtempSync(path.join(temporaryRoot, 'nerdsshell-update-fixture-'));
const ownedRootIdentity = fs.lstatSync(ownedRoot, { bigint: true });
const stages = [], processes = [], contexts = [];
const digest = filename => createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
const psquote = value => "'" + value.replaceAll("'", "''") + "'";
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const report = { status: 'running', platform: process.platform, architecture: process.arch, node: process.versions.node,
  ownedTemporaryRoot: ownedRoot, ownedRootIdentity:{dev:String(ownedRootIdentity.dev),ino:String(ownedRootIdentity.ino)}, scope: 'Native source update handoff and checksum-bound Windows PowerShell runner with generated inert EXEs. Fixture-only registration/recovery enumeration and owned-process enumeration replace those dependencies. No actual NSIS installation, UAC, registry operation, installed app or real user data.', checks: [], cases: [], registryReads: 0, registryWrites: 0, processKills: 0 };
fs.mkdirSync(output, { recursive: true });
const persist = () => fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
function check(name, value = true) {
  if (value !== true) { const error = new Error('Owned fixture assertion failed.'); error.fixtureStep = name; throw error; }
  report.checks.push(name); persist(); console.log(name);
}
async function until(predicate, name, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; await delay(25); }
  const error = new Error('Owned fixture wait failed.'); error.fixtureStep = name; throw error;
}
function track(executable, args, options) {
  const child = spawn(executable, args, { cwd: root, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'], ...options });
  const owner = { child, executable: fs.realpathSync.native(executable), exited: false, code: null, stdout: '', stderr: '', events: [] };
  processes.push(owner);
  child.stdout.on('data', bytes => { if (owner.stdout.length < 32768) owner.stdout += bytes; });
  child.stderr.on('data', bytes => { if (owner.stderr.length < 32768) owner.stderr += bytes; });
  child.stdin.on('error', error => owner.events.push('stdin:' + error.code));
  child.stdout.on('error', error => owner.events.push('stdout:' + error.code));
  child.stderr.on('error', error => owner.events.push('stderr:' + error.code));
  child.once('error', error => { owner.error = error.code; owner.events.push('child:' + error.code); });
  child.once('close', code => { owner.exited = true; owner.code = code; });
  return owner;
}
async function compile(source, executable) {
  const file = executable + '.cs'; fs.writeFileSync(file, source);
  const compiler = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  assert.ok(fs.existsSync(compiler), 'The native fixture requires the Windows .NET compiler.');
  const owner = track(compiler, ['/nologo', '/target:winexe', '/platform:x64', '/out:' + executable, file]);
  await until(() => owner.exited, 'Inert native fixture compiler completes');
  if (owner.code !== 0) { const error = new Error('Inert fixture compilation failed.'); error.fixtureStep = 'Native fixture compilation'; error.fixtureDiagnostics = owner.stdout + owner.stderr; throw error; }
  fs.unlinkSync(file);
}
function appSource(version) {
  return [
    'using System; using System.IO; using System.Collections.Generic; using System.Reflection;',
    '[assembly:AssemblyProduct("NerdSSHell")]',
    '[assembly:AssemblyVersion("' + version + '.0")]',
    '[assembly:AssemblyFileVersion("' + version + '.0")]',
    '[assembly:AssemblyInformationalVersion("' + version + '")]',
    'class FixtureApplication {',
    ' [STAThread] public static int Main(string[] args) {',
    '  if(args.Length==1 && args[0]=="--fixture-parent") {',
    '   Console.Out.WriteLine("FIXTURE READY"); Console.Out.Flush();',
    '   var read=System.Threading.Tasks.Task.Factory.StartNew(()=>Console.In.ReadLine()); read.Wait(90000); return 0;',
    '  }',
    '  var lines=new List<string>(); lines.Add("VERSION:' + version + '"); lines.Add("COUNT:"+args.Length);',
    '  lines.Add("PID:"+System.Diagnostics.Process.GetCurrentProcess().Id); lines.Add("RAW:"+Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(Environment.CommandLine)));',
    '  foreach(var arg in args) lines.Add("ARG:"+Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(arg)));',
    '  string log=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"restart.log"); File.WriteAllLines(log+".tmp",lines.ToArray()); File.Move(log+".tmp",log); return 0;',
    ' }',
    '}'
  ].join('\n');
}
function installerSource(context, replacement, mode) {
  return [
    'using System; using System.IO; using System.Diagnostics; using System.Collections.Generic;',
    'class FixtureInstaller { [STAThread] public static int Main(string[] args) { try {',
    ' string expected=' + JSON.stringify(context.installDirectory) + ', replacement=' + JSON.stringify(replacement) + ', log=' + JSON.stringify(context.installLog) + ';',
    ' string raw=Environment.CommandLine; int at=raw.LastIndexOf(" /D=",StringComparison.Ordinal); if(at<0)return 81; string directory=raw.Substring(at+4);',
    ' bool parentAlive=false; try {using(var p=Process.GetProcessById(' + context.parent.child.pid + ')){parentAlive=!p.HasExited;}} catch(ArgumentException) {}',
    ' var lines=new List<string>(); lines.Add("PARENTALIVE:"+parentAlive); lines.Add("DIRECTORY:"+Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(directory)));',
    ' lines.Add("RAW:"+Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(raw))); foreach(var arg in args)lines.Add("ARG:"+Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(arg))); File.WriteAllLines(log,lines.ToArray());',
    ' if(parentAlive||directory!=expected)return 82;',
    ' if(' + JSON.stringify(mode) + '=="error")return 23; if(' + JSON.stringify(mode) + '=="unchanged")return 0;',
    ' string executable=Path.Combine(directory,"NerdSSHell.exe"), temporary=executable+".fixture-next"; File.Copy(replacement,temporary,true); File.Replace(temporary,executable,null); return 0;',
    '} catch(Exception error){File.WriteAllText('+JSON.stringify(context.installLog+'.error')+',error.GetType().Name+": "+error.Message);return 73;} } }'
  ].join('\n');
}
async function parent(executable) {
  const owner = track(executable, ['--fixture-parent']);
  await until(() => owner.stdout.includes('FIXTURE READY') || owner.exited, 'Inert parent becomes ready');
  assert.ok(!owner.exited && owner.stdout.includes('FIXTURE READY'), 'The fixture parent must remain alive.');
  return owner;
}
async function exitParent(owner) {
  if (!owner.exited) { owner.child.stdin.end('EXIT\n'); await until(() => owner.exited, 'Owned inert parent exits voluntarily'); }
}
function readLog(filename) {
  if (!fs.existsSync(filename)) return null;
  const lines = fs.readFileSync(filename, 'utf8').trim().split(/\r?\n/), result = { arguments: [] };
  for (const line of lines) {
    const at = line.indexOf(':'), name = line.slice(0, at), value = line.slice(at + 1);
    if (name === 'ARG') result.arguments.push(Buffer.from(value, 'base64').toString('utf8'));
    else result[name] = ['RAW', 'DIRECTORY'].includes(name) ? Buffer.from(value, 'base64').toString('utf8') : value;
  }
  return result;
}
async function fixtureContext(name, scope, binaries, mode = 'success') {
  const caseDirectory = path.join(ownedRoot, name), installDirectory = path.join(caseDirectory, 'Installation with spaces');
  const dataDirectory = path.join(caseDirectory, 'Preserved user data with spaces');
  fs.mkdirSync(installDirectory, { recursive: true }); fs.mkdirSync(dataDirectory);
  const executable = path.join(installDirectory, 'NerdSSHell.exe'); fs.copyFileSync(binaries.old, executable);
  const sentinel = path.join(dataDirectory, 'owned-sentinel.dat'); fs.writeFileSync(sentinel, 'SYNTHETIC USERDATA SENTINEL ' + name);
  const payload = path.join(installDirectory, 'fixture-recovery-payload.dat'); fs.writeFileSync(payload, 'SYNTHETIC PROGRAM PAYLOAD');
  const stageDirectory = fs.mkdtempSync(path.join(temporaryRoot, 'nerdsshell-update-')), stageStat = fs.lstatSync(stageDirectory, { bigint: true });
  stages.push({ directory: stageDirectory, dev: stageStat.dev, ino: stageStat.ino });
  const context = { name, scope, caseDirectory, installDirectory, dataDirectory, executable, sentinel, payload, stageDirectory,
    parent: await parent(executable), installLog: path.join(caseDirectory, 'installer.log'), restartLog: path.join(installDirectory, 'restart.log'),
    statusPath: path.join(caseDirectory, 'runner-status.txt'), registrationPath: path.join(caseDirectory, 'registration.json'), processPath: path.join(caseDirectory, 'owned-processes.json'),
    oldHash: digest(executable), sentinelHash: digest(sentinel), helper: null };
  contexts.push(context);
  fs.writeFileSync(context.registrationPath, JSON.stringify([{ directory: installDirectory, scope }]));
  fs.writeFileSync(context.processPath, JSON.stringify([{ pid: context.parent.child.pid, executable }]));
  const installerPath = path.join(stageDirectory, 'NerdSSHell-1.0.1-x64-Setup.exe');
  await compile(installerSource(context, mode === 'wrong-version' ? binaries.wrong : binaries.next, mode), installerPath);
  context.plan = { stageDirectory, installerPath, size: fs.statSync(installerPath).size, sha256: digest(installerPath), targetVersion: '1.0.1', executablePath: executable, userDataDirectory: dataDirectory, parentPid: context.parent.child.pid };
  return context;
}
function dependencies(context, mutation) {
  return { startupMs: 20000, commandMs: context.nodeCommandMs || 5000, execute(executable, args, options) {
    assert.equal(path.basename(executable).toLowerCase(), 'powershell.exe');
    const at = args.indexOf('-EncodedCommand'); assert.ok(at >= 0 && at + 1 === args.length - 1);
    const original = Buffer.from(args[at + 1], 'base64').toString('utf16le');
    const runner = path.join(context.stageDirectory, 'update-runner.ps1'), manifest = path.join(context.stageDirectory, 'update-manifest.json');
    const expected = bootstrap(runner, manifest, digest(runner), digest(manifest));
    assert.equal(original, expected, 'Execute seam starts with the exact checksum-bound production bootstrap.');
    const manifestValue = JSON.parse(fs.readFileSync(manifest, 'utf8')); context.nonce = manifestValue.nonce;
    const fixtureFunctions = [
      'function Get-UpdateRegistrations { return @(ConvertFrom-Json ([IO.File]::ReadAllText(' + psquote(context.registrationPath) + '))) }',
      'function Get-UpdateRecoveryFiles([string]$Directory) { if(-not (Same-UpdatePath $Directory ' + psquote(context.installDirectory) + ')){throw "Wrong fixture directory"}; return @(' + psquote(context.executable) + ',' + psquote(context.payload) + ') }',
      'function Assert-NoUpdateInstances { foreach($entry in @(ConvertFrom-Json ([IO.File]::ReadAllText(' + psquote(context.processPath) + ')))) {$p=$null;try{$p=[Diagnostics.Process]::GetProcessById([int]$entry.pid)}catch [ArgumentException]{continue};try{if(-not $p.HasExited){if(-not (Same-UpdatePath $p.MainModule.FileName $entry.executable)){throw "Fixture process identity changed"};throw "Application still running"}}finally{if($null -ne $p){$p.Dispose()}}} }'
    ].join(';');
    const marker='$result=Invoke-UpdateBroker';
    assert.equal(original.split(marker).length,2,'Production bootstrap has one fixed broker entry.');
    const workerMarker='$result=Invoke-UpdateRunner',fixturesBase64=Buffer.from(fixtureFunctions,'utf8').toString('base64');
    const workerSuffix=' -CommandTimeoutMs '+(context.commandTimeoutMs||5000)+' -ParentTimeoutMs '+(context.parentTimeoutMs||5000)+' -InstallerTimeoutMs 10000;[IO.File]::WriteAllText('+psquote(context.statusPath)+',[string]$result);[IO.File]::WriteAllText('+psquote(context.statusPath+'.workerpid')+',[string]$PID);if($Error.Count){[IO.File]::WriteAllText('+psquote(context.statusPath+'.diagnostics')+',[string]$Error[0])};';
    const delayFixture=context.cancelDelayMs ? '$script:OwnedFixtureReadMarker=(Get-Command Read-UpdateMarker).ScriptBlock;$script:OwnedFixtureCancelDelay=$null;function Read-UpdateMarker([string]$Kind,[string]$Nonce){if($Kind -ceq "CANCEL" -and [IO.File]::Exists('+psquote(path.join(context.stageDirectory,'update-cancel'))+')){if($null -eq $script:OwnedFixtureCancelDelay){$script:OwnedFixtureCancelDelay=[DateTime]::UtcNow.AddMilliseconds('+context.cancelDelayMs+')};if([DateTime]::UtcNow -lt $script:OwnedFixtureCancelDelay){return $false}};return & $script:OwnedFixtureReadMarker $Kind $Nonce};' : '';
    const factory=[
      '$script:OwnedFixtureWorkerFactory=(Get-Command New-UpdateWorkerBootstrap).ScriptBlock',
      'function New-UpdateWorkerBootstrap([string]$Runner,[string]$RunnerSha256,[string]$Path,[string]$ManifestSha256,[int]$BrokerPid,[string]$Nonce) {'+
      '[IO.File]::WriteAllText('+psquote(context.statusPath+'.factory')+',"created");$code=& $script:OwnedFixtureWorkerFactory $Runner $RunnerSha256 $Path $ManifestSha256 $BrokerPid $Nonce;'+
      '$prefix=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('+psquote(fixturesBase64)+'));$prefix='+psquote(delayFixture)+'+$prefix;$marker='+psquote(workerMarker)+';'+
      '$at=$code.IndexOf($marker,[StringComparison]::Ordinal);if($at -lt 0 -or $code.LastIndexOf($marker,[StringComparison]::Ordinal) -ne $at){throw "Wrong fixed worker entry"};'+
      '$code=$code.Insert($at,$prefix+";");$at+=$prefix.Length+1;$end=$code.IndexOf(";",$at);if($end -lt 0){throw "Wrong fixed worker end"};'+
      'return $code.Substring(0,$end)+'+psquote(workerSuffix)+'+$code.Substring($end+1)}'
    ].join(';');
    // Test-only dependencies enter the independently launched worker after its
    // source verification, preserving actual broker/file IPC and fixed checks.
    const exitBroker=context.exitBrokerAfterGo ? '$script:OwnedFixtureConsoleProtocol=(Get-Command Write-UpdateConsoleProtocol).ScriptBlock;function Write-UpdateConsoleProtocol([string]$Line){& $script:OwnedFixtureConsoleProtocol $Line;if($Line.StartsWith("GO ")){[Console]::Out.Flush();exit 0}};' : '';
    let fixtureBootstrap=original.replace(marker,()=>fixtureFunctions+';'+factory+';'+exitBroker+marker);
    if (mutation) mutation(context, manifest);
    fs.writeFileSync(path.join(output, 'latest-owned-fixture-bootstrap.txt'), fixtureBootstrap);
    const fixtureArgs = [...args]; fixtureArgs[at + 1] = Buffer.from(fixtureBootstrap, 'utf16le').toString('base64');
    const owner = track(executable, fixtureArgs, options); context.helper = owner;
    return owner.child;
  } };
}
async function prepared(context, mutation) {
  const task = await armUpdate(context.plan, dependencies(context, mutation)); context.task=task;
  check(context.name + ': native READY bound the real inert parent and held verified files', context.parent.exited === false && !fs.existsSync(context.installLog));
  return task;
}
async function workerFinished(context) {
  if(!fs.existsSync(context.statusPath+'.factory'))return;
  await until(()=>fs.existsSync(context.statusPath+'.workerpid'),context.name+': independent worker records completed status');
  const pid=Number(fs.readFileSync(context.statusPath+'.workerpid','utf8'));
  await until(()=>{try{process.kill(pid,0);return false}catch(e){if(e.code==='ESRCH')return true;throw e}},context.name+': independent worker exits naturally');context.workerExited=true;
}
async function completed(context) {
  await until(() => context.helper.exited, context.name + ': helper exits');
  await until(()=>fs.existsSync(context.statusPath),context.name+': independent worker finishes native operation');
  await until(()=>fs.existsSync(context.statusPath+'.workerpid'),context.name+': independent worker records its actual PID');
  if(context.task && !context.parent.exited && ['cancelled','refused'].includes(fs.readFileSync(context.statusPath,'utf8'))) await context.task.cancel();
  if(fs.existsSync(context.statusPath+'.workerpid')){const pid=Number(fs.readFileSync(context.statusPath+'.workerpid','utf8'));await until(()=>{try{process.kill(pid,0);return false}catch(e){if(e.code==='ESRCH')return true;throw e}},context.name+': owned independent worker exits naturally');context.workerExited=true;}
  const status = fs.existsSync(context.statusPath) ? fs.readFileSync(context.statusPath, 'utf8') : null;
  report.cases.push({ name: context.name, status, helperExitCode: context.helper.code, installerExecuted: fs.existsSync(context.installLog), restartExecuted: fs.existsSync(context.restartLog), stageRemovedByProduction: !fs.existsSync(context.stageDirectory) });
  check(context.name + ': source removes its exact owned stage', !fs.existsSync(context.stageDirectory));
  check(context.name + ': separate owned user-data sentinel remains unchanged', digest(context.sentinel) === context.sentinelHash);
  return status;
}
function checkInstaller(context) {
  const log = readLog(context.installLog);
  check(context.name + ': installer starts only after the actual parent has exited', log && log.PARENTALIVE === 'False' && context.parent.exited);
  check(context.name + ': final raw unquoted /D preserves the exact path with spaces', log && log.DIRECTORY === context.installDirectory && log.RAW.endsWith(' /D=' + context.installDirectory));
  check(context.name + ': exact silent install and ownership-scope flags are preserved', log && log.arguments[0] === '/S' && log.arguments[1] === '/' + context.scope && log.arguments[2].startsWith('/D='));
}
async function checkRestart(context, version) {
  await until(() => fs.existsSync(context.restartLog), context.name + ': inert restarted app logs args');
  const log = readLog(context.restartLog);
  await until(()=>{try{process.kill(Number(log.PID),0);return false}catch(e){if(e.code==='ESRCH')return true;throw e}},context.name+': inert restarted application exits naturally');
  check(context.name + ': verified app version restarts with the exact original argument selection', log.VERSION === version && JSON.stringify(log.arguments) === JSON.stringify(context.defaultUserData ? [] : ['--user-data-dir=' + context.dataDirectory]));
}
async function main() {
  if (process.platform !== 'win32') throw new Error('This source acceptance harness requires Windows.');
  if(probeIgnore){
    const marker=path.join(ownedRoot,'detached-ignore.marker'),executable=path.win32.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const code='[IO.File]::WriteAllText('+psquote(marker)+',"owned-ignore-probe");exit 19';
    const child=spawn(executable,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{detached:true,windowsHide:true,shell:false,stdio:'ignore',env:require('../src/powershell-environment.cjs').windowsPowerShellEnvironment()}),owner={child,executable:fs.realpathSync.native(executable),exited:false};processes.push(owner);child.once('close',code=>{owner.exited=true;owner.code=code});
    await until(()=>owner.exited,'Detached ignored-stdio PowerShell probe exits naturally');
    report.detachedIgnoreProbe={detached:true,windowsHide:true,stdio:'ignore',markerExists:fs.existsSync(marker),exitCode:owner.code};report.status='measured';persist();console.log(JSON.stringify(report.detachedIgnoreProbe));return;
  }
  report.sourceHashes = { handoff: digest(path.join(root, 'src', 'update-handoff.cjs')), runner: digest(path.join(root, 'src', 'update-runner.ps1')) };
  {
    const folder=path.join(ownedRoot,'child-independence');fs.mkdirSync(folder);
    const marker=path.join(folder,'probe.marker'), supervisor=track(process.execPath,[__filename,'--launch-probe-child',marker,probeBroker?'broker':'direct']);
    await until(()=>supervisor.exited,'Owned Node probe parent exits after unref');
    report.probeSupervisor={code:supervisor.code,stdout:supervisor.stdout,stderr:supervisor.stderr};persist();
    check('Owned Node probe parent completes its redirected-stdio handshake before exiting',supervisor.code===0&&supervisor.stdout.includes('PROBE_HELPER '));
    await until(()=>fs.existsSync(marker),'Unreferenced redirected-stdio helper survives parent exit');
    const proof=JSON.parse(fs.readFileSync(marker,'utf8'));
    check(probeBroker?'Hidden Start-Process worker outlives its real Node parent after the broker handshake':'Direct non-detached helper outlives its real Node parent after unref',supervisor.code===0&&proof.parentPid===supervisor.child.pid&&proof.parentExited===true&&supervisor.stdout.includes('PROBE_HELPER '+proof.helperPid));
    await until(()=>{try{process.kill(proof.helperPid,0);return false}catch(e){if(e.code==='ESRCH')return true;throw e}},'Owned launch probe helper exits naturally');
    report.launchIndependence={parentExited:true,helperExited:true,broker:probeBroker,detached:false,windowsHide:true,parentStartTicks:proof.parentStartTicks};
  }
  if(probeOnly){report.scope='Owned Node/PowerShell launch/lifetime probe only; a hidden Start-Process grandchild binds the real Node parent handle and confirms its exit. No app, installer, registry or user-data operation.';report.status='passed';persist();console.log('Owned helper launch independence probe passed.');return;}
  const binaries = {};
  for (const [name, version] of [['old', '1.0.0'], ['next', '1.0.1'], ['wrong', '1.0.2']]) {
    const folder = path.join(ownedRoot, 'binaries', name); fs.mkdirSync(folder, { recursive: true });
    binaries[name] = path.join(folder, 'NerdSSHell.exe'); await compile(appSource(version), binaries[name]);
  }
  check('Three inert native app fixtures compile with actual NerdSSHell version resources');
  for (const afterGo of [false, true]) {
    const context = await fixtureContext(afterGo ? 'cancel-after-go' : 'cancel-before-go', 'currentuser', binaries);
    const task = await prepared(context);
    if (afterGo) { await task.release(); await delay(100); check(context.name + ': GO waits without executing while parent is alive', !context.parent.exited && !fs.existsSync(context.installLog)); }
    await task.cancel();
    check(context.name + ': cancellation never terminates the original parent', !context.parent.exited);
    check(context.name + ': no installer or restart executes on cancellation', !fs.existsSync(context.installLog) && !fs.existsSync(context.restartLog));
    check(context.name + ': native cancellation reports success', await completed(context) === 'cancelled');
    await exitParent(context.parent);
  }
  for (const parentTimeout of [false, true]) {
    const context = await fixtureContext(parentTimeout ? 'bounded-parent-timeout' : 'bounded-command-timeout', 'currentuser', binaries);
    context.commandTimeoutMs = 1000; context.parentTimeoutMs = 1000;
    const task = await prepared(context), began = Date.now();
    if (parentTimeout) await task.release();
    const status = await completed(context), elapsed = Date.now() - began;
    check(context.name + ': native wait is bounded while original parent stays alive', status === 'refused' && elapsed >= 500 && elapsed < 10000 && !context.parent.exited && !fs.existsSync(context.installLog) && !fs.existsSync(context.restartLog));
    await task.cancel(); await exitParent(context.parent);
  }
  {
    const context=await fixtureContext('cancel-after-broker-exit','currentuser',binaries);context.exitBrokerAfterGo=true;
    const task=await prepared(context);await task.release();await until(()=>context.helper.exited,'Owned broker voluntarily exits after GO while parent lives');
    const started=Date.now();await task.cancel();await exitParent(context.parent);
    check(context.name+': independent cancellation stops the armed worker before an immediate parent exit',Date.now()-started<5000&&!fs.existsSync(context.installLog)&&!fs.existsSync(context.restartLog));
    check(context.name+': worker reports cancelled and source stage is cleaned',await completed(context)==='cancelled');
  }
  {
    const context=await fixtureContext('delayed-cancellation-read','currentuser',binaries);context.cancelDelayMs=12000;context.commandTimeoutMs=30000;context.parentTimeoutMs=30000;context.nodeCommandMs=30000;
    const task=await prepared(context);await task.release();let completedCancel=false,cancelError=null;
    const cancellation=task.cancel().then(()=>{completedCancel=true},error=>{cancelError=error;completedCancel=true});
    await until(()=>fs.existsSync(path.join(context.stageDirectory,'update-cancel')),'Source writes cancellation marker');await delay(10500);
    check(context.name+': original Cancel persists past broker wait bound while worker is still armed',fs.existsSync(path.join(context.stageDirectory,'update-cancel'))&&!context.parent.exited&&!fs.existsSync(context.installLog)&&!fs.existsSync(context.restartLog));
    await cancellation;const status=await completed(context);
    check(context.name+': delayed worker stops without installation or restart',completedCancel&&!cancelError&&status==='cancelled'&&!fs.existsSync(context.installLog)&&!fs.existsSync(context.restartLog));
    context.cancelAcknowledged=!cancelError;await exitParent(context.parent);
  }
  {
    const context=await fixtureContext('cancel-timeout-retry','currentuser',binaries);context.cancelDelayMs=6000;context.commandTimeoutMs=30000;context.parentTimeoutMs=30000;context.nodeCommandMs=1000;
    const task=await prepared(context);await task.release();let rejected=false;try{await task.cancel()}catch{rejected=true}
    check(context.name+': unconfirmed bounded cancellation rejects and preserves Cancel/installer while parent lives',rejected&&!context.parent.exited&&fs.existsSync(path.join(context.stageDirectory,'update-cancel'))&&fs.existsSync(context.plan.installerPath)&&!fs.existsSync(context.installLog)&&!fs.existsSync(context.restartLog));
    let releaseRefused=false;try{await task.release()}catch{releaseRefused=true}check(context.name+': cancellation timeout cannot rearm release',releaseRefused);
    await until(()=>fs.existsSync(context.statusPath),'Delayed native worker records stop before retry');await task.cancel();
    check(context.name+': later retry confirms positive stopped state and cleans source-owned stage',await completed(context)==='cancelled'&&!fs.existsSync(context.installLog)&&!fs.existsSync(context.restartLog));await exitParent(context.parent);
  }
  for (const scope of ['currentuser', 'allusers']) {
    const context = await fixtureContext('success-' + scope, scope, binaries), task = await prepared(context);
    await task.release(); await delay(100);
    check(context.name + ': acknowledged GO does not install before original process exit', !fs.existsSync(context.installLog));
    await exitParent(context.parent);
    check(context.name + ': native runner reports an updated target', await completed(context) === 'updated');
    checkInstaller(context); await checkRestart(context, '1.0.1');
  }
  {
    const context=await fixtureContext('success-default-userdata','currentuser',binaries);context.defaultUserData=true;delete context.plan.userDataDirectory;
    const task=await prepared(context);await task.release();await exitParent(context.parent);
    check(context.name+': default data selection is preserved without inventing an override',await completed(context)==='updated');checkInstaller(context);await checkRestart(context,'1.0.1');
  }
  for (const mode of ['error', 'unchanged', 'wrong-version']) {
    const context = await fixtureContext('installer-' + mode, 'currentuser', binaries, mode), task = await prepared(context);
    await task.release(); await exitParent(context.parent);
    const status = await completed(context); checkInstaller(context);
    if (mode === 'wrong-version') {
      check(context.name + ': mismatched modified target is refused without unsafe restart', status === 'refused' && !fs.existsSync(context.restartLog) && digest(context.executable) !== context.oldHash);
    } else {
      check(context.name + ': unchanged known old payload receives a safe recovery restart', status === 'restored' && digest(context.executable) === context.oldHash);
      await checkRestart(context, '1.0.0');
    }
  }
  {
    const context = await fixtureContext('reopened-instance', 'currentuser', binaries), task = await prepared(context);
    await task.release();
    const reopened = await parent(context.executable);
    fs.writeFileSync(context.processPath, JSON.stringify([{ pid: context.parent.child.pid, executable: context.executable }, { pid: reopened.child.pid, executable: context.executable }]));
    await exitParent(context.parent);
    check(context.name + ': a newly reopened owned instance blocks install and recovery restart', await completed(context) === 'refused' && !fs.existsSync(context.installLog) && !fs.existsSync(context.restartLog) && !reopened.exited);
    await exitParent(reopened);
  }
  {
    const context = await fixtureContext('registration-change', 'currentuser', binaries), task = await prepared(context);
    await task.release(); fs.writeFileSync(context.registrationPath, JSON.stringify([{ directory: context.installDirectory, scope: 'allusers' }]));
    await exitParent(context.parent);
    check(context.name + ': changed ownership scope is refused without installation or restart', await completed(context) === 'refused' && !fs.existsSync(context.installLog) && !fs.existsSync(context.restartLog));
  }
  {
    const context = await fixtureContext('recovery-payload-change', 'currentuser', binaries), task = await prepared(context);
    await task.release(); fs.writeFileSync(context.payload, 'SYNTHETIC CHANGED PROGRAM PAYLOAD');
    await exitParent(context.parent);
    check(context.name + ': changed known program payload is refused without installation or restart', await completed(context) === 'refused' && !fs.existsSync(context.installLog) && !fs.existsSync(context.restartLog));
  }
  {
    const context=await fixtureContext('conflicting-registrations','allusers',binaries),other=path.join(context.caseDirectory,'Distinct owned current-user install');fs.mkdirSync(other);
    fs.writeFileSync(context.registrationPath,JSON.stringify([{directory:context.installDirectory,scope:'allusers'},{directory:other,scope:'currentuser'}]));
    let refused=false,task;try{task=await armUpdate(context.plan,dependencies(context))}catch{refused=true}
    if(task)await task.cancel();if(context.helper){await until(()=>context.helper.exited,'Conflicting-registration helper exits');await workerFinished(context);}
    check(context.name+': distinct user/machine registrations are refused before READY',refused&&!fs.existsSync(context.installLog)&&!fs.existsSync(context.restartLog)&&!context.parent.exited);
    check(context.name+': owned user-data sentinel remains unchanged',digest(context.sentinel)===context.sentinelHash);await exitParent(context.parent);
  }
  for (const kind of ['node-hash-refusal','native-hash-refusal','native-file-replacement','native-manifest-replacement']) {
    const context=await fixtureContext(kind,'currentuser',binaries);
    const native=kind!=='node-hash-refusal',replacement=kind.endsWith('replacement');
    const tamper=(_context,manifest)=>{
      const file=kind==='native-manifest-replacement'?manifest:context.plan.installerPath;
      const bytes=fs.readFileSync(file);
      if(replacement){const temporary=file+'.owned-replacement';fs.writeFileSync(temporary,bytes,{flag:'wx'});fs.renameSync(temporary,file);}
      else{bytes[bytes.length-1]^=1;fs.writeFileSync(file,bytes);}
    };
    if(!native)tamper();
    let refused=false;
    try{await armUpdate(context.plan,dependencies(context,native?tamper:undefined));}catch{refused=true;}
    if(context.helper){await until(()=>context.helper.exited,'Native refused helper exits');await workerFinished(context);}
    check(context.name+': changed hash or equal-byte replaced identity is refused without install/restart',refused&&!fs.existsSync(context.installLog)&&!fs.existsSync(context.restartLog)&&!context.parent.exited);
    check(context.name+': owned user-data sentinel stays unchanged',digest(context.sentinel)===context.sentinelHash);
    if(replacement)check(context.name+': unowned replacement file and stage are deliberately retained',fs.existsSync(context.stageDirectory)&&fs.existsSync(kind==='native-manifest-replacement'?path.join(context.stageDirectory,'update-manifest.json'):context.plan.installerPath));
    else if(native){report.nativeHashRefusalRemainingFiles=fs.existsSync(context.stageDirectory)?fs.readdirSync(context.stageDirectory):[];persist();check(context.name+': failed preparation removes only its owned stage',!fs.existsSync(context.stageDirectory));}
    await exitParent(context.parent);
  }
  check('The entire acceptance avoids OS registry operations, real app instances and process kills', report.registryReads === 0 && report.registryWrites === 0 && report.processKills === 0);
  check('Validated handoff and runner source bytes remain unchanged throughout acceptance', report.sourceHashes.handoff === digest(path.join(root, 'src', 'update-handoff.cjs')) && report.sourceHashes.runner === digest(path.join(root, 'src', 'update-runner.ps1')));
  report.status = 'passed'; persist(); console.log('Update handoff acceptance passed (' + report.checks.length + ' checks).');
}
function safeRemove(directory, expected) {
  if (!fs.existsSync(directory)) return;
  const actual = fs.realpathSync.native(directory), current = fs.lstatSync(directory, { bigint: true });
  assert.ok(path.dirname(actual).toLowerCase() === temporaryRoot.toLowerCase() && path.basename(actual).startsWith('nerdsshell-update-') && !current.isSymbolicLink() && current.dev === expected.dev && current.ino === expected.ino, 'Fixture cleanup requires its exact owned direct temporary child.');
  fs.rmSync(actual, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 });
}
async function cleanup() {
  for (const context of contexts) {
    if(context.task && !context.parent.exited && context.helper && !context.helper.exited) try{await context.task.cancel()}catch{}
    if (context.helper && !context.helper.exited) { try { context.helper.child.stdin.end('CANCEL ' + context.nonce + '\n'); } catch {} }
    if(context.helper) await until(()=>context.helper.exited,'Owned broker completes cleanup before fixture removal');
    if(fs.existsSync(context.statusPath+'.factory')){await until(()=>fs.existsSync(context.statusPath+'.workerpid'),'Owned worker completes before fixture removal');const pid=Number(fs.readFileSync(context.statusPath+'.workerpid','utf8'));await until(()=>{try{process.kill(pid,0);return false}catch(e){if(e.code==='ESRCH')return true;throw e}},'Owned independent worker exits before fixture removal');}
    try { await exitParent(context.parent); } catch {}
  }
  // Additional inert fixture parents are identified by their recorded child pipe.
  for (const owner of processes) if (!owner.exited && path.basename(owner.executable).toLowerCase() === 'nerdsshell.exe') try { await exitParent(owner); } catch {}
  await until(() => processes.every(owner => owner.exited), 'All owned fixture processes exit naturally', 95000);
  if(report.status==='failed' && contexts.at(-1)?.helper){const h=contexts.at(-1).helper;report.failure.helper={code:h.code,exited:h.exited,error:h.error,stdout:h.stdout,stderr:h.stderr,events:h.events};const c=contexts.at(-1);if(fs.existsSync(c.statusPath))report.failure.nativeStatus=fs.readFileSync(c.statusPath,'utf8');if(fs.existsSync(c.statusPath+'.diagnostics'))report.failure.ownedNativeDiagnostic=fs.readFileSync(c.statusPath+'.diagnostics','utf8');}
  for (const stage of stages) safeRemove(stage.directory, stage);
  if(report.status==='failed'){for(const extension of ['trace','error']){const probeFile=path.join(ownedRoot,'child-independence','probe.marker.'+extension);if(fs.existsSync(probeFile))report.failure['probe'+extension]=fs.readFileSync(probeFile,'utf8');}}
  safeRemove(ownedRoot, { dev: ownedRootIdentity.dev, ino: ownedRootIdentity.ino });
  if(report.status==='failed' && fs.existsSync(path.join(ownedRoot,'child-independence','probe.marker.error'))) report.failure.probeError=fs.readFileSync(path.join(ownedRoot,'child-independence','probe.marker.error'),'utf8');
  report.allOwnedProcessesExited = true; report.allOwnedTemporaryDirectoriesRemoved = true;
  report.ownedProcessCount = processes.length; persist();
}
main().catch(error => {
  report.status = 'failed'; report.failure = { step: error.fixtureStep || null, type: error.name, message:error.message, code: error.code || null };
  if (error.fixtureDiagnostics) report.failure.ownedCompilerDiagnostics = error.fixtureDiagnostics;
  const recent = contexts.at(-1);
  if (recent?.helper) report.failure.helper = {code:recent.helper.code,exited:recent.helper.exited,error:recent.helper.error,stdout:recent.helper.stdout,stderr:recent.helper.stderr};
  if (recent && fs.existsSync(recent.statusPath)) report.failure.nativeStatus = fs.readFileSync(recent.statusPath, 'utf8');
  if (recent && fs.existsSync(recent.statusPath + '.diagnostics')) report.failure.ownedNativeDiagnostic = fs.readFileSync(recent.statusPath + '.diagnostics', 'utf8');
  persist(); console.error('Update handoff acceptance failed: ' + (error.fixtureStep || error.name)); process.exitCode = 1;
}).finally(async () => {
  try { await cleanup(); } catch { report.status = 'failed'; report.cleanupFailed = true; persist(); console.error('Owned update fixture cleanup could not finish safely.'); process.exitCode = 1; }
});


}
