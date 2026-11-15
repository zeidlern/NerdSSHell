'use strict';
function assertRuntime(versions, expected) {
  if (!expected || ['electron', 'node', 'chrome'].some(key => versions?.[key] !== expected[key === 'electron' ? 'version' : key])) {
    throw new Error('The Electron runtime differs from the reviewed application runtime. Rebuild with the pinned official SDK.');
  }
}
module.exports = { assertRuntime };
