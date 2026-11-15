'use strict';

// Binary-runtime provenance is independent of npm's launcher package inventory.
// Keep this dependency-free: the protected publisher runs without npm install.
const assert = require('node:assert/strict');
const STABLE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA256 = /^[0-9a-f]{64}$/;

function runtimePackage(metadata) {
  if (!Object.hasOwn(metadata, 'electronRuntime') && !Object.hasOwn(metadata.build || {}, 'electronVersion')) return null;
  const runtime = metadata.electronRuntime;
  assert.ok(runtime && typeof runtime === 'object', 'Explicit Electron runtime needs binary provenance');
  assert.match(runtime.version, STABLE, 'Electron runtime must be a stable exact version');
  assert.equal(metadata.build?.electronVersion, runtime.version, 'Builder and binary-runtime versions differ');
  assert.match(runtime.node, STABLE, 'Embedded Node must have an exact version');
  assert.match(runtime.chrome, /^\d+\.\d+\.\d+\.\d+$/, 'Embedded Chromium must have an exact version');
  assert.match(runtime.executableSha256, SHA256, 'Electron executable needs a pinned SHA-256');
  assert.match(metadata.devDependencies?.electron, STABLE, 'npm Electron launcher must remain exactly pinned');
  const filename = `electron-v${runtime.version}-win32-x64.zip`;
  const checksum = metadata.build?.electronDownload?.checksums?.[filename];
  assert.match(checksum, SHA256, 'Official Electron archive needs a pinned SHA-256');
  return {
    name: 'Electron Windows x64 runtime',
    SPDXID: `SPDXRef-Electron-Runtime-${runtime.version}-win32-x64`,
    versionInfo: runtime.version,
    packageFileName: filename,
    downloadLocation: `https://github.com/electron/electron/releases/download/v${runtime.version}/${filename}`,
    filesAnalyzed: false,
    primaryPackagePurpose: 'APPLICATION',
    licenseDeclared: 'NOASSERTION',
    licenseComments: 'Electron is MIT-licensed; Chromium and bundled dependencies have separate notices in LICENSE.electron.txt and LICENSES.chromium.html.',
    checksums: [{ algorithm: 'SHA256', checksumValue: checksum }],
    externalRefs: [{ referenceCategory: 'PACKAGE-MANAGER', referenceType: 'purl',
      referenceLocator: `pkg:generic/electron@${runtime.version}?arch=x64&os=windows` }],
    sourceInfo: `Official Electron distribution: Node.js ${runtime.node}, Chromium ${runtime.chrome}; electron.exe SHA-256 ${runtime.executableSha256}. npm electron@${metadata.devDependencies.electron} is the separate launcher/download wrapper.`
  };
}

function runtimeRelationship(document, metadata, entry) {
  const roots = document.packages.filter(item => item.name === metadata.name && item.versionInfo === metadata.version);
  assert.equal(roots.length, 1, 'Inventory must identify exactly one application root');
  assert.ok(typeof roots[0].SPDXID === 'string' && roots[0].SPDXID, 'Inventory root needs an SPDX ID');
  return { spdxElementId: roots[0].SPDXID, relatedSpdxElement: entry.SPDXID, relationshipType: 'DEPENDS_ON' };
}

function addRuntime(document, metadata) {
  const entry = runtimePackage(metadata);
  if (!entry) return;
  assert.ok(!document.packages.some(item => item.name === entry.name || item.SPDXID === entry.SPDXID), 'Binary runtime is already inventoried');
  const relationship = runtimeRelationship(document, metadata, entry);
  assert.ok(Array.isArray(document.relationships), 'SPDX inventory needs relationships');
  document.packages.push(entry);
  document.relationships.push(relationship);
}

function validateRuntime(document, metadata) {
  const entry = runtimePackage(metadata);
  if (!entry) return null;
  const matches = document.packages.filter(item => item.name === entry.name || item.SPDXID === entry.SPDXID);
  assert.equal(matches.length, 1, 'Inventory needs exactly one canonical binary runtime');
  assert.deepEqual(matches[0], entry, 'Binary runtime provenance differs from tagged source');
  const relationship = runtimeRelationship(document, metadata, entry);
  assert.ok(Array.isArray(document.relationships), 'SPDX inventory needs relationships');
  assert.equal(document.relationships.filter(item => item.spdxElementId === relationship.spdxElementId &&
    item.relatedSpdxElement === relationship.relatedSpdxElement && item.relationshipType === relationship.relationshipType).length,
  1, 'Inventory must bind the application to its binary runtime exactly once');
  return entry;
}

module.exports = { runtimePackage, addRuntime, validateRuntime };
