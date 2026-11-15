'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function runtimeSpec(metadata = require('../../package.json')) {
  const runtime = metadata.electronRuntime;
  for (const key of ['version', 'node', 'chrome']) assert.match(runtime?.[key] || '', /^\d+\.\d+\.\d+(?:\.\d+)?$/, `Invalid Electron runtime ${key}`);
  assert.equal(metadata.build.electronVersion, runtime.version, 'Build and SDK Electron versions must agree');
  assert.match(runtime.executableSha256 || '', /^[a-f0-9]{64}$/);
  const filename = `electron-v${runtime.version}-win32-x64.zip`;
  const checksum = metadata.build.electronDownload?.checksums?.[filename];
  assert.match(checksum || '', /^[a-f0-9]{64}$/, 'Official Electron archive needs a pinned SHA-256');
  return { ...runtime, filename, checksum };
}

function assertVersions(versions, spec = runtimeSpec()) {
  for (const key of ['electron', 'node', 'chrome']) {
    assert.equal(versions[key], spec[key === 'electron' ? 'version' : key], `Actual ${key} runtime differs from the reviewed pin`);
  }
}

function verifySdk(directory, spec = runtimeSpec(), execute = spawnSync) {
  assert.ok(fs.lstatSync(directory).isDirectory() && !fs.lstatSync(directory).isSymbolicLink(), 'SDK directory must be ordinary');
  const executable = path.join(directory, 'electron.exe');
  const stat = fs.lstatSync(executable);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'SDK executable must be an ordinary unlinked file');
  assert.equal(hash(executable), spec.executableSha256, 'SDK executable differs from the verified official archive');
  assert.equal(fs.readFileSync(path.join(directory, 'version'), 'utf8').trim().replace(/^v/, ''), spec.version, 'SDK version file differs');
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  delete env.NODE_OPTIONS; delete env.NODE_PATH;
  const result = execute(executable, ['-p', 'JSON.stringify(process.versions)'], { env, windowsHide: true, encoding: 'utf8', timeout: 15000, maxBuffer: 16384 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, 'Official SDK runtime probe failed');
  assertVersions(JSON.parse(result.stdout), spec);
  return directory;
}

async function prepareSdk() {
  assert.equal(process.platform, 'win32', 'The supported Electron SDK platform is Windows x64');
  assert.equal(process.arch, 'x64', 'The supported Electron SDK architecture is x64');
  const spec = runtimeSpec();
  const local = path.join(root, '.local');
  fs.mkdirSync(local, { recursive: true });
  assert.ok(!fs.lstatSync(local).isSymbolicLink(), 'SDK cache must stay in the project');
  const directory = path.join(local, `electron-sdk-${spec.version}-win32-x64`);
  if (fs.existsSync(directory)) return verifySdk(directory, spec);
  // Use the same locked, checksum-validating official downloader as packaging.
  const { downloadElectronArtifactZip, extractArchive } = require('app-builder-lib/out/util/electronGet');
  const archive = await downloadElectronArtifactZip({ artifactName: 'electron', platformName: 'win32', arch: 'x64', version: spec.version,
    electronDownload: { checksums: { [spec.filename]: spec.checksum } } });
  assert.equal(hash(archive), spec.checksum, 'Downloaded Electron archive differs from the reviewed pin');
  const stage = fs.mkdtempSync(path.join(local, `electron-sdk-${spec.version}-stage-`));
  await extractArchive(archive, stage);
  verifySdk(stage, spec);
  fs.renameSync(stage, directory);
  return verifySdk(directory, spec);
}

module.exports = { runtimeSpec, assertVersions, verifySdk, prepareSdk };
