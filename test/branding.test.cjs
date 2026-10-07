'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Data, Resource } = require('resedit');
const { verifySourceBranding, verifyResourceBranding } = require('../scripts/Verify-Branding.cjs');

const ico = fs.readFileSync(path.join(__dirname, '..', 'ui/branding/nerdsshell.ico'));
const expected = { productName: 'NerdSSHell', version: '0.1.2' };

function fixture() {
  const entries = [];
  const image = Data.IconFile.from(ico);
  Resource.IconGroupEntry.replaceIconsForResource(entries, 1, 1033, image.icons.map(icon => icon.data));
  const version = Resource.VersionInfo.createEmpty();
  version.lang = 1033;
  version.setFileVersion(expected.version);
  version.setProductVersion(expected.version);
  version.setStringValues({ lang: 1033, codepage: 1200 }, {
    ProductName: expected.productName, FileDescription: expected.productName,
    FileVersion: expected.version, ProductVersion: `${expected.version}.0`
  });
  version.outputToResourceEntries(entries);
  return entries;
}

test('committed branding outputs match approved masters and all Windows sizes', () => {
  assert.deepEqual(verifySourceBranding(), { assets: 25, frames: 9 });
});

test('Windows resources preserve the full icon and visible product/version metadata', () => {
  assert.deepEqual(verifyResourceBranding(fixture(), ico, expected), { iconGroups: 1, frames: 9 });
});

test('packaged verification rejects a missing or changed icon frame', () => {
  const entries = fixture();
  const first = entries.find(entry => entry.type === 3);
  // PNG image bytes after IHDR: dimensions remain valid, approved content differs.
  new Uint8Array(first.bin)[40] ^= 1;
  assert.throws(() => verifyResourceBranding(entries, ico, expected), /does not match/);
  assert.throws(() => verifyResourceBranding(fixture().filter(entry => entry.type !== 14), ico, expected), /icon resource is missing/);
});

test('packaged verification rejects stale BetterSSH identity or release versions', () => {
  assert.throws(() => verifyResourceBranding(fixture(), ico, { ...expected, productName: 'BetterSSH' }), /product name differs/);
  assert.throws(() => verifyResourceBranding(fixture(), ico, { ...expected, version: '0.1.1' }), /file version differs/);
});
