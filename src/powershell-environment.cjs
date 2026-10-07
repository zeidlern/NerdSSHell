'use strict';
const path = require('node:path');

// Windows PowerShell launched through Node can inherit PS7's module search path.
// Remove only these known PS7 installation/shared paths in the new child's
// environment. Keep personal, Windows PowerShell and custom entries verbatim;
// this does not infer redirected Documents or arbitrary PS7 config paths.
function windowsPowerShellEnvironment(env = process.env) {
  const child = { ...env }, keys = Object.keys(child);
  const programFiles = child[keys.find(key => key.toLowerCase() === 'programfiles')] || 'C:\\Program Files';
  const comparable = value => path.win32.normalize(value.trim()).replace(/[\\/]+$/, '').toLowerCase();
  const excluded = new Set([
    path.win32.join(programFiles, 'PowerShell', '7', 'Modules'),
    path.win32.join(programFiles, 'PowerShell', 'Modules')
  ].map(comparable));
  for (const key of keys) if (key.toLowerCase() === 'psmodulepath' && typeof child[key] === 'string') {
    child[key] = child[key].split(';').filter(entry => !excluded.has(comparable(entry))).join(';');
  }
  return child;
}

module.exports = { windowsPowerShellEnvironment };
