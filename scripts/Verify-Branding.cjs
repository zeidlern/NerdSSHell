'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Data, NtExecutable, NtExecutableResource, Resource } = require('resedit');
const { PRODUCT_NAME, WINDOW_ICON, ICON_SIZES, ICO_SIZES } = require('../src/branding.cjs');

const ROOT = path.resolve(__dirname, '..');
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function pngDimensions(bytes) {
  assert.ok(bytes.length >= 33 && bytes.subarray(0, 8).equals(PNG_SIGNATURE), 'Invalid PNG signature');
  assert.equal(bytes.readUInt32BE(8), 13, 'PNG must begin with IHDR');
  assert.equal(bytes.toString('ascii', 12, 16), 'IHDR', 'PNG header missing');
  assert.equal(bytes[24], 8, 'Expected 8-bit icon color');
  assert.equal(bytes[25], 6, 'Icon must retain RGBA transparency');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

function iconFrames(icoBytes) {
  const icon = Data.IconFile.from(icoBytes);
  const frames = icon.icons.map(({ data }) => {
    assert.ok(data.isRaw(), 'Windows icon must retain the approved PNG frames');
    const bytes = Buffer.from(data.bin);
    const dimensions = pngDimensions(bytes);
    assert.deepEqual(dimensions, [data.width, data.height], 'ICO directory and PNG dimensions differ');
    assert.equal(data.bitCount, 32, 'ICO frame must be 32-bit RGBA');
    return { size: data.width, height: data.height, sha256: sha256(bytes) };
  });
  assert.deepEqual(frames.map(frame => frame.size).sort((a, b) => a - b), ICO_SIZES, 'Windows icon sizes missing, duplicated or unexpected');
  return frames.sort((a, b) => a.size - b.size);
}

function verifySourceBranding(root = ROOT) {
  const manifestPath = path.join(root, 'assets/branding/nerdsshell/production/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.productName, PRODUCT_NAME);
  for (const [relative, expected] of Object.entries(manifest.outputs)) {
    assert.equal(sha256(fs.readFileSync(path.join(root, relative))), expected, `Changed generated branding asset: ${relative}`);
  }
  for (const [name, expected] of Object.entries(manifest.masterSha256)) {
    assert.equal(sha256(fs.readFileSync(path.join(path.dirname(manifestPath), name))), expected, `Changed production master: ${name}`);
  }
  for (const theme of ['light', 'dark']) {
    for (const size of ICON_SIZES) {
      const relative = `ui/branding/app-${theme}-${size}.png`;
      assert.ok(Object.hasOwn(manifest.outputs, relative), `Missing manifest asset: ${relative}`);
      assert.deepEqual(pngDimensions(fs.readFileSync(path.join(root, relative))), [size, size], `Incorrect icon size: ${relative}`);
    }
  }
  assert.ok(Object.hasOwn(manifest.outputs, WINDOW_ICON), 'Windows icon is absent from branding manifest');
  const frames = iconFrames(fs.readFileSync(path.join(root, WINDOW_ICON)));
  for (const frame of frames) {
    const png = fs.readFileSync(path.join(root, `ui/branding/app-dark-${frame.size}.png`));
    assert.equal(frame.sha256, sha256(png), `Windows icon differs from approved ${frame.size}px artwork`);
  }
  return { assets: Object.keys(manifest.outputs).length, frames: frames.length };
}

function verifyResourceBranding(entries, icoBytes, expected) {
  const wanted = iconFrames(icoBytes);
  const groups = Resource.IconGroupEntry.fromEntries(entries).filter(group => group.id === 1);
  assert.ok(groups.length > 0, 'Primary Windows icon resource is missing');
  for (const group of groups) {
    const actual = group.getIconItemsFromEntries(entries).map(item => {
      assert.ok(item.isRaw(), 'Packaged icon must retain canonical PNG frame bytes');
      const bytes = Buffer.from(item.bin);
      // RT_GROUP_ICON stores 256px as zero; resedit preserves that byte in its
      // resource reader although its standalone ICO reader expands it to 256.
      const size = item.width || 256, height = item.height || 256;
      assert.deepEqual(pngDimensions(bytes), [size, height]);
      return { size, height, sha256: sha256(bytes) };
    }).sort((a, b) => a.size - b.size);
    assert.deepEqual(actual, wanted, 'Packaged executable icon does not match NerdSSHell artwork');
  }
  const versions = Resource.VersionInfo.fromEntries(entries);
  assert.equal(versions.length, 1, 'Expected exactly one Windows version resource');
  const languages = versions[0].getAllLanguagesForStringValues();
  assert.ok(languages.length > 0, 'Windows version metadata has no strings');
  for (const language of languages) {
    const values = versions[0].getStringValues(language);
    assert.equal(values.ProductName, expected.productName, 'Windows product name differs');
    assert.equal(values.FileDescription, expected.productName, 'Windows file description differs');
    assert.equal(values.FileVersion, expected.version, 'Windows file version differs');
    assert.ok([expected.version, `${expected.version}.0`].includes(values.ProductVersion), 'Windows product version differs');
  }
  return { iconGroups: groups.length, frames: wanted.length };
}

function verifyWindowsBranding(executablePath, root = ROOT) {
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  // Read-only PE inspection; signed files are allowed here, and their signature
  // must still be verified separately by the existing Windows signing checks.
  const executable = NtExecutable.from(fs.readFileSync(executablePath), { ignoreCert: true });
  const entries = NtExecutableResource.from(executable).entries;
  return verifyResourceBranding(entries, fs.readFileSync(path.join(root, WINDOW_ICON)), {
    productName: metadata.build.productName, version: metadata.version
  });
}

module.exports = { iconFrames, pngDimensions, verifyResourceBranding, verifySourceBranding, verifyWindowsBranding };

if (require.main === module) {
  try {
    const result = verifySourceBranding();
    if (process.argv[2]) verifyWindowsBranding(path.resolve(process.argv[2]));
    console.log(`Branding asset hashes, RGBA sizes and ${result.frames} Windows icon frames passed (${result.assets} outputs).`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
