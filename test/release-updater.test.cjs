'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { createHash } = require('node:crypto');
const { API_URL, MAX_METADATA, MAX_INSTALLER, newer, version, publishedRelease, readMetadata, downloadInstaller, eligibleStartup, StartupUpdater } = require('../src/release-updater.cjs');
const bytes = Buffer.from('MZsynthetic-inert-update-only');
const digest = value => createHash('sha256').update(value).digest('hex');
function metadata(target = '1.1.0') {
  const name = 'NerdSSHell-' + target + '-x64-Setup.exe';
  return { id: 101, tag_name: 'v' + target, html_url: 'https://github.com/zeidlern/NerdSSHell/releases/tag/v' + target, draft: false, prerelease: false, published_at: '2026-10-08T12:00:00Z', assets: [{ id: 102, name, state: 'uploaded', size: bytes.length, digest: 'sha256:' + digest(bytes), browser_download_url: 'https://github.com/zeidlern/NerdSSHell/releases/download/v' + target + '/' + name }] };
}
const response = (value, headers = {}) => new Response(value, { status: 200, headers });
function transport(data = metadata(), installer = bytes) {
  const calls = [];
  return { calls, fetch: async (url, options) => { calls.push({ url, options }); return url === API_URL ? response(JSON.stringify(data)) : response(installer, { 'content-length': String(data.assets[0].size) }); } };
}
test('stable semantic ordering refuses downgrades and compares numeric components', () => {
  assert.equal(newer('1.0.10', '1.0.9'), true); assert.equal(newer('2.0.0', '1.99.9'), true);
  assert.equal(newer('1.1.0', '1.1.0'), false); assert.equal(newer('1.0.9', '1.0.10'), false);
  for (const value of ['1.01.0', '01.1.0', '1.1', '1.1.0-rc1', '1.1.0+build', '1.1.0\n', '1.1.0;cmd', '65536.0.0', true, {}]) assert.throws(() => version(value));
});
test('published stable installer binds version, repository, size and SHA256', () => {
  const release = publishedRelease(metadata(), '1.0.4'); assert.equal(release.version, '1.1.0'); assert.ok(Object.isFrozen(release));
  assert.equal(publishedRelease(metadata('1.0.4'), '1.0.4'), null); assert.equal(publishedRelease(metadata('1.0.3'), '1.0.4'), null);
});
test('hostile, draft, prerelease, ambiguous or unhashed releases never authorize execution', () => {
  const changes = [d => d.draft = true, d => d.prerelease = true, d => delete d.published_at, d => d.tag_name = 'v1.1.0-rc1', d => d.html_url = 'https://github.com/other/repo/releases/tag/v1.1.0', d => d.assets.push(d.assets[0]), d => d.assets[0].browser_download_url += '?run=1', d => d.assets[0].browser_download_url = 'http://github.com/zeidlern/NerdSSHell/a', d => d.assets[0].digest = 'sha256:' + 'f'.repeat(63), d => d.assets[0].size = MAX_INSTALLER + 1, d => d.assets[0].state = 'new', d => d.assets[0].name = 'NerdSSHell-1.1.0-arm64-Setup.exe', d => d.assets[0].id = '102'];
  for (const change of changes) { const data = metadata(); change(data); assert.throws(() => publishedRelease(data, '1.0.4')); }
});
test('metadata request uses fixed public endpoint without credentials and remains bounded', async () => {
  const io = transport(); assert.equal((await readMetadata(io.fetch, '1.0.4')).version, '1.1.0');
  assert.equal(io.calls.length, 1); assert.equal(io.calls[0].url, API_URL); assert.equal(io.calls[0].options.credentials, 'omit'); assert.equal(io.calls[0].options.redirect, 'manual'); assert.equal(io.calls[0].options.headers.Authorization, undefined);
  await assert.rejects(readMetadata(async () => response('x', { 'content-length': String(MAX_METADATA + 1) }), '1.0.4'));
  await assert.rejects(readMetadata(async () => response('x'.repeat(MAX_METADATA + 1)), '1.0.4'));
  await assert.rejects(readMetadata(async () => response('invalid JSON'), '1.0.4'));
  await assert.rejects(readMetadata(async () => new Response('', { status: 302, headers: { location: 'https://api.github.com/other' } }), '1.0.4'));
});
test('verified download streams exact bytes into a unique owned file and removes only it', async t => {
  const io = transport(), release = publishedRelease(metadata(), '1.0.4');
  const plan = await downloadInstaller(io.fetch, release, '1.0.4'); t.after(() => { if (fs.existsSync(plan.stageDirectory)) fs.rmSync(plan.stageDirectory, { recursive: true, force: true }); });
  assert.deepEqual(fs.readFileSync(plan.installerPath), bytes); assert.equal(fs.statSync(plan.installerPath).nlink, 1);
  assert.equal(fs.realpathSync.native(path.dirname(plan.stageDirectory)), fs.realpathSync.native(os.tmpdir()));
  fs.writeFileSync(path.join(plan.stageDirectory, 'unowned.txt'), 'unowned data'); plan.cleanup();
  assert.equal(fs.existsSync(plan.installerPath), false); assert.equal(fs.readFileSync(path.join(plan.stageDirectory, 'unowned.txt'), 'utf8'), 'unowned data');
});
test('digest, declared length, truncation, excess bytes and non-EXE failures leave no stage', async () => {
  const before = new Set(fs.readdirSync(fs.realpathSync.native(os.tmpdir())).filter(x => x.startsWith('nerdsshell-update-' + process.pid + '-')));
  const release = publishedRelease(metadata(), '1.0.4');
  for (const value of [Buffer.from('MZwrong bytes'), bytes.subarray(0, -1), Buffer.concat([bytes, Buffer.from('x')])]) await assert.rejects(downloadInstaller(async () => response(value), release, '1.0.4'));
  await assert.rejects(downloadInstaller(async () => response(bytes, { 'content-length': '0' }), release, '1.0.4'));
  const other = Buffer.from('not an exe'); await assert.rejects(downloadInstaller(async () => response(other), { ...release, size: other.length, sha256: digest(other) }, '1.0.4'));
  const after = fs.readdirSync(fs.realpathSync.native(os.tmpdir())).filter(x => x.startsWith('nerdsshell-update-' + process.pid + '-') && !before.has(x)); assert.deepEqual(after, []);
});
test('only validated GitHub HTTPS release-asset redirects are followed', async () => {
  const release = publishedRelease(metadata(), '1.0.4'); const urls = [];
  const good = await downloadInstaller(async url => { urls.push(url); return urls.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/owned?id=1' } }) : response(bytes); }, release, '1.0.4');
  good.cleanup(); assert.equal(urls.length, 2);
  for (const location of ['http://release-assets.githubusercontent.com/a', 'https://localhost/a', 'https://github.com@evil.example/a', 'https://release-assets.githubusercontent.com.evil/a', 'https://user@release-assets.githubusercontent.com/a', 'https://release-assets.githubusercontent.com:444/a', 'file:///C:/cmd.exe']) await assert.rejects(downloadInstaller(async () => new Response(null, { status: 302, headers: { location } }), release, '1.0.4'));
  await assert.rejects(downloadInstaller(async () => new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/loop' } }), release, '1.0.4'));
});
test('cleanup refuses a hardlinked or replaced installer', async t => {
  const release = publishedRelease(metadata(), '1.0.4'), plan = await downloadInstaller(async () => response(bytes), release, '1.0.4');
  t.after(() => fs.rmSync(plan.stageDirectory, { recursive: true, force: true }));
  const link = path.join(plan.stageDirectory, 'extra-link'); fs.linkSync(plan.installerPath, link); assert.throws(plan.cleanup); assert.ok(fs.existsSync(link)); fs.unlinkSync(link); plan.cleanup();
});
test('startup excludes source, wrong platforms/architectures and debugging acceptance runs', () => {
  const context = { packaged: true, platform: 'win32', arch: 'x64', executablePath: 'C:\\Programs\\NerdSSHell\\NerdSSHell.exe', currentVersion: '1.1.0', debugging: false };
  assert.equal(eligibleStartup(context), true);
  for (const change of [{ packaged: false }, { platform: 'linux' }, { arch: 'arm64' }, { debugging: true }, { executablePath: 'C:\\node.exe' }, { currentVersion: 'synthetic' }]) assert.equal(eligibleStartup({ ...context, ...change }), false);
});
function controller(options = {}) {
  const io = transport(options.data || metadata()), notices = [], calls = [], updater = new StartupUpdater({ fetch: io.fetch, currentVersion: '1.0.4', offer: async () => options.accept !== false, notice: value => notices.push(value), requestQuit: () => calls.push('quit'), armUpdate: async plan => { calls.push(['arm', plan]); return { release: async () => calls.push('release'), cancel: async () => calls.push('cancel') }; }, executablePath: path.resolve('NerdSSHell.exe'), ...options });
  return { updater, io, notices, calls };
}
test('declining and same-version startup perform no installer fetch, exit or handoff', async () => {
  for (const options of [{ accept: false }, { data: metadata('1.0.4') }]) { const value = controller(options); await value.updater.start(); await value.updater.start(); assert.equal(value.io.calls.length, 1); assert.equal(value.calls.length, 0); assert.equal(value.updater.ready, null); await value.updater.cancel(); }
});
test('accepted upgrade downloads once, requests normal quit, and waits for explicit handoff', async () => {
  const value = controller(); await value.updater.start(); assert.equal(value.io.calls.length, 2); assert.deepEqual(value.calls, ['quit']);
  const plan = value.updater.ready; await value.updater.prepareQuit(); assert.equal(value.calls[1][0], 'arm'); await value.updater.release(); assert.equal(value.calls.at(-1), 'release'); assert.equal(value.updater.committed, true);
  await value.updater.cancel(); assert.ok(fs.existsSync(plan.installerPath)); plan.cleanup();
});
test('cancelled quit discards update and never releases installer', async () => {
  const value = controller(); await value.updater.start(); const directory = value.updater.ready.stageDirectory; await value.updater.prepareQuit(); await value.updater.cancel();
  assert.equal(value.calls.at(-1), 'cancel'); assert.equal(value.calls.includes('release'), false); assert.equal(fs.existsSync(directory), false);
});
test('renderer/quit cancellation cancels an active offer without requesting restart', async () => {
  let offered; const gate = new Promise(resolve => offered = resolve);
  const value = controller({ offer: (_candidate, signal) => new Promise(resolve => { offered(); signal.addEventListener('abort', () => resolve(false), { once: true }); }) });
  const run = value.updater.start(); await gate; value.updater.quitAttempt(); await value.updater.cancel(); await run; assert.equal(value.io.calls.length, 1); assert.deepEqual(value.calls, []);
});
test('offline or rate-limited checks preserve usable app with a bounded generic notice', async () => {
  const value = controller({ fetch: async () => new Response('private server error', { status: 429 }) }); await value.updater.start(); assert.deepEqual(value.calls, []); assert.equal(value.notices.length, 1); assert.ok(!value.notices[0].includes('private server error'));
});
