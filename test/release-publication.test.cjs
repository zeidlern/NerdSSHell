'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { REPO, WORKFLOWS, versionFromTag, compareVersions, validateSource, validateRun, selectRuns,
  validateJobs, validateArtifact, validateAssets, validateInventory, createClient, createPublisher } = require('../scripts/Publish-Release.cjs');
const base = `/repos/${REPO}`, sha = '1'.repeat(40), mainSha = '2'.repeat(40), version = '2.3.4', tag = 'v' + version;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const lock = { name: 'nerdsshell', version, packages: {
  '': { name: 'nerdsshell', version }, 'node_modules/runtime': { version: '1.0.0' },
  'node_modules/dev': { version: '2.0.0', dev: true }, 'node_modules/optional': { version: '3.0.0', optional: true }
} };
const pkg = { name: 'nerdsshell', version };
const inventory = runtime => ({ spdxVersion: 'SPDX-2.3', name: `nerdsshell@${version}`, packages: [
  { name: 'nerdsshell', versionInfo: version }, { name: 'runtime', versionInfo: '1.0.0' },
  ...(runtime ? [] : [{ name: 'dev', versionInfo: '2.0.0' }, { name: 'optional', versionInfo: '3.0.0' }])
] });
function run(workflow = 'build.yml', id = 1) {
  return { id, head_sha: sha, head_branch: 'main', head_repository: { full_name: REPO }, event: 'push',
    path: `.github/workflows/${workflow}`, status: 'completed', conclusion: 'success', run_attempt: 1,
    run_started_at: '2026-10-14T00:00:00Z' };
}
function jobs(workflow, selected) {
  return WORKFLOWS[workflow].map(name => ({ name, run_id: selected.id, run_attempt: selected.run_attempt,
    status: 'completed', conclusion: 'success' }));
}
function artifact(selected = run()) {
  return { id: 10, name: 'NerdSSHell-Windows-x64', expired: false, size_in_bytes: 42,
    created_at: '2026-10-14T00:01:00Z', workflow_run: { id: selected.id, head_sha: selected.head_sha, head_branch: 'main' } };
}
function fixture(t, { published = false, draft = false, newer = false } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nerdsshell-publication-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const eventPath = path.join(temp, 'event.json'); fs.writeFileSync(eventPath, JSON.stringify({ inputs: { tag } }));
  const env = { RUNNER_TEMP: temp, GITHUB_REPOSITORY: REPO, GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_PATH: eventPath };
  const files = { 'package.json': JSON.stringify(pkg), 'package-lock.json': JSON.stringify(lock),
    'CHANGELOG.md': `# Changelog\n\n## ${version} — New fix\n\n- A meaningful fix.\n\n## 2.3.3\n\n- Prior fix.\n`,
    LICENSE: 'The exact source license\n', 'docs/THIRD-PARTY-NOTICES.md': 'The exact source notices\n' };
  const payloads = {
    [`NerdSSHell-${version}-x64-Setup.exe`]: Buffer.from('Accepted Windows installer'),
    [`NerdSSHell-user-manual-${version}.zip`]: Buffer.from('Deterministic tracked manual archive'),
    'LICENSE.txt': Buffer.from(files.LICENSE), 'SBOM.spdx.json': Buffer.from(JSON.stringify(inventory(false))),
    'SBOM-runtime.spdx.json': Buffer.from(JSON.stringify(inventory(true))),
    'THIRD-PARTY-NOTICES.md': Buffer.from(files['docs/THIRD-PARTY-NOTICES.md'])
  };
  payloads['SHA256SUMS.txt'] = Buffer.from(Object.keys(payloads).sort().map(name => `${hash(payloads[name])}  ${name}\n`).join(''));
  const expected = Object.keys(payloads).sort().map((name, i) => ({ id: 100 + i, name,
    size: payloads[name].length, digest: `sha256:${hash(payloads[name])}`, state: 'uploaded',
    browser_download_url: `https://github.com/${REPO}/releases/download/${tag}/${name}` }));
  const state = { runs: Object.keys(WORKFLOWS).map((workflow, i) => run(workflow, i + 1)),
    jobChange: () => {}, tagRef: { ref: `refs/tags/${tag}`, object: { type: 'commit', sha } },
    lineage: { status: 'ahead', merge_base_commit: { sha } }, artifact: artifact(),
    release: published || draft ? { id: 44, tag_name: tag, target_commitish: sha, draft: !published, prerelease: false,
      html_url: `https://github.com/${REPO}/releases/tag/${tag}`, assets: published ? structuredClone(expected) : [] } : null,
    latest: { id: newer ? 99 : published ? 44 : 33, tag_name: newer ? 'v9.0.0' : published ? tag : 'v2.3.3', draft: false, prerelease: false },
    calls: [], uploads: [], downloads: 0, payloads, files, expected, downloadedChange: () => {}, afterRequest: () => {} };
  async function request(endpoint, options = {}) {
    state.calls.push({ endpoint, ...options }); let result;
    if (endpoint === `${base}/git/ref/tags/${tag}`) result = state.tagRef;
    else if (endpoint === `${base}/commits/${tag}`) result = { sha };
    else if (endpoint === `${base}/git/ref/heads/main`) result = { object: { sha: mainSha } };
    else if (endpoint === `${base}/compare/${sha}...${mainSha}`) result = state.lineage;
    else if (/\/actions\/runs\/\d+$/.test(endpoint)) result = state.runs.find(item => endpoint.endsWith('/' + item.id));
    else if (endpoint === `${base}/releases/tags/${tag}`) result = state.release;
    else if (endpoint === `${base}/releases/latest`) result = state.latest;
    else if (options.binary) {
      const item = state.release.assets.find(item => endpoint.endsWith('/' + item.id));
      result = state.payloads[item.name]; if (state.binaryChange) result = state.binaryChange(item, result);
      return result;
    } else if (options.upload) {
      const name = decodeURIComponent(endpoint.split('?name=')[1]); state.uploads.push(name);
      assert.ok(!state.release.assets.some(item => item.name === name), 'Assets must never be overwritten');
      state.release.assets.push({ id: 200 + state.uploads.length, name, state: 'uploaded', size: options.body.length,
        digest: `sha256:${hash(options.body)}`, browser_download_url: `https://github.com/${REPO}/releases/download/${tag}/${name}` });
      state.payloads[name] = options.body; result = state.release.assets.at(-1);
    } else if (options.method === 'POST') {
      assert.equal(endpoint, base + '/releases'); assert.ok(state.tagRef, 'Tag must exist before draft creation');
      state.release = { ...options.body, id: 44, html_url: `https://github.com/${REPO}/releases/tag/${tag}`, assets: [] }; result = state.release;
    } else if (options.method === 'PATCH') {
      assert.equal(endpoint, base + '/releases/44'); Object.assign(state.release, options.body); result = state.release;
      if (options.body.make_latest === 'true') state.latest = structuredClone(state.release);
    } else throw new Error('Unexpected test API call: ' + endpoint);
    state.afterRequest(endpoint, options); return structuredClone(result);
  }
  async function list(endpoint, key, options = {}) {
    state.calls.push({ endpoint, key, ...options });
    if (key === 'workflow_runs') return structuredClone(state.runs.filter(item => endpoint.includes(item.path.split('/').at(-1))));
    if (key === 'jobs') {
      const selected = state.runs.find(item => endpoint.includes(`/runs/${item.id}/`));
      const workflow = selected.path.split('/').at(-1), result = jobs(workflow, selected); state.jobChange(result, workflow); return result;
    }
    if (key === 'artifacts') return [structuredClone(state.artifact)];
    if (/\/releases\/44\/assets$/.test(endpoint)) return structuredClone(state.release.assets);
    throw new Error('Unexpected test API list: ' + endpoint);
  }
  const git = args => {
    if (args[0] === 'show') { assert.ok(args[1].startsWith(sha + ':')); return state.files[args[1].slice(sha.length + 1)]; }
    assert.equal(args[0], 'archive'); assert.equal(args[3], sha); assert.equal(args[4], 'docs/wiki');
    fs.writeFileSync(args[2].slice('--output='.length), payloads[`NerdSSHell-user-manual-${version}.zip`]);
  };
  const download = (runId, build) => {
    state.downloads++; assert.equal(runId, 1); fs.mkdirSync(path.join(build, 'dist')); fs.mkdirSync(path.join(build, 'docs'));
    const name = `NerdSSHell-${version}-x64-Setup.exe`; fs.writeFileSync(path.join(build, 'dist', name), payloads[name]);
    fs.writeFileSync(path.join(build, 'dist', 'SHA256.txt'), `Algorithm: SHA256\nHash: ${hash(payloads[name]).toUpperCase()}\n`);
    fs.writeFileSync(path.join(build, 'package-lock.json'), JSON.stringify(lock, null, 2).replaceAll('\n', '\r\n'));
    for (const name of ['SBOM.spdx.json', 'SBOM-runtime.spdx.json', 'THIRD-PARTY-NOTICES.md']) fs.writeFileSync(path.join(build, 'docs', name), payloads[name]);
    state.downloadedChange(build);
  };
  return { publisher: createPublisher({ client: { request, list }, env, git, download, log: () => {} }), state, temp, env, eventPath };
}
test('publication is generic for strict stable versions and synchronized source/changelog', () => {
  assert.equal(versionFromTag(tag), version); assert.equal(compareVersions('2.10.0', '2.9.9'), 1); assert.equal(compareVersions(version, version), 0);
  for (const bad of ['v1.2', 'v01.2.3', 'v1.2.3-beta', '1.2.3', '../main', 'v1.2.3\n']) assert.throws(() => versionFromTag(bad));
  validateSource(pkg, lock, `## ${version}\n\n- Fix.\n`, tag);
  assert.throws(() => validateSource({ ...pkg, version: '2.3.5' }, lock, `## ${version}\n- Fix.`, tag));
  assert.throws(() => validateSource(pkg, lock, '## 2.3.3\n- Fix.', tag));
  assert.throws(() => validateSource(pkg, lock, '## 2.3.40\n- Wrong version prefix.', tag));
  assert.throws(() => validateSource(pkg, lock, '## 2.3.4-beta\n- Prerelease is not stable.', tag));
  assert.throws(() => validateSource(pkg, { ...lock, version: '2.3.3' }, `## ${version}\n- Fix.`, tag));
});
test('exact-main push runs exclude stale source, fork, PR, unfinished, failed and bad identity', () => {
  validateRun(run(), sha, 'build.yml');
  for (const change of [r => r.head_sha = mainSha, r => r.head_branch = 'fix/test', r => r.event = 'pull_request',
    r => r.head_repository.full_name = 'other/NerdSSHell', r => r.conclusion = 'failure', r => r.status = 'in_progress',
    r => r.path = '.github/workflows/other.yml', r => r.id = '1', r => r.run_attempt = 0]) {
    const candidate = run(); change(candidate); assert.throws(() => validateRun(candidate, sha, 'build.yml'));
  }
});
test('latest exact-source workflow attempt must pass; earlier success cannot hide failed/incomplete reruns', () => {
  const runs = Object.keys(WORKFLOWS).map((workflow, i) => run(workflow, i + 1)); selectRuns(runs, sha);
  assert.throws(() => selectRuns(runs.slice(0, 2), sha));
  for (const extra of [{ ...runs[0], id: 5, conclusion: 'failure' }, { ...runs[0], id: 5, status: 'in_progress' }])
    assert.throws(() => selectRuns([...runs, extra], sha));
});
test('workflow success requires every concrete Windows/security/CodeQL job from exact run attempt', () => {
  for (const workflow of Object.keys(WORKFLOWS)) {
    const selected = run(workflow); validateJobs(jobs(workflow, selected), workflow, selected);
    for (const change of [list => list.pop(), list => list[0].conclusion = 'skipped', list => list[0].status = 'in_progress',
      list => list[0].run_id++, list => list[0].run_attempt++, list => list.push(list[0])]) {
      const candidate = jobs(workflow, selected); change(candidate); assert.throws(() => validateJobs(candidate, workflow, selected));
    }
  }
});
test('Windows artifact must be unexpired exact-source and newer than accepted run attempt', () => {
  validateArtifact(artifact(), run());
  for (const change of [a => a.expired = true, a => a.workflow_run.head_sha = mainSha, a => a.workflow_run.id = 99,
    a => a.workflow_run.head_branch = 'feature', a => a.created_at = '2026-10-13T00:00:00Z', a => a.size_in_bytes = 0]) {
    const candidate = artifact(); change(candidate); assert.throws(() => validateArtifact(candidate, run()));
  }
});
test('inventories bind full and runtime package/version sets to exact tagged lockfile', () => {
  validateInventory(JSON.stringify(inventory(false)), version, lock, false); validateInventory(JSON.stringify(inventory(true)), version, lock, true);
  assert.throws(() => validateInventory(JSON.stringify(inventory(false)), version, lock, true));
  const changed = inventory(false); changed.packages[1].versionInfo = '9.0.0';
  assert.throws(() => validateInventory(JSON.stringify(changed), version, lock, false));
});
test('release assets reject replacements, duplicates and unexpected draft files', () => {
  const expected = [{ name: 'installer.exe', size: 42, sha256: 'a'.repeat(64) }];
  const asset = { id: 1, name: 'installer.exe', size: 42, digest: 'sha256:' + 'a'.repeat(64), state: 'uploaded' };
  validateAssets([asset], expected); validateAssets([], expected, true);
  for (const change of [a => a.name = 'other.exe', a => a.size++, a => a.digest = null, a => a.state = 'new']) {
    const candidate = { ...asset }; change(candidate); assert.throws(() => validateAssets([candidate], expected, true));
  }
  assert.throws(() => validateAssets([asset, asset], expected)); assert.throws(() => validateAssets([], expected));
});
test('missing owner tag fails before asset download or release mutation', async t => {
  const { publisher, state } = fixture(t); state.tagRef = null; await assert.rejects(publisher.prepare(), /Owner must create/);
  assert.equal(state.downloads, 0); assert.ok(state.calls.every(item => !item.method));
});
test('wrong tag commit fails before publication', async t => {
  const { publisher, state } = fixture(t); state.tagRef.object.sha = mainSha;
  await assert.rejects(publisher.prepare()); assert.equal(state.downloads, 0);
});
test('tag cannot authorize source outside protected main even with successful CI', async t => {
  const { publisher, state } = fixture(t); state.lineage = { status: 'diverged', merge_base_commit: { sha: mainSha } };
  await assert.rejects(publisher.prepare(), /protected-main history/); assert.equal(state.downloads, 0);
});
test('automatic publication accepts owner tag creation; rejects branch push/tag deletion/tag update', async t => {
  const { publisher, env, eventPath } = fixture(t); env.GITHUB_EVENT_NAME = 'push'; env.GITHUB_REF = `refs/tags/${tag}`;
  fs.writeFileSync(eventPath, JSON.stringify({ ref: env.GITHUB_REF, created: true, deleted: false, after: sha })); await publisher.context();
  for (const change of [{ created: false }, { deleted: true }, { ref: 'refs/heads/main' }, { after: mainSha }]) {
    fs.writeFileSync(eventPath, JSON.stringify({ ref: env.GITHUB_REF, created: true, deleted: false, after: sha, ...change }));
    await assert.rejects(publisher.context());
  }
});
test('missing/incomplete/skipped CI prevents accepted artifact download', async t => {
  for (const change of [s => s.runs.pop(), s => s.runs[1].status = 'in_progress', s => s.jobChange = list => list[0].conclusion = 'skipped']) {
    const { publisher, state } = fixture(t); change(state); await assert.rejects(publisher.prepare());
    assert.equal(state.downloads, 0); assert.equal(state.release, null);
  }
});
test('expired/stale artifact or stale lock/installer/inventory bytes fail before draft creation', async t => {
  for (const change of [s => s.artifact.expired = true, s => s.artifact.created_at = '2026-10-13T00:00:00Z',
    s => s.downloadedChange = build => fs.writeFileSync(path.join(build, 'package-lock.json'), '{}'),
    s => s.downloadedChange = build => fs.appendFileSync(path.join(build, 'dist', `NerdSSHell-${version}-x64-Setup.exe`), 'tamper'),
    s => s.downloadedChange = build => fs.writeFileSync(path.join(build, 'docs', 'SBOM-runtime.spdx.json'), JSON.stringify(inventory(false)))]) {
    const { publisher, state } = fixture(t); change(state); await assert.rejects(publisher.prepare()); assert.equal(state.release, null);
  }
});
test('new publication copies accepted installer, uploads seven assets, publishes and verifies public latest', async t => {
  const { publisher, state } = fixture(t); await publisher.prepare(); await publisher.publish();
  assert.equal(state.downloads, 1); assert.equal(state.uploads.length, 7); assert.equal(state.release.draft, false);
  assert.equal(state.release.make_latest, 'true'); assert.equal(state.release.target_commitish, sha);
  const creates = state.calls.filter(item => item.method === 'POST' && !item.upload);
  assert.equal(creates.length, 1); assert.equal(creates[0].body.draft, true); assert.equal(creates[0].body.make_latest, 'false');
  assert.ok(state.calls.every(item => !/\/git\//.test(item.endpoint) || !item.method));
  assert.ok(state.calls.some(item => item.public && item.endpoint.endsWith('/releases/latest')));
});
test('draft retry preserves identical existing asset IDs and uploads only missing files', async t => {
  const { publisher, state } = fixture(t, { draft: true }); state.release.assets = [structuredClone(state.expected[0])];
  const priorId = state.release.assets[0].id; await publisher.prepare(); await publisher.publish();
  assert.equal(state.uploads.length, 6); assert.equal(state.release.assets[0].id, priorId); assert.equal(state.release.draft, false);
});
test('draft retry publishes canonical version/changelog/evidence notes instead of stale draft metadata', async t => {
  const { publisher, state } = fixture(t, { draft: true });
  state.release.name = 'v9.0.0'; state.release.body = 'Wrong version and stale validation';
  await publisher.prepare(); await publisher.publish();
  assert.equal(state.release.name, tag); assert.match(state.release.body, /A meaningful fix/);
  assert.match(state.release.body, new RegExp(sha)); assert.match(state.release.body, /actions\/runs\/1/);
});
test('changed prepared release notes cannot be published', async t => {
  const { publisher, state, temp } = fixture(t); await publisher.prepare();
  fs.appendFileSync(path.join(temp, 'release-notes.md'), '\nUnreviewed metadata mutation');
  await assert.rejects(publisher.publish(), /release notes changed/); assert.equal(state.release, null);
});
test('changed draft asset fails before upload/publication and remains draft', async t => {
  const { publisher, state } = fixture(t, { draft: true }); await publisher.prepare();
  state.release.assets = [{ ...state.expected[0], digest: 'sha256:' + '0'.repeat(64) }];
  await assert.rejects(publisher.publish(), /SHA-256 differs/); assert.equal(state.uploads.length, 0); assert.equal(state.release.draft, true);
});
test('published retry verifies remote bytes without build, upload, retarget or latest changes', async t => {
  const { publisher, state } = fixture(t, { published: true, newer: true }); const before = structuredClone(state.release);
  state.runs = []; await publisher.prepare(); await publisher.publish(); assert.equal(state.downloads, 0);
  assert.equal(state.uploads.length, 0); assert.deepEqual(state.release, before);
  assert.ok(state.calls.every(item => !item.method && !item.endpoint.includes('/actions/')));
  assert.ok(state.calls.some(item => item.public && item.binary));
});
test('published retry rejects corrupted bytes even when metadata digest looks correct', async t => {
  const { publisher, state } = fixture(t, { published: true }); state.binaryChange = (item, bytes) => Buffer.concat([bytes, Buffer.from('tamper')]);
  await assert.rejects(publisher.prepare(), /download size differs/); assert.ok(state.calls.every(item => !item.method));
});
test('published checksum manifest must match all six payloads, including inventories', async t => {
  const { publisher, state } = fixture(t, { published: true }); const name = 'SHA256SUMS.txt';
  state.payloads[name] = Buffer.from(state.payloads[name].toString().replace(/^[0-9a-f]{64}/, '0'.repeat(64)));
  state.release.assets.find(item => item.name === name).digest = `sha256:${hash(state.payloads[name])}`;
  await assert.rejects(publisher.prepare(), /manifest does not match/);
});
test('older unpublished recovery cannot replace a newer public latest', async t => {
  const { publisher, state } = fixture(t, { newer: true }); await publisher.prepare(); await publisher.publish();
  assert.equal(state.release.make_latest, 'false'); assert.equal(state.latest.id, 99);
});
test('CI rerun/tag move after preparation prevents draft mutation', async t => {
  for (const change of [s => s.runs[0].run_attempt++, s => s.tagRef.object.sha = mainSha]) {
    const { publisher, state } = fixture(t); await publisher.prepare(); change(state); await assert.rejects(publisher.publish());
    assert.equal(state.release, null); assert.equal(state.uploads.length, 0);
  }
});
test('draft payload download failure leaves draft without publication', async t => {
  const { publisher, state } = fixture(t); await publisher.prepare();
  state.binaryChange = (item, bytes) => Buffer.concat([bytes, Buffer.from('tamper')]); await assert.rejects(publisher.publish());
  assert.equal(state.release.draft, true); assert.ok(!state.calls.some(item => item.method === 'PATCH'));
});
test('API failure retains actionable ruleset errors/request ID and redacts token', async () => {
  const token = 'fixture-secret-token';
  const client = createClient({ token, fetchImpl: async () => new Response(JSON.stringify({ message: 'Repository rule violations',
    errors: [{ resource: 'Reference', code: 'creation_restricted', message: `Protected tag denied ${token}` }],
    documentation_url: 'https://docs.github.com/rest', authorization: token }),
    { status: 422, headers: { 'x-github-request-id': 'fixture-request' } }) });
  await assert.rejects(client.request(base + '/releases', { method: 'POST', body: { draft: true } }), error => {
    assert.match(error.message, /HTTP 422/); assert.match(error.message, /creation_restricted/);
    assert.match(error.message, /fixture-request/); assert.match(error.message, /documentation_url/);
    assert.ok(!error.message.includes(token)); return true;
  });
});
test('client forbids ref/destructive writes and never sends token to public verification/CDN', async () => {
  const calls = [], client = createClient({ token: 'fixture-token', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.startsWith('https://api.github.com')) return new Response(null,
      { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/fixture?signature=safe' } });
    return new Response('asset');
  } });
  for (const options of [{ method: 'POST' }, { method: 'PATCH' }, { method: 'DELETE' }])
    await assert.rejects(client.request(base + '/git/refs/tags/' + tag, options), /forbidden/);
  await assert.rejects(client.request('/repos/other/NerdSSHell/releases'), /official repository/);
  assert.equal((await client.request(base + '/releases/assets/1', { binary: true })).toString(), 'asset');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer fixture-token'); assert.equal(calls[1].options.headers, undefined);
  await client.request(base + '/releases/assets/1', { binary: true, public: true });
  assert.equal(calls[2].options.headers.Authorization, undefined);
});
