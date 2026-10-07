'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
for (const folder of ['src', 'ui', 'scripts', 'test']) for (const name of fs.readdirSync(folder)) if (/\.(cjs|js)$/.test(name)) execFileSync(process.execPath, ['--check', path.join(folder, name)], { stdio: 'inherit' });
const metadata = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(metadata.version) || lock.version !== metadata.version || lock.packages[''].version !== metadata.version) throw new Error('Package and lockfile versions must be synchronized semantic versions.');
const { PRODUCT_NAME, APP_ID, LEGACY_PACKAGE_NAME } = require('../src/branding.cjs');
if (metadata.name !== LEGACY_PACKAGE_NAME || metadata.build.appId !== APP_ID || metadata.build.productName !== PRODUCT_NAME) throw new Error('Visible branding or stable compatibility identity is inconsistent.');
require('./Verify-Branding.cjs').verifySourceBranding();
const html = fs.readFileSync('ui/index.html', 'utf8');
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) if (!match[1].includes('node_modules') && !fs.existsSync(path.join('ui', match[1]))) throw new Error('Missing UI resource: ' + match[1]);
for (const uiFile of ['ui/app.js', 'ui/workbench.js', 'ui/pane-actions.js', 'ui/desktop-ux.js', 'ui/scratchpad.js']) for (const match of fs.readFileSync(uiFile, 'utf8').matchAll(/\$\('([^']+)'\)/g)) if (!html.includes(`id="${match[1]}"`)) throw new Error('Missing UI element: ' + match[1]);
console.log('JavaScript syntax, synchronized version/branding and static UI references passed.');

require('./Verify-Publication.cjs').verify();
execFileSync(process.execPath, ['--test', 'test/publication.test.cjs'], { stdio: 'inherit' });
