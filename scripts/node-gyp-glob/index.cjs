'use strict';

const { glob: matchFiles } = require('glob');

// node-gyp 12.4.0 uses only these two queries when choosing a Windows build tool.
function glob(pattern, options) {
  if (!['build/*.sln', 'build/*.mk'].includes(pattern) || options?.expandDirectories !== false) {
    throw new Error('Unsupported node-gyp file search');
  }
  return matchFiles(pattern, { nodir: true, nocase: false, posix: true });
}

module.exports = { glob };
