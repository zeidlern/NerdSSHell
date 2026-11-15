'use strict';
const path = require('node:path');
const { spawn } = require('node:child_process');
const { prepareSdk } = require('./lib/electron-sdk.cjs');
prepareSdk().then(directory => {
  const child = spawn(path.join(directory, 'electron.exe'), ['.', ...process.argv.slice(2)], {
    cwd: path.resolve(__dirname, '..'), stdio: 'inherit', env: { ...process.env, ELECTRON_OVERRIDE_DIST_PATH: directory }
  });
  child.once('error', error => { console.error(error.message); process.exitCode = 1; });
  child.once('exit', code => { process.exitCode = code ?? 1; });
}).catch(error => { console.error(error.message); process.exitCode = 1; });
