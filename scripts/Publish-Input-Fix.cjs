'use strict';
// Owner-authorized 1.2.2 publication only. Never bypass tag rules or replace assets.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const REPO = 'zeidlern/NerdSSHell', VERSION = '1.2.2', TAG = 'v' + VERSION;
const WORKFLOWS = ['.github/workflows/build.yml', '.github/workflows/security.yml', '.github/workflows/codeql.yml'];
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function validateRun(run, sha) {
  assert.match(sha, /^[0-9a-f]{40}$/);
  assert.equal(run.head_sha, sha); assert.equal(run.head_branch, 'main');
  assert.equal(run.head_repository?.full_name, REPO); assert.equal(run.event, 'push');
  assert.equal(run.path, WORKFLOWS[0]); assert.equal(run.status, 'completed');
  assert.equal(run.conclusion, 'success'); assert.ok(Number.isSafeInteger(run.id));
}
function validateChecks(runs, sha) {
  for (const workflow of WORKFLOWS) {
    const latest = runs.filter(run => run.head_sha === sha && run.head_branch === 'main' &&
      run.head_repository?.full_name === REPO && run.event === 'push' && run.path === workflow)
      .sort((a, b) => b.id - a.id)[0];
    assert.ok(latest, `No exact-main run for ${workflow}`);
    assert.equal(latest.status, 'completed', `${workflow} has not finished`);
    assert.equal(latest.conclusion, 'success', `${workflow} did not pass`);
  }
}
function validateAssets(assets, expected) {
  assert.equal(assets.length, expected.length, 'Unexpected or missing release assets');
  for (const item of expected) {
    const matches = assets.filter(asset => asset.name === item.name);
    assert.equal(matches.length, 1, `Ambiguous asset ${item.name}`);
    const asset = matches[0]; assert.equal(asset.state, 'uploaded');
    assert.equal(asset.size, item.size); assert.equal(asset.digest, 'sha256:' + item.sha256);
  }
}
async function api(endpoint, { method = 'GET', body, missing = false } = {}) {
  assert.ok(endpoint.startsWith(`/repos/${REPO}/`));
  const response = await fetch('https://api.github.com' + endpoint, {
    method, headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2026-03-10' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000)
  });
  if (missing && response.status === 404) return null;
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`GitHub ${method} ${endpoint}: HTTP ${response.status}: ${error.message || response.statusText}`);
  }
  return response.status === 204 ? null : response.json();
}
async function context() {
  assert.equal(process.env.GITHUB_REPOSITORY, REPO); assert.ok(process.env.GH_TOKEN);
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_run');
  const source = event.workflow_run;
  validateRun(source, source?.head_sha);
  const sha = source.head_sha;
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sha);
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
  assert.equal(pkg.version, VERSION); assert.equal(lock.version, VERSION); assert.equal(lock.packages[''].version, VERSION);
  validateRun(await api(`/repos/${REPO}/actions/runs/${source.id}`), sha);
  const runs = await api(`/repos/${REPO}/actions/runs?head_sha=${sha}&event=push&per_page=100`);
  validateChecks(runs.workflow_runs, sha);
  const head = await api(`/repos/${REPO}/git/ref/heads/main`);
  assert.equal(head.object.sha, sha, 'main moved; refuse to publish stale source');
  return { sha, runId: source.id, dir: path.join(process.env.RUNNER_TEMP, 'consumer-release') };
}
async function prepare() {
  const { sha, runId, dir } = await context();
  const build = path.join(process.env.RUNNER_TEMP, 'validated-build');
  fs.mkdirSync(build); fs.mkdirSync(dir);
  execFileSync('gh', ['run', 'download', String(runId), '--repo', REPO, '--name', 'NerdSSHell-Windows-x64', '--dir', build], { stdio: 'inherit' });
  const installerName = `NerdSSHell-${VERSION}-x64-Setup.exe`, installer = path.join(build, 'dist', installerName);
  const hashes = fs.readFileSync(path.join(build, 'dist', 'SHA256.txt'), 'utf8').match(/\b[0-9a-f]{64}\b/gi) || [];
  assert.equal(hashes.length, 1, 'CI must identify exactly one installer hash');
  assert.equal(hash(installer), hashes[0].toLowerCase(), 'Installer differs from the accepted CI artifact');
  fs.copyFileSync(installer, path.join(dir, installerName));
  for (const name of ['SBOM.spdx.json', 'SBOM-runtime.spdx.json', 'THIRD-PARTY-NOTICES.md']) {
    const file = path.join(build, 'docs', name);
    if (name.endsWith('.json')) assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).name, `nerdsshell@${VERSION}`);
    fs.copyFileSync(file, path.join(dir, name));
  }
  fs.copyFileSync('LICENSE', path.join(dir, 'LICENSE.txt'));
  // Zip only tracked manual pages; stable Git archive bytes permit an identical retry.
  execFileSync('git', ['archive', '--format=zip', `--output=${path.join(dir, `NerdSSHell-user-manual-${VERSION}.zip`)}`, 'HEAD', 'docs/wiki']);
  const names = fs.readdirSync(dir).sort();
  fs.writeFileSync(path.join(dir, 'SHA256SUMS.txt'), names.map(name => `${hash(path.join(dir, name))}  ${name}\n`).join(''));
  const expected = fs.readdirSync(dir).sort().map(name => ({ name, size: fs.statSync(path.join(dir, name)).size, sha256: hash(path.join(dir, name)) }));
  fs.writeFileSync(path.join(process.env.RUNNER_TEMP, 'release-manifest.json'), JSON.stringify({ sha, runId, expected }, null, 2));
  fs.writeFileSync(path.join(process.env.RUNNER_TEMP, 'release-notes.md'), `NerdSSHell 1.2.2 fixes accumulated typing delay in Persistent (tmux) sessions on higher-latency connections. Pending printable input is batched without adding a first-key timer. Enter/control events, paste acknowledgements, stale-input rejection, session identity and remote-process lifetime remain protected.\n\nAt simulated 150 ms RTT, 80 characters typed over 790 ms completed echo at 1050 ms instead of 12000 ms (7 requests instead of 80). This is deterministic application/transport testing, not a measurement on the reported EC2 connection. Twelve new regression cases and a real disposable OpenSSH/tmux delayed-reply test are included.\n\n## Validation\n\nExact main source: ${sha}. The final-main Linux source/full tests/disposable SSH integration, Windows source/build/package acceptance, dependency/secret audit and CodeQL workflows passed. Build evidence: https://github.com/${REPO}/actions/runs/${runId}. Dependencies are unchanged. The installer is copied byte-for-byte from that accepted run and checked against its SHA-256 manifest.\n\n## Installation and limitations\n\nDownload NerdSSHell-1.2.2-x64-Setup.exe for Windows x64, or accept the normal in-app update offer. This release is **unsigned**, retaining the existing distribution policy; hashes establish byte identity, not publisher trust. Do not disable Windows or organizational security controls.\n\nRemote network latency, repeated control-key acknowledgement delays and severe output congestion are not eliminated. The affected EC2 connection and physical Windows typing still need a reporter retest; automated package checks are not that acceptance. Closing/disconnecting a Persistent view continues to leave remote work running.\n`);
  console.log(JSON.stringify({ source: sha, buildRun: runId, assets: expected }, null, 2));
}
async function tagCommit() {
  const ref = await api(`/repos/${REPO}/git/ref/tags/${TAG}`, { missing: true });
  return ref ? api(`/repos/${REPO}/commits/${TAG}`) : null;
}
async function publish() {
  const { sha, runId, dir } = await context();
  const manifest = JSON.parse(fs.readFileSync(path.join(process.env.RUNNER_TEMP, 'release-manifest.json'), 'utf8'));
  assert.equal(manifest.sha, sha); assert.equal(manifest.runId, runId);
  for (const asset of manifest.expected) assert.equal(hash(path.join(dir, asset.name)), asset.sha256);
  // Respect existing protected tags: they must already resolve to these exact bytes.
  const tagged = await tagCommit();
  if (tagged) assert.equal(tagged.sha, sha, 'Existing version tag refers to different source');
  const releases = await api(`/repos/${REPO}/releases?per_page=100`);
  const existing = releases.filter(release => release.tag_name === TAG);
  assert.ok(existing.length <= 1, 'Ambiguous version release');
  let release = existing[0];
  if (release) {
    assert.equal(release.target_commitish, sha, 'Existing release refers to different source');
    if (!release.draft) {
      validateAssets(release.assets, manifest.expected);
      assert.ok(tagged); console.log(`Already published and verified: ${release.html_url}`); return;
    }
  } else {
    release = await api(`/repos/${REPO}/releases`, { method: 'POST', body: { tag_name: TAG, target_commitish: sha,
      name: 'v1.2.2 — Fix high-latency persistent typing', body: fs.readFileSync(path.join(process.env.RUNNER_TEMP, 'release-notes.md'), 'utf8'),
      draft: true, prerelease: false } });
  }
  // Do not overwrite even draft assets: identical retries may only fill missing names.
  for (const item of manifest.expected) {
    const prior = release.assets.filter(asset => asset.name === item.name);
    if (prior.length) validateAssets(prior, [item]);
    else execFileSync('gh', ['release', 'upload', TAG, path.join(dir, item.name), '--repo', REPO], { stdio: 'inherit' });
  }
  release = await api(`/repos/${REPO}/releases/${release.id}`);
  validateAssets(release.assets, manifest.expected);
  // Recheck source ownership and all gates immediately before irreversible publication.
  await context();
  const currentTag = await tagCommit();
  if (currentTag) assert.equal(currentTag.sha, sha);
  release = await api(`/repos/${REPO}/releases/${release.id}`, { method: 'PATCH', body: { draft: false, make_latest: 'true' } });
  assert.equal(release.draft, false); assert.equal(release.prerelease, false);
  assert.equal((await api(`/repos/${REPO}/commits/${TAG}`)).sha, sha);
  validateAssets((await api(`/repos/${REPO}/releases/${release.id}`)).assets, manifest.expected);
  console.log(`Published and verified: ${release.html_url}`);
}
if (require.main === module) {
  const command = process.argv[2];
  if (!['prepare', 'publish'].includes(command)) throw new Error('Use prepare or publish');
  (command === 'prepare' ? prepare() : publish()).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { validateRun, validateChecks, validateAssets };
