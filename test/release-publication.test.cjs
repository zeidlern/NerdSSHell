'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateRun, validateChecks, validateAssets } = require('../scripts/Publish-Input-Fix.cjs');
const sha = '1'.repeat(40);
const run = () => ({ id: 1, head_sha: sha, head_branch: 'main', head_repository: { full_name: 'zeidlern/NerdSSHell' },
  event: 'push', path: '.github/workflows/build.yml', status: 'completed', conclusion: 'success' });
test('publication requires successful exact-main push evidence, never PR/fork or stale runs', () => {
  validateRun(run(), sha);
  for (const change of [r => r.head_sha = '2'.repeat(40), r => r.head_branch = 'fix/test', r => r.event = 'pull_request',
    r => r.head_repository.full_name = 'other/NerdSSHell', r => r.conclusion = 'failure', r => r.status = 'in_progress',
    r => r.path = '.github/workflows/other.yml', r => r.id = '1']) {
    const candidate = run(); change(candidate); assert.throws(() => validateRun(candidate, sha));
  }
});
test('all latest exact-source validation workflows must succeed', () => {
  const runs = ['build', 'security', 'codeql'].map((name, i) => ({ ...run(), id: i + 1, path: `.github/workflows/${name}.yml` }));
  validateChecks(runs, sha);
  assert.throws(() => validateChecks(runs.slice(0, 2), sha));
  assert.throws(() => validateChecks([...runs, { ...runs[1], id: 4, conclusion: 'failure' }], sha));
  assert.throws(() => validateChecks(runs.map(r => ({ ...r, event: 'pull_request' })), sha));
});
test('release assets require exact names, uploaded state, sizes and GitHub SHA256 digests', () => {
  const expected = [{ name: 'installer.exe', size: 42, sha256: 'a'.repeat(64) }];
  const asset = { name: 'installer.exe', size: 42, digest: 'sha256:' + 'a'.repeat(64), state: 'uploaded' };
  validateAssets([asset], expected);
  for (const change of [a => a.name = 'other.exe', a => a.size++, a => a.digest = null, a => a.state = 'new']) {
    const candidate = { ...asset }; change(candidate); assert.throws(() => validateAssets([candidate], expected));
  }
  assert.throws(() => validateAssets([asset, asset], expected));
  assert.throws(() => validateAssets([], expected));
});
