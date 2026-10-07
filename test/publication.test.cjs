'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { render, prepare } = require('../scripts/Prepare-Wiki.cjs');
const { verifyOmitted } = require('../scripts/Verify-Publication.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nerdsshell-doc-test-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return root;
}
test('Wiki links drop only the local markdown extension and preserve anchors', () => {
  assert.equal(render('[Go](Home.md#start) [External](https://example.com/a.md)', new Set(['Home.md'])), '[Go](Home#start) [External](https://example.com/a.md)');
});
test('unknown local Wiki targets fail instead of publishing broken links', () => {
  assert.throws(() => render('[Go](Missing.md)', new Set(['Home.md'])), /Unknown Wiki page/);
});
test('Wiki preparation refuses to overwrite an existing destination', t => {
  const root = fixture(t), source = path.join(root, 'source'), output = path.join(root, 'output');
  fs.mkdirSync(source); fs.writeFileSync(path.join(source, 'Home.md'), '# Home\n'); fs.writeFileSync(path.join(source, '_Sidebar.md'), '[Home](Home.md)\n');
  assert.equal(prepare(output, source).pages, 2);
  assert.equal(fs.readFileSync(path.join(output, '_Sidebar.md'), 'utf8'), '[Home](Home)\n');
  assert.throws(() => prepare(output, source));
  assert.equal(fs.readFileSync(path.join(output, 'Home.md'), 'utf8'), '# Home\n');
});
test('installed-graph check rejects any installed optional package', t => {
  const root = fixture(t); fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({packages: {'node_modules/sample': {optional: true}}}));
  assert.doesNotThrow(() => verifyOmitted(root));
  fs.mkdirSync(path.join(root, 'node_modules', 'sample'));
  fs.writeFileSync(path.join(root, 'node_modules', 'sample', 'package.json'), '{}');
  assert.throws(() => verifyOmitted(root), /unexpectedly installed/);
});
test('missing node_modules is not counted as proof of a supported installation', t => {
  const root = fixture(t); fs.writeFileSync(path.join(root, 'package-lock.json'), '{"packages":{}}');
  assert.throws(() => verifyOmitted(root), /Run npm ci/);
});
