'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');

if (process.platform !== 'win32') throw new Error('Signed NerdSSHell installers are built on Windows only.');
const link = process.env.WIN_CSC_LINK || process.env.CSC_LINK;
const password = process.env.WIN_CSC_KEY_PASSWORD || process.env.CSC_KEY_PASSWORD;
const thumbprint = process.env.NERDSSHELL_EXPECTED_SIGNER_THUMBPRINT;
if (!link || !password || !/^[a-f0-9]{40}$/i.test(thumbprint || '')) {
  throw new Error('Signing requires WIN_CSC_LINK/CSC_LINK, WIN_CSC_KEY_PASSWORD/CSC_KEY_PASSWORD, and NERDSSHELL_EXPECTED_SIGNER_THUMBPRINT. No build was started.');
}
const root = path.join(__dirname, '..');
const { version, build: { productName } } = require(path.join(root, 'package.json'));
const builder = spawnSync(process.execPath, [require.resolve('electron-builder/cli.js'), '--win', 'nsis', '--x64', '--publish', 'never', '--config.forceCodeSigning=true', '--config.win.signAndEditExecutable=true', '--config.win.signExecutable=true'], { cwd: root, stdio: 'inherit' });
if (builder.error) throw builder.error;
if (builder.status !== 0) process.exit(builder.status || 1);
const app = path.join(root, 'dist', 'win-unpacked', productName + '.exe');
const installer = path.join(root, 'dist', `${productName}-${version}-x64-Setup.exe`);
const verify = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'Verify-Signed.ps1'), '-Application', app, '-Installer', installer, '-ExpectedThumbprint', thumbprint], { cwd: root, stdio: 'inherit' });
if (verify.error) throw verify.error;
if (verify.status !== 0) process.exit(verify.status || 1);
