'use strict';
// Main-process published-release updater. No feed/URL/command comes from IPC.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const API_URL = 'https://api.github.com/repos/zeidlern/NerdSSHell/releases/latest';
const REPOSITORY = 'https://github.com/zeidlern/NerdSSHell';
const MAX_METADATA = 1024 * 1024;
const MAX_INSTALLER = 512 * 1024 * 1024;
const CHECK_TIMEOUT_MS = 15000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
function version(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/.test(value)) throw new Error('Invalid published version.');
  const parts = value.split('.').map(Number);
  if (parts.some(part => part > 65535)) throw new Error('Unsupported published version.');
  return parts;
}
function newer(candidate, current) {
  const a = version(candidate), b = version(current);
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] > b[index];
  return false;
}
function publishedRelease(data, current) {
  version(current);
  if (!data || typeof data !== 'object' || data.draft !== false || data.prerelease !== false || !Number.isSafeInteger(data.id) || data.id < 1 || typeof data.tag_name !== 'string' || !data.tag_name.startsWith('v') || typeof data.published_at !== 'string' || !Number.isFinite(Date.parse(data.published_at))) throw new Error('Invalid published release.');
  const target = data.tag_name.slice(1); version(target);
  if (data.html_url !== REPOSITORY + '/releases/tag/v' + target) throw new Error('Release is outside the official repository.');
  if (!newer(target, current)) return null;
  const name = 'NerdSSHell-' + target + '-x64-Setup.exe';
  if (!Array.isArray(data.assets) || data.assets.length > 256) throw new Error('Invalid release assets.');
  const assets = data.assets.filter(asset => asset?.name === name);
  if (assets.length !== 1) throw new Error('Published Windows installer is unavailable.');
  const asset = assets[0], url = REPOSITORY + '/releases/download/v' + target + '/' + name;
  if (!Number.isSafeInteger(asset.id) || asset.id < 1 || asset.state !== 'uploaded' || asset.browser_download_url !== url || !Number.isSafeInteger(asset.size) || asset.size < 2 || asset.size > MAX_INSTALLER || typeof asset.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) throw new Error('Invalid published installer identity.');
  return Object.freeze({ version: target, releaseId: data.id, assetId: asset.id, name, url, size: asset.size, sha256: asset.digest.slice(7), releaseUrl: data.html_url });
}
function deadline(signal, timeout) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeout);
  return { signal: controller.signal, dispose() { clearTimeout(timer); signal?.removeEventListener('abort', abort); } };
}
function assertActive(signal) { if (signal?.aborted) throw new Error('Update cancelled.'); }
function downloadRedirect(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || url.hostname !== 'release-assets.githubusercontent.com') throw new Error('Unexpected update download redirect.');
  return url.href;
}
async function publicResponse(fetch, initial, { signal, download = false, currentVersion }) {
  let url = initial;
  for (let count = 0; count <= 3; count++) {
    assertActive(signal);
    const response = await fetch(url, { method: 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store', signal,
      headers: { Accept: download ? 'application/octet-stream' : 'application/vnd.github+json', 'User-Agent': 'NerdSSHell/' + currentVersion, 'X-GitHub-Api-Version': '2022-11-28' } });
    assertActive(signal);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      if (!download || count === 3) throw new Error('Unexpected update redirect.');
      const location = response.headers.get('location');
      if (!location) throw new Error('Missing update download location.');
      url = downloadRedirect(location); continue;
    }
    if (response.status !== 200 || !response.body?.getReader) { await response.body?.cancel(); throw new Error('Published update is unavailable.'); }
    // Electron net.fetch does not reliably expose Response.url; redirect targets
    // are validated before every request instead of trusting that field.
    return response;
  }
  throw new Error('Too many update redirects.');
}
async function readMetadata(fetch, currentVersion, signal) {
  version(currentVersion);
  const guard = deadline(signal, CHECK_TIMEOUT_MS);
  let reader;
  try {
    const response = await publicResponse(fetch, API_URL, { signal: guard.signal, currentVersion });
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_METADATA)) { await response.body.cancel(); throw new Error('Update metadata exceeds its limit.'); }
    reader = response.body.getReader(); let bytes = 0; const chunks = [];
    while (true) { assertActive(guard.signal); const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > MAX_METADATA) throw new Error('Update metadata exceeds its limit.'); chunks.push(Buffer.from(next.value)); }
    assertActive(guard.signal);
    return publishedRelease(JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')), currentVersion);
  } finally { try { await reader?.cancel(); } catch {} guard.dispose(); }
}
function ownedStage(directory) {
  const temp = fs.realpathSync.native(os.tmpdir()), actual = fs.realpathSync.native(directory), stat = fs.lstatSync(directory);
  const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  if (!stat.isDirectory() || stat.isSymbolicLink() || !same(path.dirname(actual), temp) || !/^nerdsshell-update-[A-Za-z0-9_-]+$/.test(path.basename(actual))) throw new Error('Invalid owned update directory.');
  return { actual, dev: stat.dev, ino: stat.ino };
}
function cleanStage(owner) {
  try {
    const current = ownedStage(owner.actual);
    if (current.dev !== owner.dev || current.ino !== owner.ino || current.actual !== owner.actual) throw new Error('Update directory identity changed.');
    if (owner.file) {
      try {
        const file = fs.lstatSync(owner.file.path);
        if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1 || file.dev !== owner.file.dev || file.ino !== owner.file.ino) throw new Error('Update file identity changed.');
        fs.unlinkSync(owner.file.path);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    try { fs.rmdirSync(owner.actual); } catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
async function downloadInstaller(fetch, release, currentVersion, signal) {
  version(currentVersion); version(release.version);
  const expected = REPOSITORY + '/releases/download/v' + release.version + '/NerdSSHell-' + release.version + '-x64-Setup.exe';
  if (release.url !== expected || !/^[a-f0-9]{64}$/.test(release.sha256) || !Number.isSafeInteger(release.size) || release.size < 2 || release.size > MAX_INSTALLER || !newer(release.version, currentVersion)) throw new Error('Invalid update download.');
  const directory = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'nerdsshell-update-' + process.pid + '-'));
  const owner = ownedStage(directory), installerPath = path.join(owner.actual, path.basename(expected));
  const guard = deadline(signal, DOWNLOAD_TIMEOUT_MS); let file, reader, success = false;
  try {
    file = await fs.promises.open(installerPath, 'wx', 0o600);
    const initialFile = await file.stat(); owner.file = { path: installerPath, dev: initialFile.dev, ino: initialFile.ino };
    const response = await publicResponse(fetch, release.url, { signal: guard.signal, download: true, currentVersion });
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) !== release.size)) { await response.body.cancel(); throw new Error('Update download size differs.'); }
    reader = response.body.getReader(); let total = 0; const hash = createHash('sha256'); let first = Buffer.alloc(0);
    while (true) {
      assertActive(guard.signal); const next = await reader.read(); if (next.done) break;
      const chunk = Buffer.from(next.value); total += chunk.length;
      if (total > release.size) throw new Error('Update download exceeds its declared size.');
      if (first.length < 2) first = Buffer.concat([first, chunk.subarray(0, 2 - first.length)]);
      hash.update(chunk);
      for (let offset = 0; offset < chunk.length;) { const written = await file.write(chunk, offset, chunk.length - offset); if (!written.bytesWritten) throw new Error('Update file could not be written.'); offset += written.bytesWritten; }
    }
    assertActive(guard.signal);
    if (total !== release.size || hash.digest('hex') !== release.sha256 || first.toString('ascii') !== 'MZ') throw new Error('Downloaded update did not match its published checksum.');
    await file.sync(); await file.close(); file = null;
    const stat = fs.lstatSync(installerPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== release.size) throw new Error('Update file identity changed.');
    success = true;
    return Object.freeze({ stageDirectory: owner.actual, installerPath, sha256: release.sha256, size: release.size, targetVersion: release.version, cleanup: () => cleanStage(owner) });
  } finally { try { await reader?.cancel(); } catch {} try { await file?.close(); } catch {} guard.dispose(); if (!success) cleanStage(owner); }
}
function eligibleStartup({ packaged, platform, arch, executablePath, debugging, currentVersion }) {
  try { version(currentVersion); } catch { return false; }
  return packaged === true && platform === 'win32' && arch === 'x64' && !debugging && typeof executablePath === 'string' && path.win32.basename(executablePath).toLowerCase() === 'nerdsshell.exe';
}
class StartupUpdater {
  constructor({ fetch, currentVersion, offer, notice, requestQuit, armUpdate, executablePath, userDataDirectory }) {
    this.options = { fetch, currentVersion, offer, notice, requestQuit, armUpdate, executablePath, userDataDirectory };
    this.controller = new AbortController(); this.started = false; this.ready = null; this.handoff = null; this.committed = false;
  }
  start() {
    if (this.started) return this.task;
    this.started = true;
    this.task = this.run(); return this.task;
  }
  async run() {
    const options = this.options, signal = this.controller.signal;
    try {
      const release = await readMetadata(options.fetch, options.currentVersion, signal);
      if (!release || signal.aborted || await options.offer(release, signal) !== true || signal.aborted) return;
      options.notice('Downloading NerdSSHell ' + release.version + '. The app will restart after verification and any work confirmations.');
      const ready = await downloadInstaller(options.fetch, release, options.currentVersion, signal);
      if (signal.aborted) { ready.cleanup(); return; }
      this.ready = ready;
      options.requestQuit();
    } catch {
      if (!signal.aborted) options.notice('The update check or download could not finish. NerdSSHell can keep running; it will check again next startup.');
    }
  }
  quitAttempt() { if (!this.ready && !this.committed) this.controller.abort(); }
  async prepareQuit() {
    if (!this.ready || this.controller.signal.aborted) return null;
    this.handoff = await this.options.armUpdate({ ...this.ready, executablePath: this.options.executablePath, userDataDirectory: this.options.userDataDirectory });
    return this.handoff;
  }
  async release() {
    if (!this.handoff || !this.ready || this.controller.signal.aborted) throw new Error('Update handoff is unavailable.');
    await this.handoff.release(); this.committed = true; this.ready = null;
  }
  async cancel(includeCommitted = false) {
    if (this.committed && !includeCommitted) return;
    this.controller.abort();
    if (this.handoff) { await this.handoff.cancel(); this.handoff = null; }
    if (this.ready) { this.ready.cleanup(); this.ready = null; }
    if (this.task) await this.task;
  }
}
module.exports = { API_URL, MAX_METADATA, MAX_INSTALLER, version, newer, publishedRelease, readMetadata, downloadInstaller, eligibleStartup, StartupUpdater, downloadRedirect };
