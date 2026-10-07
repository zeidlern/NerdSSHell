'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { PACKAGE_NAME } = require('./branding.cjs');

// This is a compatibility alias for saved profiles, trust pins and recordings.
// Never migrate, merge or remove either directory during startup.
const LEGACY_DATA_DIRECTORY = 'betterssh';

function directoryExists(directory, fileSystem) {
  let stat;
  try { stat = fileSystem.lstatSync(directory); }
  catch (error) {
    if (error.code === 'ENOENT') return false;
    throw new Error(`Cannot inspect application data directory: ${directory}`, { cause: error });
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Application data path must be an ordinary directory: ${directory}`);
  return true;
}

function selectUserDataDirectory({ appDataDirectory, userDataOverride, testDataDirectory, isPackaged = true, fileSystem = fs }) {
  // An explicit --user-data-dir launch deliberately selects its own profile,
  // including for packaged acceptance. Never inspect or fall back to defaults
  // when that override is invalid or inaccessible.
  if (userDataOverride) {
    if (typeof userDataOverride !== 'string' || !path.isAbsolute(userDataOverride)) throw new Error('User data override must be an absolute path.');
    const directory = path.normalize(userDataOverride);
    directoryExists(directory, fileSystem);
    return { directory, source: 'override', otherDirectoryPresent: false };
  }
  // Test fixtures can override storage only in source launches.
  if (!isPackaged && testDataDirectory) {
    if (!path.isAbsolute(testDataDirectory)) throw new Error('Test data directory must be an absolute path.');
    const directory = path.normalize(testDataDirectory);
    directoryExists(directory, fileSystem);
    return { directory, source: 'test', otherDirectoryPresent: false };
  }
  if (!appDataDirectory || !path.isAbsolute(appDataDirectory)) throw new Error('Application data root must be an absolute path.');
  const legacyDirectory = path.join(appDataDirectory, LEGACY_DATA_DIRECTORY);
  const currentDirectory = path.join(appDataDirectory, PACKAGE_NAME);
  // Inspect both candidates before choosing. Errors must not hide old settings
  // behind a newly created empty profile. When both exist, retain legacy data
  // and report the other directory; resolving that state requires owner intent.
  const legacyExists = directoryExists(legacyDirectory, fileSystem);
  const currentExists = directoryExists(currentDirectory, fileSystem);
  if (legacyExists) return { directory: legacyDirectory, source: 'legacy', otherDirectoryPresent: currentExists };
  return { directory: currentDirectory, source: currentExists ? 'current' : 'new', otherDirectoryPresent: false };
}

module.exports = { LEGACY_DATA_DIRECTORY, selectUserDataDirectory };
