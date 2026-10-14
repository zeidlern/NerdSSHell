'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const { hostedEnvironment, FROM, TO } = require('../scripts/Published-Update-Smoke.cjs');
const permitted = {
  GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_REPOSITORY: 'zeidlern/NerdSSHell',
  RUNNER_TEMP: os.tmpdir(), GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_ACTOR: 'zeidlern', GITHUB_REF: 'refs/heads/main'
};
test('real consumer installer fixture refuses workstations, self-hosted runners, forks and unreviewed dispatch', () => {
  assert.doesNotThrow(() => hostedEnvironment(permitted, 'win32'));
  assert.throws(() => hostedEnvironment(permitted, 'linux'));
  for (const replacement of [
    { GITHUB_ACTIONS: undefined }, { GITHUB_ACTIONS: 'false' }, { RUNNER_ENVIRONMENT: 'self-hosted' },
    { GITHUB_REPOSITORY: 'other/NerdSSHell' }, { RUNNER_TEMP: undefined }, { RUNNER_TEMP: 'relative' },
    { GITHUB_EVENT_NAME: 'push' }, { GITHUB_ACTOR: 'other' }, { GITHUB_REF: 'refs/heads/feature' }
  ]) assert.throws(() => hostedEnvironment({ ...permitted, ...replacement }, 'win32'));
  const internal = { ...permitted, GITHUB_EVENT_NAME: 'pull_request', NERDSSHELL_ACCEPTANCE_HEAD_REPOSITORY: 'zeidlern/NerdSSHell' };
  assert.doesNotThrow(() => hostedEnvironment(internal, 'win32'));
  assert.throws(() => hostedEnvironment({ ...internal, NERDSSHELL_ACCEPTANCE_HEAD_REPOSITORY: 'other/NerdSSHell' }, 'win32'));
});
test('published consumer acceptance binds original immutable installers rather than newly rebuilt bytes', () => {
  assert.deepEqual(FROM, { version: '1.2.1', sha256: '446b31fab8a00bca32b68d2e4ca9d257392e60b21eb03e16fc7105fc91269e24' });
  assert.deepEqual(TO, { version: '1.2.2', sha256: '8376baa0339283db4400098c8b68f0d6ce8dfbab2bdb576d1a3a19c85b07b74c' });
});
