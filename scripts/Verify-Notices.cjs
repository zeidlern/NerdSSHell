'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');

const root = path.resolve(__dirname, '..');
const unpacked = path.join(root, 'dist', 'win-unpacked');
const archive = path.join(unpacked, 'resources', 'app.asar');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
// Git may check Markdown out as CRLF on Windows; preserve byte comparisons
// for the packaged licenses while normalizing only the text inventory.
const notices = fs.readFileSync(path.join(root, 'docs', 'THIRD-PARTY-NOTICES.md'), 'utf8').replaceAll('\r\n', '\n');
let verified = 0;

for (const [name, entry] of Object.entries(lock.packages)) {
  if (!name.startsWith('node_modules/') || entry.dev || entry.optional) continue;
  const dir = path.join(root, ...name.split('/'));
  const packageJson = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  assert.equal(packageJson.version, entry.version, `${name} version differs from lockfile`);
  const files = fs.readdirSync(dir).filter(file => /^(LICENSE|LICENCE|COPYING|NOTICE)(\.|$)/i.test(file));
  assert.ok(files.length, `${name} has no installed license file`);
  assert.ok(notices.includes(`## ${packageJson.name} ${entry.version}\n`), `${name} absent from generated notices`);
  for (const file of files) {
    const original = fs.readFileSync(path.join(dir, file));
    const bundled = asar.extractFile(archive, path.join(...name.split('/'), file));
    assert.deepEqual(bundled, original, `${name}/${file} differs in packaged ASAR`);
    assert.ok(notices.includes(original.toString('utf8').replaceAll('\r\n', '\n').trimEnd()), `${name}/${file} text absent from notices`);
    verified++;
  }
}

for (const file of ['LICENSE.electron.txt', 'LICENSES.chromium.html']) {
  const stat = fs.statSync(path.join(unpacked, file));
  assert.ok(stat.size > 100, `Missing or empty ${file}`);
}
console.log(`Verified ${verified} exact packaged JavaScript license files and Electron/Chromium notices.`);
