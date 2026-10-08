'use strict';
// Fixed Windows helper protocol. The renderer never supplies this plan or code.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const { windowsPowerShellEnvironment } = require('./powershell-environment.cjs');
const MAX_INSTALLER = 512 * 1024 * 1024;
const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const quote = value => "'" + value.replaceAll("'", "''") + "'";
function ordinary(value, directory) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.length > 1024 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('Invalid update path.');
  const actual = fs.realpathSync.native(value), stat = fs.lstatSync(value, { bigint: true });
  for (let current = path.resolve(value); ; current = path.dirname(current)) {
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Update paths must be ordinary.');
    if (path.dirname(current) === current) break;
  }
  if (stat.isSymbolicLink() || !(directory ? stat.isDirectory() : stat.isFile()) || (!directory && stat.nlink !== 1n)) throw new Error('Update paths must be ordinary.');
  return { actual, dev: stat.dev, ino: stat.ino, size: stat.size };
}
function within(parent, child) { const relative = path.relative(parent, child); return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)); }
function validatePlan(plan) {
  if (!plan || typeof plan !== 'object' || !/^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/.test(plan.targetVersion) || plan.targetVersion.split('.').some(n => Number(n) > 65535) ||
      !/^[a-f0-9]{64}$/.test(plan.sha256) || !Number.isSafeInteger(plan.size) || plan.size < 2 || plan.size > MAX_INSTALLER || !Number.isSafeInteger(plan.parentPid ?? process.pid) || (plan.parentPid ?? process.pid) < 1) throw new Error('Invalid update handoff.');
  const stage = ordinary(plan.stageDirectory, true), temporary = fs.realpathSync.native(os.tmpdir());
  if (!same(path.dirname(stage.actual), temporary) || !/^nerdsshell-update-[A-Za-z0-9_-]+$/.test(path.basename(stage.actual))) throw new Error('Invalid owned update directory.');
  const installer = ordinary(plan.installerPath, false), executable = ordinary(plan.executablePath, false);
  if (!same(path.dirname(installer.actual), stage.actual) || path.basename(installer.actual) !== 'NerdSSHell-' + plan.targetVersion + '-x64-Setup.exe' || installer.size !== BigInt(plan.size) || path.basename(executable.actual).toLowerCase() !== 'nerdsshell.exe') throw new Error('Invalid update executable.');
  const userData = plan.userDataDirectory === undefined || plan.userDataDirectory === null || plan.userDataDirectory === '' ? undefined : ordinary(plan.userDataDirectory, true).actual;
  if (userData && (within(path.dirname(executable.actual), userData) || within(stage.actual, userData) || within(userData, stage.actual))) throw new Error('User data overlaps update paths.');
  return { stage, installer, manifest: { stageDirectory: stage.actual, installerPath: installer.actual, sha256: plan.sha256, size: plan.size, targetVersion: plan.targetVersion,
    executablePath: executable.actual, ...(userData ? { userDataDirectory: userData } : {}), parentPid: plan.parentPid ?? process.pid } };
}
function windowsIdentity(stat) { return stat.dev + ':' + (stat.ino >> 32n) + ':' + (stat.ino & 0xffffffffn); }
async function checksum(file, size) {
  const hash = createHash('sha256'); let total = 0;
  for await (const chunk of fs.createReadStream(file)) { total += chunk.length; if (total > size) throw new Error('Update installer size changed.'); hash.update(chunk); }
  if (total !== size) throw new Error('Update installer size changed.');
  return hash.digest('hex');
}
function bootstrap(runner, manifest, sha256, manifestSha256) {
  if (![runner, manifest].every(value => typeof value === 'string' && path.isAbsolute(value) && !/[\x00-\x1f\x7f]/.test(value)) || !/^[a-f0-9]{64}$/.test(sha256) || !/^[a-f0-9]{64}$/.test(manifestSha256)) throw new Error('Invalid update helper bootstrap.');
  // Execute verified fixed source in memory; no execution-policy override, shell
  // argument concatenation or downloaded PowerShell code is needed.
  return `$ErrorActionPreference='Stop';$f=[IO.File]::Open(${quote(runner)},[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);try{if($f.Length -lt 1 -or $f.Length -gt 131072){throw 'Invalid helper'};$b=New-Object byte[] ([int]$f.Length);$n=0;while($n -lt $b.Length){$r=$f.Read($b,$n,$b.Length-$n);if($r -le 0){throw 'Truncated helper'};$n+=$r};$h=[BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($b)).Replace('-','').ToLowerInvariant();if($h -ne ${quote(sha256)}){throw 'Invalid helper'};. ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString($b)));$result=Invoke-UpdateBroker -RunnerPath ${quote(runner)} -RunnerSha256 ${quote(sha256)} -Path ${quote(manifest)} -ManifestSha256 ${quote(manifestSha256)}}finally{$f.Dispose();if(Get-Command Complete-UpdateCleanup -ErrorAction SilentlyContinue){Complete-UpdateCleanup}};if($result -in @('updated','cancelled','restored','released')){exit 0}else{exit 1}`;
}
function cleanupOwned(owner, files) {
  try {
    const current = ordinary(owner.actual, true);
    if (!same(current.actual, owner.actual) || current.dev !== owner.dev || current.ino !== owner.ino) return;
    for (const file of files) {
      try { const now = ordinary(file.actual, false); if (same(path.dirname(now.actual), owner.actual) && now.dev === file.dev && now.ino === file.ino) fs.unlinkSync(now.actual); } catch {}
    }
    try { fs.rmdirSync(owner.actual); } catch {} // Unknown contents are never removed.
  } catch {}
}
async function prepareUpdate(plan, internalDependencies = {}) {
  if ((internalDependencies.platform || process.platform) !== 'win32') throw new Error('Windows update handoff is unavailable.');
  const checked = validatePlan(plan), files = [checked.installer];
  if (await checksum(checked.installer.actual, plan.size) !== plan.sha256) throw new Error('Update installer failed verification.');
  const runnerPath = path.join(checked.stage.actual, 'update-runner.ps1'), manifestPath = path.join(checked.stage.actual, 'update-manifest.json');
  const source = fs.readFileSync(path.join(__dirname, 'update-runner.ps1'));
  if (!source.length || source.length > 131072) throw new Error('Update helper is unavailable.');
  const nonce = randomBytes(32).toString('hex'), manifest = { ...checked.manifest, nonce, stageIdentity: windowsIdentity(checked.stage), installerIdentity: windowsIdentity(checked.installer) };
  let child, ended = false, released = false, cancelled = false, stoppedProof = false, cancelTask, ready = false, pending, timer, buffer = '';
  const startupMs = internalDependencies.startupMs ?? 15000, commandMs = internalDependencies.commandMs ?? 10000;
  const cleanup = () => cleanupOwned(checked.stage, files);
  const markerNames = { CANCEL: 'update-cancel', STOPPED: 'update-stopped', STOPREAD: 'update-stop-read' };
  const assertStage = () => {
    const current = ordinary(checked.stage.actual, true);
    if (!same(current.actual, checked.stage.actual) || current.dev !== checked.stage.dev || current.ino !== checked.stage.ino) throw new Error('Update stage changed.');
  };
  const markerPath = kind => path.join(checked.stage.actual, markerNames[kind]);
  const readMarker = kind => {
    assertStage(); const file = markerPath(kind); let fd;
    try {
      fd = fs.openSync(file, 'r'); const stat = fs.fstatSync(fd, { bigint: true }), named = ordinary(file, false);
      if (!stat.isFile() || stat.nlink !== 1n || stat.size > 128n || stat.dev !== named.dev || stat.ino !== named.ino) return false;
      const bytes = Buffer.alloc(129), length = fs.readSync(fd, bytes, 0, bytes.length, 0);
      if (bytes.subarray(0, length).toString('ascii') !== kind + ' ' + nonce + '\n') return false;
      if (!files.some(owner => owner.actual === named.actual && owner.dev === stat.dev && owner.ino === stat.ino)) files.push(named);
      return true;
    } catch (error) { if (error.code === 'ENOENT' || error.code === 'EBUSY' || error.code === 'EACCES') return false; throw error; }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  };
  const writeMarker = kind => {
    assertStage(); const file = markerPath(kind); let fd;
    try {
      fd = fs.openSync(file, 'wx', 0o600); const stat = fs.fstatSync(fd, { bigint: true });
      files.push({ actual: file, dev: stat.dev, ino: stat.ino });
      fs.writeFileSync(fd, kind + ' ' + nonce + '\n', 'ascii'); fs.fsyncSync(fd);
    } catch (error) { if (error.code !== 'EEXIST' || !readMarker(kind)) throw error; }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  };
  const waitStopped = async () => {
    const until = Date.now() + commandMs;
    while (!stoppedProof) {
      if (readMarker('STOPPED')) { stoppedProof = true; break; }
      if (Date.now() >= until) throw new Error('Update cancellation could not be confirmed.');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  try {
    fs.writeFileSync(runnerPath, source, { flag: 'wx', mode: 0o600 });
    const runnerOwner = ordinary(runnerPath, false); files.push(runnerOwner); manifest.runnerIdentity = windowsIdentity(runnerOwner);
    const manifestFd = fs.openSync(manifestPath, 'wx', 0o600); let manifestBytes;
    try {
      const manifestOwner = fs.fstatSync(manifestFd, { bigint: true });
      files.push({ actual: manifestPath, dev: manifestOwner.dev, ino: manifestOwner.ino });
      manifest.manifestIdentity = windowsIdentity(manifestOwner); manifestBytes = Buffer.from(JSON.stringify(manifest));
      fs.writeFileSync(manifestFd, manifestBytes); fs.fsyncSync(manifestFd);
    } finally { fs.closeSync(manifestFd); }
    const encoded = Buffer.from(bootstrap(runnerPath, manifestPath, createHash('sha256').update(source).digest('hex'), createHash('sha256').update(manifestBytes).digest('hex')), 'utf16le').toString('base64');
    child = (internalDependencies.execute || spawn)(path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { detached: false, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'], env: windowsPowerShellEnvironment() });
    const awaitResponse = (expected, milliseconds) => new Promise((resolve, reject) => { pending = { expected, resolve, reject }; timer = setTimeout(() => { pending = null; reject(new Error('Windows update helper timed out.')); }, milliseconds); });
    const fail = () => { ready = false; if (pending) { clearTimeout(timer); const item = pending; pending = null; item.reject(new Error('Windows update helper could not complete the handoff.')); } };
    child.stdout.on('data', bytes => {
      if (buffer.length + bytes.length > 4096) { fail(); child.stdin.destroy(); return; }
      buffer += bytes.toString('utf8');
      while (buffer.includes('\n')) {
        const at = buffer.indexOf('\n'), line = buffer.slice(0, at).replace(/\r$/, ''); buffer = buffer.slice(at + 1);
        if (line === 'CANCEL ' + nonce || line === 'STOPPED ' + nonce) stoppedProof = true;
        if (line === 'STOPPED ' + nonce) { fail(); continue; }
        if (cancelled && line === 'GO ' + nonce) continue;
        if (!pending || line !== pending.expected + ' ' + nonce) { fail(); child.stdin.destroy(); continue; }
        clearTimeout(timer); const item = pending; pending = null; item.resolve();
      }
    });
    child.stderr.on('error', fail); child.stdout.on('end', fail);
    child.stderr.on('data', () => {}); // No paths, compiler text or environment in UI errors.
    child.on('error', fail); child.stdin.on('error', fail); child.stdout.on('error', fail);
    child.on('close', () => { ended = true; fail(); });
    await awaitResponse('READY', startupMs); ready = true;
    return Object.freeze({
      async release() {
        if (!ready || ended || released || cancelled) throw new Error('Update handoff is no longer available.');
        ready = false;
        const acknowledged = awaitResponse('GO', commandMs);
        child.stdin.write('GO ' + nonce + '\n');
        try { await acknowledged; } catch (error) { if (!cancelled) { try { child.stdin.end('CANCEL ' + nonce + '\n'); } catch {} } throw error; }
        released = true;
        // The independent worker pins the real app handle; its hidden broker
        // is disposable after app exit. Main may
        // now quit; leaving its streams referenced must not keep Electron alive.
        child.unref(); child.stdin.unref?.(); child.stdout.unref?.(); child.stderr.unref?.();
      },
      cancel() {
        if (cancelTask) return cancelTask;
        cancelled = true; ready = false;
        if (pending) { clearTimeout(timer); const item = pending; pending = null; item.reject(new Error('Update handoff cancelled.')); }
        cancelTask = (async () => {
          // This channel remains usable after the libuv-owned broker exits.
          // Never infer stopped state from that broker's exit or from a timer.
          if (!stoppedProof) writeMarker('CANCEL');
          if (!ended) {
            const acknowledgement = awaitResponse('CANCEL', commandMs);
            try { child.stdin.end('CANCEL ' + nonce + '\n'); } catch {}
            try { await acknowledgement; } catch { try { child.stdin.destroy(); } catch {} }
          }
          await waitStopped();
          try { writeMarker('STOPREAD'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
          // Give the positively stopped worker its acknowledgement before any
          // cleanup. Unknown/replaced files and unconfirmed workers are retained.
          const until = Date.now() + commandMs;
          while (fs.existsSync(checked.stage.actual) && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 20));
          cleanup();
        })().catch(error => { cancelTask = undefined; throw new Error('Update cancellation could not be confirmed. NerdSSHell can keep running.'); });
        return cancelTask;
      }
    });
  } catch {
    // Closing stdin before GO cannot install. Never terminate another process.
    try { child?.stdin.destroy(); } catch {}
    if (!child) cleanup();
    else if (stoppedProof) {
      try { writeMarker('STOPREAD'); } catch {}
      // A refused worker still needs to observe its stop acknowledgement before
      // it can release its script/stage and perform its own exact cleanup.
      const until = Date.now() + commandMs;
      while (fs.existsSync(checked.stage.actual) && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 20));
      cleanup();
    }
    throw new Error('Windows update helper could not be prepared. NerdSSHell can keep running.');
  }
}
async function armUpdate(plan, internalDependencies) {
  try { return await prepareUpdate(plan, internalDependencies); }
  catch { throw new Error('Windows update helper could not be prepared. NerdSSHell can keep running.'); }
}
module.exports = { armUpdate, validatePlan, bootstrap, cleanupOwned };
