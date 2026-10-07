'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Offline export only: this script does not authenticate, commit, push or delete.
function render(text, names) {
  return text.replace(/\]\(([A-Za-z0-9_-]+)\.md(#[^\s)]*)?\)/g, (match, name, anchor = '') => {
    if (!names.has(name + '.md')) throw new Error(`Unknown Wiki page: ${name}`);
    return `](${name}${anchor})`;
  });
}
function prepare(output, source = path.join(__dirname, '..', 'docs', 'wiki')) {
  if (!output) throw new Error('Usage: node scripts/Prepare-Wiki.cjs <NEW-export-directory>');
  const destination = path.resolve(output);
  const files = fs.readdirSync(source).filter(name => /^[A-Za-z0-9_-]+\.md$/.test(name)).sort();
  if (!files.includes('Home.md') || !files.includes('_Sidebar.md')) throw new Error('Incomplete Wiki source.');
  const names = new Set(files);
  const pages = files.map(name => {
    if (!fs.lstatSync(path.join(source, name)).isFile()) throw new Error('Wiki sources must be ordinary files.');
    return [name, render(fs.readFileSync(path.join(source, name), 'utf8'), names)];
  });
  // Exclusive mkdir, deliberately without recursive:true: never reuse an existing export.
  fs.mkdirSync(destination);
  for (const [name, text] of pages) fs.writeFileSync(path.join(destination, name), text, {flag: 'wx'});
  return { destination, pages: pages.length };
}
if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw new Error('Supply exactly one NEW export directory.');
    const result = prepare(process.argv[2]);
    console.log(`Prepared ${result.pages} pages in ${result.destination}. No GitHub changes were made.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { render, prepare };
