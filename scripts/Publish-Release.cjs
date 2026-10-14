'use strict';

// A protected, owner-created tag authorizes publication. This script cannot write
// Git refs, replace assets, rebuild installers or modify an already published release.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const REPO = 'zeidlern/NerdSSHell';
const BASE = `/repos/${REPO}`;
const STABLE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA = /^[0-9a-f]{40}$/;
const WORKFLOWS = {
  'build.yml': ['tests', 'windows'],
  'security.yml': ['dependencies', 'secrets'],
  'codeql.yml': ['analyze (javascript-typescript)', 'analyze (actions)']
};
const MAX_BYTES = 512 * 1024 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = file => digest(fs.readFileSync(file));

function versionFromTag(tag) {
  assert.equal(typeof tag, 'string', 'A stable existing version tag is required');
  assert.ok(tag.startsWith('v') && STABLE.test(tag.slice(1)), 'Use an existing stable tag such as v1.2.3');
  return tag.slice(1);
}
function compareVersions(a, b) {
  assert.match(a, STABLE); assert.match(b, STABLE);
  const left = a.split('.').map(BigInt), right = b.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}
function expectedNames(version) {
  assert.match(version, STABLE);
  return [`NerdSSHell-${version}-x64-Setup.exe`, `NerdSSHell-user-manual-${version}.zip`,
    'LICENSE.txt', 'SBOM.spdx.json', 'SBOM-runtime.spdx.json', 'THIRD-PARTY-NOTICES.md', 'SHA256SUMS.txt'].sort();
}
function validateSource(pkg, lock, changelog, tag) {
  const version = versionFromTag(tag);
  assert.equal(pkg.name, 'nerdsshell'); assert.equal(pkg.version, version, 'Tag and source package version differ');
  assert.equal(lock.name, pkg.name); assert.equal(lock.version, version);
  assert.equal(lock.packages?.['']?.name, pkg.name); assert.equal(lock.packages[''].version, version);
  const section = changelog.match(new RegExp(`^## ${version.replaceAll('.', '\\.')}((?=[ \\t\\r\\n]|$)[^\\n]*)\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'));
  assert.ok(section && section[2].trim(), `CHANGELOG.md needs a nonempty ${version} section`);
  return { version, changes: section[2].trim() };
}
function validateRun(run, sha, workflow) {
  assert.match(sha, SHA); assert.ok(Object.hasOwn(WORKFLOWS, workflow));
  assert.equal(run.head_sha, sha); assert.equal(run.head_branch, 'main');
  assert.equal(run.head_repository?.full_name, REPO); assert.equal(run.event, 'push');
  assert.equal(run.path, `.github/workflows/${workflow}`); assert.equal(run.status, 'completed', `${workflow} has not finished`);
  assert.equal(run.conclusion, 'success', `${workflow} did not pass`);
  assert.ok(Number.isSafeInteger(run.id) && run.id > 0);
  assert.ok(Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0);
}
function selectRuns(runs, sha) {
  const result = {};
  for (const workflow of Object.keys(WORKFLOWS)) {
    const latest = runs.filter(run => run.head_sha === sha && run.head_branch === 'main' &&
      run.head_repository?.full_name === REPO && run.event === 'push' && run.path === `.github/workflows/${workflow}`)
      .sort((a, b) => b.id - a.id)[0];
    assert.ok(latest, `No exact-source main push run for ${workflow}; wait for the protected-main gates`);
    validateRun(latest, sha, workflow); result[workflow] = latest;
  }
  return result;
}
function validateJobs(jobs, workflow, run) {
  assert.ok(Array.isArray(jobs));
  for (const name of WORKFLOWS[workflow]) {
    const matches = jobs.filter(job => job.name === name);
    assert.equal(matches.length, 1, `${workflow} must have exactly one ${name} job`);
    const job = matches[0];
    assert.equal(job.run_id, run.id); assert.equal(job.run_attempt, run.run_attempt);
    assert.equal(job.status, 'completed', `${name} has not finished`);
    assert.equal(job.conclusion, 'success', `${name} did not pass (skipped jobs do not authorize publication)`);
  }
  assert.ok(jobs.every(job => job.status === 'completed' && job.conclusion === 'success'),
    `${workflow} contains an incomplete, failed or skipped job`);
}
function validateArtifact(artifact, run) {
  assert.equal(artifact.name, 'NerdSSHell-Windows-x64'); assert.equal(artifact.expired, false, 'Validated Windows artifact expired');
  assert.ok(Number.isSafeInteger(artifact.id) && artifact.id > 0);
  assert.ok(Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0);
  assert.equal(artifact.workflow_run?.id, run.id); assert.equal(artifact.workflow_run.head_sha, run.head_sha);
  assert.equal(artifact.workflow_run.head_branch, 'main');
  const created = Date.parse(artifact.created_at), started = Date.parse(run.run_started_at);
  assert.ok(Number.isFinite(created) && Number.isFinite(started) && created >= started,
    'Windows artifact predates the accepted run attempt; do not reuse stale build bytes');
}
function validateAssets(assets, expected, partial = false) {
  assert.ok(Array.isArray(assets));
  if (!partial) assert.equal(assets.length, expected.length, 'Unexpected or missing release assets');
  for (const asset of assets) {
    const item = expected.find(item => item.name === asset.name);
    assert.ok(item, `Unexpected release asset ${asset.name}`);
    assert.equal(assets.filter(other => other.name === asset.name).length, 1, `Ambiguous asset ${asset.name}`);
    assert.equal(asset.state, 'uploaded', `${asset.name} is not fully uploaded`);
    assert.equal(asset.size, item.size, `${asset.name} size differs`);
    assert.equal(asset.digest, `sha256:${item.sha256}`, `${asset.name} SHA-256 differs`);
    assert.ok(Number.isSafeInteger(asset.id) && asset.id > 0);
  }
}
function validateInventory(bytes, version, lock, runtime) {
  const doc = JSON.parse(bytes);
  assert.equal(doc.spdxVersion, 'SPDX-2.3'); assert.equal(doc.name, `nerdsshell@${version}`);
  assert.ok(Array.isArray(doc.packages));
  const actual = new Set(doc.packages.map(item => `${item.name}@${item.versionInfo}`));
  const wanted = new Set([`nerdsshell@${version}`]);
  for (const [location, item] of Object.entries(lock.packages)) {
    if (!location || item.link || (runtime && (item.dev || item.optional))) continue;
    assert.ok(location.includes('node_modules/') && typeof item.version === 'string', 'Invalid locked package identity');
    const name = item.name || location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length);
    wanted.add(`${name}@${item.version}`);
  }
  assert.deepEqual([...actual].sort(), [...wanted].sort(), `${runtime ? 'Runtime' : 'Full'} inventory differs from exact-source lockfile`);
}
function validateFiles(dir, source) {
  const names = expectedNames(source.version);
  assert.deepEqual(fs.readdirSync(dir).sort(), names, 'Consumer directory must contain exactly the seven approved assets');
  const expected = names.map(name => {
    const stat = fs.lstatSync(path.join(dir, name));
    assert.ok(stat.isFile() && stat.size > 0 && stat.size <= MAX_BYTES, `Invalid consumer file ${name}`);
    return { name, size: stat.size, sha256: hash(path.join(dir, name)) };
  });
  const checksums = fs.readFileSync(path.join(dir, 'SHA256SUMS.txt'), 'utf8').trimEnd().split(/\r?\n/);
  const wanted = expected.filter(item => item.name !== 'SHA256SUMS.txt');
  assert.equal(checksums.length, wanted.length, 'Checksum manifest must cover all six payload assets exactly once');
  const parsed = checksums.map(line => {
    const match = /^([0-9a-f]{64}) {2}([^\/\\]+)$/.exec(line);
    assert.ok(match, 'Invalid SHA256SUMS.txt entry'); return { name: match[2], sha256: match[1] };
  });
  assert.deepEqual(parsed.sort((a, b) => a.name.localeCompare(b.name)),
    wanted.map(({ name, sha256 }) => ({ name, sha256 })).sort((a, b) => a.name.localeCompare(b.name)),
    'Checksum manifest does not match actual consumer bytes');
  validateInventory(fs.readFileSync(path.join(dir, 'SBOM.spdx.json'), 'utf8'), source.version, source.lock, false);
  validateInventory(fs.readFileSync(path.join(dir, 'SBOM-runtime.spdx.json'), 'utf8'), source.version, source.lock, true);
  assert.equal(digest(source.license), hash(path.join(dir, 'LICENSE.txt')), 'License differs from tagged source');
  assert.equal(digest(source.notices), hash(path.join(dir, 'THIRD-PARTY-NOTICES.md')), 'Notices differ from tagged source');
  return expected;
}
function redact(value, token) {
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  if (token) text = text.replaceAll(token, '[REDACTED]');
  return text.replace(/("(?:authorization|token|password|secret)"\s*:\s*")[^"]*/gi, '$1[REDACTED]');
}
function createClient({ token, fetchImpl = fetch } = {}) {
  assert.ok(token, 'GH_TOKEN is required');
  async function request(endpoint, { method = 'GET', body, missing = false, binary = false, upload = false, public: publicAccess = false } = {}) {
    assert.ok(endpoint.startsWith(BASE + '/'), 'API requests must remain in the official repository');
    assert.ok(method === 'GET' || (method === 'POST' && (endpoint === BASE + '/releases' ||
      (upload && new RegExp(`^${BASE}/releases/\\d+/assets\\?name=`).test(endpoint)))) ||
      (method === 'PATCH' && new RegExp(`^${BASE}/releases/\\d+$`).test(endpoint)), 'Ref writes and destructive API methods are forbidden');
    assert.ok(!publicAccess || method === 'GET', 'Public verification is read-only');
    const headers = { Accept: binary ? 'application/octet-stream' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2026-03-10' };
    if (!publicAccess) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = upload ? 'application/octet-stream' : 'application/json';
    let response = await fetchImpl((upload ? 'https://uploads.github.com' : 'https://api.github.com') + endpoint,
      { method, headers, body: body === undefined ? undefined : upload ? body : JSON.stringify(body),
        redirect: 'manual', signal: AbortSignal.timeout(60000) });
    if (binary && [301, 302, 303, 307, 308].includes(response.status)) {
      const url = new URL(response.headers.get('location'));
      assert.ok(url.protocol === 'https:' && !url.username && !url.password &&
        ['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(url.hostname), 'Unexpected asset download redirect');
      // Never forward the workflow token to the asset CDN.
      response = await fetchImpl(url.href, { redirect: 'error', signal: AbortSignal.timeout(60000) });
    }
    if (missing && response.status === 404) return null;
    if (!response.ok) {
      const details = redact(await response.text(), token);
      throw new Error(`GitHub ${method} ${endpoint}: HTTP ${response.status}; request ${response.headers.get('x-github-request-id') || 'unknown'}; ${details}`);
    }
    if (binary) {
      const length = response.headers.get('content-length');
      if (length !== null) assert.ok(Number(length) > 0 && Number(length) <= MAX_BYTES, 'Asset download exceeds size bound');
      const chunks = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.length; assert.ok(size <= MAX_BYTES, 'Asset download exceeds size bound'); chunks.push(chunk); }
      return Buffer.concat(chunks);
    }
    return response.status === 204 ? null : response.json();
  }
  async function list(endpoint, key, options) {
    const items = [];
    for (let page = 1; page <= 100; page++) {
      const response = await request(`${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`, options);
      const batch = key ? response[key] : response; assert.ok(Array.isArray(batch)); items.push(...batch);
      if (batch.length < 100) return items;
    }
    throw new Error('API pagination exceeds the safe bound; narrow the publication query');
  }
  return { request, list };
}

function createPublisher({ client, env = process.env, git = args => execFileSync('git', args, { encoding: 'utf8' }),
  download = (runId, dir) => execFileSync('gh', ['run', 'download', String(runId), '--repo', REPO,
    '--name', 'NerdSSHell-Windows-x64', '--dir', dir], { stdio: 'inherit' }), log = console.log } = {}) {
  const dir = path.join(env.RUNNER_TEMP || '.', 'consumer-release');
  const manifestFile = path.join(env.RUNNER_TEMP || '.', 'release-manifest.json');
  const notesFile = path.join(env.RUNNER_TEMP || '.', 'release-notes.md');
  const readSource = (sha, name) => git(['show', `${sha}:${name}`]);
  function requestedTag() {
    assert.equal(env.GITHUB_REPOSITORY, REPO);
    const event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
    let tag;
    if (env.GITHUB_EVENT_NAME === 'push') {
      assert.equal(event.deleted, false, 'Tag deletion does not authorize publication');
      assert.equal(event.created, true, 'Only owner tag creation authorizes automatic publication');
      assert.ok(event.ref?.startsWith('refs/tags/')); tag = event.ref.slice('refs/tags/'.length);
      assert.equal(env.GITHUB_REF, event.ref);
    } else {
      assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch', 'Publication requires owner tag creation or explicit recovery dispatch');
      assert.equal(env.GITHUB_REF, 'refs/heads/main', 'Dispatch publication from protected main');
      tag = event.inputs?.tag;
    }
    versionFromTag(tag); return tag;
  }
  async function context() {
    const tag = requestedTag();
    const ref = await client.request(`${BASE}/git/ref/tags/${tag}`, { missing: true });
    assert.ok(ref, `Owner must create ${tag} from the validated main source first; publisher cannot create tags or bypass the tag ruleset`);
    assert.equal(ref.ref, `refs/tags/${tag}`); assert.ok(['commit', 'tag'].includes(ref.object?.type)); assert.match(ref.object.sha, SHA);
    const commit = await client.request(`${BASE}/commits/${tag}`); assert.match(commit.sha, SHA);
    if (ref.object.type === 'commit') assert.equal(ref.object.sha, commit.sha);
    const sha = commit.sha;
    if (env.GITHUB_EVENT_NAME === 'push') {
      const event = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
      assert.equal(event.after, ref.object.sha, 'Tag changed since its creation event');
    }
    const main = await client.request(`${BASE}/git/ref/heads/main`); assert.match(main.object?.sha, SHA);
    const lineage = await client.request(`${BASE}/compare/${sha}...${main.object.sha}`);
    assert.ok(['identical', 'ahead'].includes(lineage.status) && lineage.merge_base_commit?.sha === sha,
      'Version tag must resolve to the validated protected-main history');
    const pkg = JSON.parse(readSource(sha, 'package.json')), lock = JSON.parse(readSource(sha, 'package-lock.json'));
    const { version, changes } = validateSource(pkg, lock, readSource(sha, 'CHANGELOG.md'), tag);
    return { tag, sha, tagObject: ref.object.sha, version, changes, lock,
      license: readSource(sha, 'LICENSE'), notices: readSource(sha, 'docs/THIRD-PARTY-NOTICES.md') };
  }
  async function gates(source, prior) {
    const all = [];
    for (const workflow of Object.keys(WORKFLOWS)) all.push(...await client.list(
      `${BASE}/actions/workflows/${workflow}/runs?head_sha=${source.sha}&event=push&branch=main`, 'workflow_runs'));
    const selected = selectRuns(all, source.sha);
    for (const [workflow, chosen] of Object.entries(selected)) {
      const run = await client.request(`${BASE}/actions/runs/${chosen.id}`); validateRun(run, source.sha, workflow);
      assert.equal(run.run_attempt, chosen.run_attempt, 'Validation run attempt changed during publication');
      if (prior) { assert.equal(run.id, prior[workflow].id, 'Validation run changed after asset preparation');
        assert.equal(run.run_attempt, prior[workflow].run_attempt, 'Validation rerun requires fresh asset preparation'); }
      validateJobs(await client.list(`${BASE}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`, 'jobs'), workflow, run);
      selected[workflow] = run;
    }
    return selected;
  }
  async function artifact(run, prior) {
    const matches = (await client.list(`${BASE}/actions/runs/${run.id}/artifacts`, 'artifacts'))
      .filter(item => item.name === 'NerdSSHell-Windows-x64');
    assert.equal(matches.length, 1, 'Require exactly one validated Windows artifact');
    validateArtifact(matches[0], run);
    if (prior) assert.equal(matches[0].id, prior.id, 'Accepted Windows artifact changed after preparation');
    return matches[0];
  }
  async function releaseFor(tag, publicAccess = false) {
    const release = await client.request(`${BASE}/releases/tags/${tag}`, { missing: true, public: publicAccess });
    if (!release) return null;
    assert.equal(release.tag_name, tag); assert.equal(release.prerelease, false);
    assert.ok(Number.isSafeInteger(release.id) && release.id > 0);
    release.assets = await client.list(`${BASE}/releases/${release.id}/assets`, undefined, { public: publicAccess });
    return release;
  }
  function verifyTarget(release, source) {
    assert.equal(release.tag_name, source.tag); assert.equal(release.prerelease, false);
    // target_commitish is ignored by GitHub for an existing tag; an explicit
    // conflicting SHA still indicates inconsistent release metadata.
    if (SHA.test(release.target_commitish)) assert.equal(release.target_commitish, source.sha, 'Release source differs');
  }
  async function remoteFiles(release, source) {
    verifyTarget(release, source);
    const names = expectedNames(source.version);
    assert.deepEqual(release.assets.map(item => item.name).sort(), names, 'Published asset set is immutable and must be complete');
    for (const item of release.assets) {
      assert.equal(item.state, 'uploaded'); assert.ok(Number.isSafeInteger(item.id) && item.id > 0);
      assert.ok(Number.isSafeInteger(item.size) && item.size > 0 && item.size <= MAX_BYTES);
      assert.match(item.digest || '', /^sha256:[0-9a-f]{64}$/);
      const bytes = await client.request(`${BASE}/releases/assets/${item.id}`, { binary: true });
      assert.equal(bytes.length, item.size, `${item.name} download size differs`);
      assert.equal(`sha256:${digest(bytes)}`, item.digest, `${item.name} actual downloaded bytes differ`);
      fs.writeFileSync(path.join(dir, item.name), bytes, { flag: 'wx' });
    }
    const expected = validateFiles(dir, source); validateAssets(release.assets, expected); return expected;
  }
  async function prepare() {
    const source = await context();
    fs.mkdirSync(dir); // A reused or contaminated staging directory fails closed.
    const existing = await releaseFor(source.tag);
    let selected, accepted, expected;
    if (existing && !existing.draft) {
      expected = await remoteFiles(existing, source);
      log(`Published release verified without changes: ${existing.html_url}`);
    } else {
      if (existing) verifyTarget(existing, source);
      selected = await gates(source); accepted = await artifact(selected['build.yml']);
      const build = path.join(env.RUNNER_TEMP, 'validated-build'); fs.mkdirSync(build);
      await download(selected['build.yml'].id, build);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(build, 'package-lock.json'), 'utf8')), source.lock,
        'Windows artifact lockfile differs from tagged source');
      const installerName = `NerdSSHell-${source.version}-x64-Setup.exe`;
      const installers = fs.readdirSync(path.join(build, 'dist')).filter(name => name.endsWith('Setup.exe'));
      assert.deepEqual(installers, [installerName], 'Windows artifact installer version/name differs');
      const hashes = fs.readFileSync(path.join(build, 'dist', 'SHA256.txt'), 'utf8').match(/\b[0-9a-f]{64}\b/gi) || [];
      assert.equal(hashes.length, 1, 'Accepted build must identify exactly one installer checksum');
      assert.equal(hash(path.join(build, 'dist', installerName)), hashes[0].toLowerCase(), 'Installer differs from accepted CI checksum');
      fs.copyFileSync(path.join(build, 'dist', installerName), path.join(dir, installerName));
      for (const name of ['SBOM.spdx.json', 'SBOM-runtime.spdx.json', 'THIRD-PARTY-NOTICES.md'])
        fs.copyFileSync(path.join(build, 'docs', name), path.join(dir, name));
      fs.writeFileSync(path.join(dir, 'LICENSE.txt'), source.license);
      git(['archive', '--format=zip', `--output=${path.join(dir, `NerdSSHell-user-manual-${source.version}.zip`)}`, source.sha, 'docs/wiki']);
      fs.writeFileSync(path.join(dir, 'SHA256SUMS.txt'), fs.readdirSync(dir).sort()
        .map(name => `${hash(path.join(dir, name))}  ${name}\n`).join(''));
      expected = validateFiles(dir, source);
      if (existing) validateAssets(existing.assets, expected, true);
      fs.writeFileSync(notesFile, `NerdSSHell ${source.version}\n\n${source.changes}\n\n## Validation\n\n` +
        `Exact protected-main source: ${source.sha}. All required main push jobs passed, including Windows package/acceptance, Linux tests/integration, dependencies, secrets and both CodeQL analyses.\n\n` +
        Object.entries(selected).map(([name, run]) => `- ${name}: https://github.com/${REPO}/actions/runs/${run.id} (attempt ${run.run_attempt})\n`).join('') +
        `\nThe Windows x64 installer is copied byte-for-byte from accepted Windows artifact ${accepted.id}; no installer is rebuilt during publication. ` +
        `Download NerdSSHell-${source.version}-x64-Setup.exe, or approve the normal in-app upgrade offer.\n\n` +
        `This release is **unsigned**. SHA-256 verifies byte identity, not Authenticode publisher identity. Do not disable Windows or organizational security controls. ` +
        `Automated fixtures do not establish physical Windows input, real UAC, alternate-account installation or reporter-host acceptance. ` +
        `Persistent close/disconnect leaves remote work running. See the changelog and user manual for version-specific limitations.\n`);
    }
    const again = await context(); assert.equal(again.sha, source.sha); assert.equal(again.tagObject, source.tagObject);
    fs.writeFileSync(manifestFile, JSON.stringify({ tag: source.tag, sha: source.sha, tagObject: source.tagObject,
      runs: selected, artifact: accepted, expected, notesSha256: selected ? hash(notesFile) : null,
      publishedId: existing && !existing.draft ? existing.id : null }, null, 2));
    log(JSON.stringify({ tag: source.tag, source: source.sha, buildRun: selected?.['build.yml'].id, assets: expected }, null, 2));
  }
  async function verifyRemote(release, expected) {
    validateAssets(release.assets, expected);
    for (const item of release.assets) {
      const bytes = await client.request(`${BASE}/releases/assets/${item.id}`, { binary: true });
      assert.equal(bytes.length, item.size); assert.equal(`sha256:${digest(bytes)}`, item.digest,
        `${item.name} actual downloaded bytes differ`);
    }
  }
  async function verifyPublic(source, expected, releaseId, latestBefore, madeLatest) {
    const release = await releaseFor(source.tag, true);
    assert.ok(release && !release.draft, 'Published release must be publicly accessible');
    assert.equal(release.id, releaseId); verifyTarget(release, source); validateAssets(release.assets, expected);
    assert.equal(release.html_url, `https://github.com/${REPO}/releases/tag/${source.tag}`);
    for (const item of release.assets) {
      assert.equal(item.browser_download_url, `https://github.com/${REPO}/releases/download/${source.tag}/${item.name}`);
      const bytes = await client.request(`${BASE}/releases/assets/${item.id}`, { binary: true, public: true });
      assert.equal(bytes.length, item.size); assert.equal(`sha256:${digest(bytes)}`, item.digest, `${item.name} public bytes differ`);
    }
    const latest = await client.request(`${BASE}/releases/latest`, { public: true });
    assert.equal(latest.draft, false); assert.equal(latest.prerelease, false);
    const latestVersion = versionFromTag(latest.tag_name);
    assert.ok(compareVersions(latestVersion, source.version) >= 0, 'Public updater feed cannot point behind this published version');
    if (madeLatest === true) { assert.equal(latest.id, releaseId); assert.equal(latest.tag_name, source.tag); }
    else if (madeLatest === false && latestBefore) {
      assert.equal(latest.id, latestBefore.id, 'Publishing an older version must preserve latest');
      assert.equal(latest.tag_name, latestBefore.tag_name);
    }
  }
  async function publish() {
    const source = await context(), manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    assert.equal(manifest.tag, source.tag); assert.equal(manifest.sha, source.sha); assert.equal(manifest.tagObject, source.tagObject);
    const expected = validateFiles(dir, source); assert.deepEqual(expected, manifest.expected, 'Prepared consumer assets changed');
    let release = await releaseFor(source.tag);
    if (release && !release.draft) {
      verifyTarget(release, source); if (manifest.publishedId) assert.equal(release.id, manifest.publishedId);
      await verifyRemote(release, expected); await verifyPublic(source, expected, release.id);
      log(`Already published and verified without changes: ${release.html_url}`); return;
    }
    assert.ok(!manifest.publishedId, 'Previously published release disappeared; refuse recreation');
    assert.equal(hash(notesFile), manifest.notesSha256, 'Prepared release notes changed');
    const notes = fs.readFileSync(notesFile, 'utf8');
    const selected = await gates(source, manifest.runs); await artifact(selected['build.yml'], manifest.artifact);
    if (release) { verifyTarget(release, source); validateAssets(release.assets, expected, true); }
    else {
      // Check the protected tag immediately before creation. Never create a
      // release with a missing tag: GitHub would otherwise try to create it.
      const current = await context(); assert.equal(current.tagObject, source.tagObject); assert.equal(current.sha, source.sha);
      release = await client.request(`${BASE}/releases`, { method: 'POST', body: { tag_name: source.tag,
        target_commitish: source.sha, name: source.tag, body: notes, draft: true,
        prerelease: false, make_latest: 'false' } });
      assert.equal(release.draft, true); verifyTarget(release, source);
      release = await releaseFor(source.tag); assert.equal(release.draft, true);
    }
    const releaseId = release.id;
    for (const item of expected) {
      if (!release.assets.some(asset => asset.name === item.name)) {
        await client.request(`${BASE}/releases/${release.id}/assets?name=${encodeURIComponent(item.name)}`,
          { method: 'POST', upload: true, body: fs.readFileSync(path.join(dir, item.name)) });
      }
    }
    release = await releaseFor(source.tag); assert.equal(release.id, releaseId); assert.equal(release.draft, true);
    await verifyRemote(release, expected);
    // Revalidate the exact run attempts, artifact and owner tag before publication.
    await gates(source, manifest.runs); await artifact(selected['build.yml'], manifest.artifact);
    const current = await context(); assert.equal(current.tagObject, source.tagObject); assert.equal(current.sha, source.sha);
    const latest = await client.request(`${BASE}/releases/latest`, { missing: true });
    const newer = latest && !latest.draft && !latest.prerelease && /^v/.test(latest.tag_name) && STABLE.test(latest.tag_name.slice(1))
      ? compareVersions(source.version, latest.tag_name.slice(1)) > 0 : !latest;
    release = await client.request(`${BASE}/releases/${release.id}`, { method: 'PATCH', body: {
      name: source.tag, body: notes, draft: false, make_latest: newer ? 'true' : 'false' } });
    assert.equal(release.draft, false); assert.equal(release.name, source.tag); assert.equal(release.body, notes); verifyTarget(release, source);
    const published = await releaseFor(source.tag); assert.equal(published.id, releaseId); assert.equal(published.draft, false);
    await verifyRemote(published, expected);
    const final = await context(); assert.equal(final.tagObject, source.tagObject); assert.equal(final.sha, source.sha);
    await verifyPublic(source, expected, releaseId, latest, newer);
    log(`Published and verified: ${published.html_url}`);
  }
  return { prepare, publish, context, gates };
}
if (require.main === module) {
  assert.ok(['prepare', 'publish'].includes(process.argv[2]), 'Use prepare or publish');
  const publisher = createPublisher({ client: createClient({ token: process.env.GH_TOKEN }) });
  publisher[process.argv[2]]().catch(error => {
    console.error(redact(error.message, process.env.GH_TOKEN));
    console.error('Publication stopped safely. Existing tags and published assets are never changed. If a draft exists, inspect the failure and rerun this workflow with the same existing tag after correcting it.');
    process.exitCode = 1;
  });
}
module.exports = { REPO, WORKFLOWS, versionFromTag, compareVersions, expectedNames, validateSource, validateRun,
  selectRuns, validateJobs, validateArtifact, validateAssets, validateInventory, validateFiles, createClient, createPublisher };
