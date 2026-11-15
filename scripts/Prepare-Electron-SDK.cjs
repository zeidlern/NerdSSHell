'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { prepareSdk } = require('./lib/electron-sdk.cjs');
if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--github-env')) throw new Error('Use only --github-env for CI.');
prepareSdk().then(directory => {
  if (process.argv[2] === '--github-env') {
    if (!path.isAbsolute(process.env.GITHUB_ENV || '') || /[\r\n]/.test(directory)) throw new Error('A valid GitHub environment file is required.');
    fs.appendFileSync(process.env.GITHUB_ENV, `ELECTRON_OVERRIDE_DIST_PATH=${directory}\n`);
  }
  console.log(`Verified Electron SDK: ${directory}`);
}).catch(error => { console.error(error.message); process.exitCode = 1; });
