'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { runtimeSpec, assertVersions, verifySdk, sdkExecutable } = require('../scripts/lib/electron-sdk.cjs');
const { assertRuntime } = require('../src/runtime-identity.cjs');
const metadata = require('../package.json');

test('the npm launcher cannot silently select an older packaged or test runtime', () => {
  const spec = runtimeSpec();
  const versions = { electron: spec.version, node: spec.node, chrome: spec.chrome };
  assertVersions(versions, spec);
  assertRuntime(versions, metadata.electronRuntime);
  for (const key of ['electron', 'node', 'chrome']) {
    const wrong = { ...versions, [key]: '0.0.0' };
    assert.throws(() => assertVersions(wrong, spec), /differs/);
    assert.throws(() => assertRuntime(wrong, metadata.electronRuntime), /differs/);
  }
  assert.throws(() => assertRuntime({}, metadata.electronRuntime), /differs/);
  assert.throws(() => assertRuntime(versions, undefined), /differs/);
  assert.throws(() => runtimeSpec({ ...metadata, build: { ...metadata.build, electronVersion: '0.0.0' } }), /must agree/);
  assert.throws(() => runtimeSpec({ ...metadata, build: { ...metadata.build, electronDownload: {} } }), /pinned SHA-256/);
});

test('SDK cache corruption, hardlinks and old version metadata fail before executing a binary', t => {
  const parent = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(parent, 'nerdsshell-sdk-test-'));
  t.after(() => { assert.equal(path.dirname(directory), parent); fs.rmSync(directory, { recursive: true, force: true }); });
  const file = path.join(directory, 'electron.exe');
  const bytes = Buffer.from('inert SDK regression fixture');
  fs.writeFileSync(file, bytes);
  fs.writeFileSync(path.join(directory, 'version'), '45.3.3');
  const spec = { ...runtimeSpec(), executableSha256: createHash('sha256').update(bytes).digest('hex') };
  let calls = 0;
  const execute = () => { calls++; return { status: 0, stdout: JSON.stringify({ electron: spec.version, node: spec.node, chrome: spec.chrome }) }; };
  assert.equal(verifySdk(directory, spec, execute), directory);
  assert.equal(calls, 1);
  assert.equal(sdkExecutable(directory, spec, execute), path.join(directory, 'electron.exe'), 'SDK selection must not depend on npm launcher path.txt or its Unix fallback');
  calls = 0;
  fs.appendFileSync(file, 'tampered');
  assert.throws(() => verifySdk(directory, spec, execute), /verified official archive/);
  fs.writeFileSync(file, bytes);
  fs.writeFileSync(path.join(directory, 'version'), '0.0.0');
  assert.throws(() => verifySdk(directory, spec, execute), /version file differs/);
  fs.writeFileSync(path.join(directory, 'version'), spec.version);
  fs.linkSync(file, path.join(directory, 'linked.exe'));
  assert.throws(() => verifySdk(directory, spec, execute), /ordinary unlinked file/);
  assert.equal(calls, 0);
});

test('a cached SDK with the expected filename and version must report the pinned embedded Node', t => {
  const parent = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(parent, 'nerdsshell-sdk-runtime-'));
  t.after(() => { assert.equal(path.dirname(directory), parent); fs.rmSync(directory, { recursive: true, force: true }); });
  const bytes = Buffer.from('inert runtime-probe fixture');
  fs.writeFileSync(path.join(directory, 'electron.exe'), bytes);
  fs.writeFileSync(path.join(directory, 'version'), '45.3.3');
  const spec = { ...runtimeSpec(), executableSha256: createHash('sha256').update(bytes).digest('hex') };
  assert.throws(() => verifySdk(directory, spec, () => ({ status: 0, stdout: JSON.stringify({ electron: spec.version, node: '24.22.2', chrome: spec.chrome }) })), /node runtime differs/);
});
