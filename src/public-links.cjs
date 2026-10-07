'use strict';

// The renderer supplies a symbolic destination, never a URL or shell argument.
const PUBLIC_LINKS = Object.freeze({
  repository: 'https://github.com/zeidlern/NerdSSHell',
  manual: 'https://github.com/zeidlern/NerdSSHell/wiki',
  connections: 'https://github.com/zeidlern/NerdSSHell/wiki/Connections-and-Trust',
  troubleshooting: 'https://github.com/zeidlern/NerdSSHell/wiki/Troubleshooting',
  issues: 'https://github.com/zeidlern/NerdSSHell/issues/new/choose',
  releases: 'https://github.com/zeidlern/NerdSSHell/releases'
});

function installPublicLinks({ handle, shell }) {
  handle('publicLink', destination => {
    if (typeof destination !== 'string' || !Object.hasOwn(PUBLIC_LINKS, destination)) throw new Error('Unknown help destination.');
    return shell.openExternal(PUBLIC_LINKS[destination]);
  });
}

module.exports = { PUBLIC_LINKS, installPublicLinks };
