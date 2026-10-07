'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { render } = require('./Prepare-Wiki.cjs');
const ROOT = path.resolve(__dirname, '..');
function verify(root = ROOT) {
  const folder = path.join(root, 'docs', 'wiki');
  const files = fs.readdirSync(folder).filter(name => /^[A-Za-z0-9_-]+\.md$/.test(name));
  const names = new Set(files);
  for (const name of ['Home.md', '_Sidebar.md', 'Installation.md', 'Install-with-Codex.md', 'Maintainer-Publication.md', 'Publishing-the-Wiki.md']) assert.ok(names.has(name), `Missing ${name}`);
  for (const name of files) render(fs.readFileSync(path.join(folder, name), 'utf8'), names);
  const codeql = fs.readFileSync(path.join(root, '.github', 'workflows', 'codeql.yml'), 'utf8');
  assert.ok(codeql.includes("github.event.repository.visibility == 'public'"), 'CodeQL needs the event repository visibility.');
  assert.ok(!codeql.includes('github.repository_visibility'), 'Undocumented GitHub visibility property.');
  for (const name of fs.readdirSync(path.join(root, '.github', 'workflows'))) {
    if (!/\.ya?ml$/.test(name)) continue;
    const text = fs.readFileSync(path.join(root, '.github', 'workflows', name), 'utf8');
    assert.ok(!text.includes('zeidlern/BetterSSH'), 'Old repository identity in a workflow.');
  }
  console.log(`Publication configuration and ${files.length} Wiki pages verified.`);
}
function verifyOmitted(root = ROOT) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.ok(fs.existsSync(path.join(root, 'node_modules')), 'Run npm ci --omit=optional first.');
  const optional = Object.entries(lock.packages).filter(([name, entry]) => name.startsWith('node_modules/') && entry.optional === true);
  for (const [name] of optional) {
    assert.ok(!path.isAbsolute(name) && !name.split('/').includes('..'), 'Unsafe lockfile package path.');
    assert.ok(!fs.existsSync(path.join(root, name, 'package.json')), `Optional package unexpectedly installed: ${name}`);
  }
  console.log(`Verified absence of ${optional.length} optional lockfile package placements.`);
}
if (require.main === module) {
  try { if (process.argv[2] === '--installed') verifyOmitted(); else verify(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { verify, verifyOmitted };
