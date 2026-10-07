'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getCurrentFuseWire, FuseV1Options } = require('@electron/fuses');
const asar = require('@electron/asar');
const { NtExecutable, NtExecutableResource } = require('resedit');
const { verifyNativePty, NATIVE_HASHES } = require('../src/local-remote.cjs');
const { APP_ID, PACKAGE_NAME, INSTALLER_GUID } = require('../src/branding.cjs');

async function verify(directory) {
  const exe = path.join(directory, require('../package.json').build.productName + '.exe');
  require('./Verify-Branding.cjs').verifyWindowsBranding(exe);
  const resources = path.join(directory, 'resources');
  const archive = path.join(resources, 'app.asar');
  const sourceMetadata = require('../package.json');
  const packagedMetadata = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
  assert.equal(packagedMetadata.name, PACKAGE_NAME, 'Packaged product namespace differs from source');
  assert.equal(sourceMetadata.build.appId, APP_ID, 'Windows application identity differs from runtime');
  assert.equal(sourceMetadata.build.nsis.guid, INSTALLER_GUID, 'Original installer upgrade identity must remain pinned');
  assert.equal(asar.extractFile(archive, 'src/application-identity.cjs').toString('utf8'), fs.readFileSync(path.join(__dirname, '..', 'src/application-identity.cjs'), 'utf8'), 'Packaged data compatibility selector differs from reviewed source');
  assert.equal(packagedMetadata.version, sourceMetadata.version, 'Packaged application version differs from source');
  const packagedPtyMetadata = JSON.parse(asar.extractFile(archive, path.join('node_modules', 'node-pty', 'package.json')).toString('utf8'));
  assert.equal(packagedPtyMetadata.version, sourceMetadata.dependencies['node-pty'], 'Packaged terminal provider must match the exact version supported by the owned-transport adapter');
  const fuses = await getCurrentFuseWire(exe);
  assert.equal(fuses.version, '1');
  for (const option of [FuseV1Options.RunAsNode, FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseV1Options.EnableNodeCliInspectArguments, FuseV1Options.GrantFileProtocolExtraPrivileges]) assert.equal(fuses[option], 48, `Fuse ${FuseV1Options[option]} must be disabled`);
  for (const option of [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseV1Options.OnlyLoadAppFromAsar]) assert.equal(fuses[option], 49, `Fuse ${FuseV1Options[option]} must be enabled`);

  const executable = NtExecutable.from(fs.readFileSync(exe));
  const entries = NtExecutableResource.from(executable).entries.filter(entry => String(entry.type).toUpperCase() === 'INTEGRITY' && String(entry.id).toUpperCase() === 'ELECTRONASAR');
  assert.equal(entries.length, 1, 'Windows ASAR integrity resource missing or duplicated');
  const metadata = JSON.parse(Buffer.from(entries[0].bin).toString('utf8'));
  assert.equal(metadata.length, 1);
  assert.equal(metadata[0].file, 'resources\\app.asar');
  assert.equal(metadata[0].alg, 'SHA256');
  const header = asar.getRawHeader(archive);
  const actualHash = crypto.createHash('sha256').update(header.headerString).digest('hex');
  assert.equal(metadata[0].value, actualHash, 'Windows resource does not match app.asar header');

  const packaged = asar.listPackage(archive).map(name => name.replaceAll('\\', '/'));
  for (const name of ['/LICENSE', '/docs/THIRD-PARTY-NOTICES.md']) assert.ok(packaged.includes(name), `${name} must be bundled inside validated ASAR`);
  assert.ok(packaged.includes('/src/elevated-console.cs') && packaged.includes('/src/elevated-pty.cjs'), 'Administrator helper and bootstrap must remain inside validated ASAR');
  for (const name of ['/src/powershell-environment.cjs', '/src/console-text.cjs', '/src/branding.cjs', '/src/preferences.cjs', '/src/session-commands.cjs', '/src/session-notifications.cjs', '/ui/session-attention.js', '/ui/branding/app-dark-64.png', '/ui/branding/app-light-64.png', '/ui/branding/nerdsshell.ico', '/src/local-remote.cjs', '/src/workbench.cjs', '/src/action-catalog.cjs', '/ui/workbench.js', '/ui/command-review.js', '/ui/workbench.css', '/node_modules/node-pty/lib/index.js', '/node_modules/node-pty/lib/worker/conoutSocketWorker.js', '/src/main.cjs', '/src/preload.cjs', '/src/app-protocol.cjs', '/src/standard-remote.cjs', '/src/sftp-browser.cjs', '/src/file-listings.cjs', '/ui/index.html', '/ui/app.js', '/ui/appearance.js', '/ui/files.js', '/node_modules/ssh2/lib/client.js']) assert.ok(packaged.includes(name), `${name} must be inside app.asar`);
  const unpacked = path.join(resources, 'app.asar.unpacked');
  const outside = fs.existsSync(unpacked) ? fs.readdirSync(unpacked, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => path.join(entry.parentPath, entry.name).slice(unpacked.length + 1).replaceAll('\\', '/')) : [];
  const ptyPrefix = 'node_modules/node-pty/prebuilds/win32-x64/';
  assert.deepEqual(outside.sort(), ['node_modules/ssh2/util/pagent.exe', ...Object.keys(NATIVE_HASHES).map(p => ptyPrefix + p)].sort(), 'Unexpected resource outside validated ASAR');
  verifyNativePty(path.join(unpacked, ...ptyPrefix.split('/')));
  assert.ok(!packaged.some(p => /node-pty\/(build|third_party)\//.test(p)), 'Unused native fallback directories must not be shipped');
  console.log('Packaged Electron fuses, Windows ASAR integrity resource, and JS containment passed.');
}

verify(path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist', 'win-unpacked'))).catch(error => { console.error(error); process.exitCode = 1; });
