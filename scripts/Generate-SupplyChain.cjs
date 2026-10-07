'use strict';

// Run after npm ci. This emits a complete lockfile SBOM, the production
// dependency subset installed by CI, and verbatim runtime license notices.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const docs = path.join(root, 'docs');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function sbom(name, omitted) {
  const args = ['sbom', '--package-lock-only', '--sbom-format=spdx', '--sbom-type=application', ...omitted];
  // Windows .cmd launch uses cmd.exe explicitly; all arguments here are fixed
  // by this script, with no path or package name interpolated into the shell.
  const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : npm;
  const commandArgs = process.platform === 'win32' ? ['/d', '/s', '/c', `${npm} ${args.join(' ')}`] : args;
  const result = spawnSync(command, commandArgs, { cwd: root, encoding: 'utf8', maxBuffer: 24 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`npm sbom failed for ${name}: ${result.error?.message || result.stderr || result.status}`);
  }
  const start = result.stdout.indexOf('{');
  if (start < 0) throw new Error(`npm sbom did not emit JSON for ${name}`);
  const doc = JSON.parse(result.stdout.slice(start));
  if (doc.spdxVersion !== 'SPDX-2.3' || !Array.isArray(doc.packages)) {
    throw new Error(`Invalid SPDX output for ${name}`);
  }
  fs.writeFileSync(path.join(docs, name), `${JSON.stringify(doc, null, 2)}\n`);
  return doc.packages.length;
}

const allCount = sbom('SBOM.spdx.json', []);
const runtimeCount = sbom('SBOM-runtime.spdx.json', ['--omit=dev', '--omit=optional']);

const runtime = Object.entries(lock.packages)
  .filter(([name, entry]) => name.startsWith('node_modules/') && !entry.dev && !entry.optional)
  .sort(([a], [b]) => a.localeCompare(b));
let notices = '# Third-party notices for packaged JavaScript dependencies\n\n';
notices += 'Generated from the committed lockfile and installed package license files with `node scripts/Generate-SupplyChain.cjs`. The production install omits optional packages. Electron and Chromium notices are distributed beside the application executable as `LICENSE.electron.txt` and `LICENSES.chromium.html`; their binary contents are not described by the npm SBOM.\n\n';
for (const [name, entry] of runtime) {
  const dir = path.join(root, ...name.split('/'));
  const packageJson = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  if (packageJson.version !== entry.version) throw new Error(`Installed version differs from lockfile for ${name}`);
  const files = fs.readdirSync(dir).filter(file => /^(LICENSE|LICENCE|COPYING|NOTICE)(\.|$)/i.test(file)).sort();
  if (!files.length) throw new Error(`Missing license notice for ${name}`);
  notices += `## ${packageJson.name} ${entry.version}\n\n`;
  notices += `Lockfile license identifier: ${entry.license || 'not provided; consult verbatim notice below'}\n\n`;
  for (const file of files) {
    const content = fs.readFileSync(path.join(dir, file), 'utf8').trimEnd();
    notices += `### ${file}\n\n\`\`\`text\n${content}\n\`\`\`\n\n`;
  }
}
fs.writeFileSync(path.join(docs, 'THIRD-PARTY-NOTICES.md'), notices.trimEnd() + '\n');
console.log(`Generated full SPDX (${allCount} packages), runtime SPDX (${runtimeCount} packages), and ${runtime.length} runtime dependency notices.`);
