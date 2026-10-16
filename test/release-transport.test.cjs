'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { createHash } = require('node:crypto');
const { createReleaseFetch, HIGH_WATER_MARK, MAX_BUFFERED } = require('../src/release-transport.cjs');
const { API_URL, readMetadata, downloadInstaller } = require('../src/release-updater.cjs');
const installerURL = 'https://github.com/zeidlern/NerdSSHell/releases/download/v2.0.0/NerdSSHell-2.0.0-x64-Setup.exe';
const cdnURL = 'https://release-assets.githubusercontent.com/fixture-installer?signature=fixture';
const options = signal => ({ method: 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store', signal,
  headers: { Accept: 'application/octet-stream', 'User-Agent': 'NerdSSHell/1.0.0', 'X-GitHub-Api-Version': '2022-11-28' } });
const tick = () => new Promise(resolve => setImmediate(resolve));
function trackedAbort() {
  const abort = new AbortController(), listeners = new Set();
  const add = abort.signal.addEventListener.bind(abort.signal), remove = abort.signal.removeEventListener.bind(abort.signal);
  abort.signal.addEventListener = (event, listener, ...rest) => { if (event === 'abort') listeners.add(listener); return add(event, listener, ...rest); };
  abort.signal.removeEventListener = (event, listener, ...rest) => { if (event === 'abort') listeners.delete(listener); return remove(event, listener, ...rest); };
  return { abort, listeners };
}
function fakeNet(t, start) {
  const requests = [];
  const net = { request(config) {
    const request = new EventEmitter(); Object.assign(request, { config, aborts: 0, follows: 0, closed: false });
    request.followRedirect = () => { request.follows++; throw new Error('Automatic redirect is forbidden'); };
    request.finish = () => { if (!request.closed) { request.closed = true; request.emit('close'); } };
    request.abort = () => {
      request.aborts++; queueMicrotask(() => {
        if (request.closed) return;
        request.emit('abort'); request.response?.emit('aborted');
        if (request.lateRedirectError) request.emit('error', new Error('Redirect was cancelled'));
        request.response?.destroy(); request.finish();
      });
    };
    request.end = () => queueMicrotask(() => { if (!request.closed && !request.aborts) start(request); });
    request.respond = ({ status = 200, headers = {}, chunks = [], pending = false } = {}) => {
      const response = pending ? new Readable({ read() {} }) : Readable.from(chunks);
      response.statusCode = status; response.headers = headers; response.pauses = 0; response.resumes = 0; response.delivered = 0;
      const pause = response.pause.bind(response), resume = response.resume.bind(response);
      response.pause = () => { response.pauses++; return pause(); }; response.resume = () => { response.resumes++; return resume(); };
      response.on('data', () => response.delivered++);
      response.once('end', () => queueMicrotask(() => request.finish()));
      request.response = response; request.emit('response', response); return response;
    };
    requests.push(request); return request;
  } };
  t.after(async () => { for (const request of requests) if (!request.closed) request.abort(); await tick(); });
  return { net, requests, fetch: createReleaseFetch(net) };
}
function release(bytes) {
  return { id: 1, tag_name: 'v2.0.0', html_url: 'https://github.com/zeidlern/NerdSSHell/releases/tag/v2.0.0', draft: false,
    prerelease: false, published_at: '2026-10-14T00:00:00Z', assets: [{ id: 2, name: 'NerdSSHell-2.0.0-x64-Setup.exe',
      state: 'uploaded', size: bytes.length, digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex'), browser_download_url: installerURL }] };
}
test('main uses Chromium adapter for updates while local resource fetch remains local', () => {
  const main = fs.readFileSync(require.resolve('../src/main.cjs'), 'utf8');
  assert.match(main, /fetch: createReleaseFetch\(net\)/); assert.match(main, /net\.fetch\(pathToFileURL\(asset\)\.href\)/);
  assert.ok(!main.includes('fetch: (url, options) => net.fetch(url, options)'));
});
test('manual redirect becomes inspectable synthetic response; native cancellation cannot reject or follow it', async t => {
  const { fetch, requests } = fakeNet(t, request => {
    request.lateRedirectError = true;
    request.emit('redirect', 302, 'GET', cdnURL, { Location: [cdnURL], 'Content-Length': ['0'] });
  });
  const response = await fetch(installerURL, options()); await tick();
  assert.equal(response.status, 302); assert.equal(response.headers.get('location'), cdnURL);
  assert.equal((await response.body.getReader().read()).done, true);
  assert.equal(requests.length, 1); assert.equal(requests[0].follows, 0); assert.equal(requests[0].aborts, 1);
  assert.equal(requests[0].listenerCount('error'), 1);
});
test('real updater logic follows only reviewed CDN, verifies streamed installer and cleans owned file', async t => {
  const bytes = Buffer.from('MZowned-chromium-transport-fixture');
  const { fetch, requests } = fakeNet(t, request => {
    if (request.config.url === API_URL) request.respond({ chunks: [Buffer.from(JSON.stringify(release(bytes)))] });
    else if (request.config.url === installerURL) request.emit('redirect', 302, 'GET', cdnURL, { location: [cdnURL] });
    else { assert.equal(request.config.url, cdnURL); request.respond({ headers: { 'content-length': String(bytes.length) }, chunks: [bytes.subarray(0, 1), bytes.subarray(1)] }); }
  });
  const published = await readMetadata(fetch, '1.0.0'); const ready = await downloadInstaller(fetch, published, '1.0.0');
  assert.ok(fs.readFileSync(ready.installerPath).equals(bytes)); ready.cleanup(); assert.equal(fs.existsSync(ready.stageDirectory), false);
  assert.equal(requests.length, 3);
  for (const request of requests) {
    assert.equal(request.config.credentials, 'omit'); assert.equal(request.config.useSessionCookies, false);
    assert.equal(request.config.cache, 'no-store'); assert.equal(request.config.bypassCustomProtocolHandlers, true);
    assert.equal(request.config.redirect, 'manual'); assert.equal(request.config.referrerPolicy, 'no-referrer'); assert.equal(request.follows, 0);
  }
});
test('updater rejects hostile redirect before a second request', async t => {
  const bytes = Buffer.from('MZfixture');
  const { fetch, requests } = fakeNet(t, request => request.emit('redirect', 302, 'GET', 'https://example.com/steal', {}));
  const published = require('../src/release-updater.cjs').publishedRelease(release(bytes), '1.0.0');
  await assert.rejects(downloadInstaller(fetch, published, '1.0.0'), /Unexpected update download redirect/); assert.equal(requests.length, 1);
});
test('public request rejects cookies/auth headers, wrong schemes/options and already aborted signals', async t => {
  const { fetch, requests } = fakeNet(t, () => {});
  for (const name of ['Cookie', 'Authorization', 'Proxy-Authorization', 'Referer'])
    await assert.rejects(fetch(API_URL, { ...options(), headers: { [name]: 'private' } }), /header/);
  for (const url of ['http://api.github.com/x', 'https://user:secret@github.com/x', 'https://example.com/x', 'https://github.com:8443/x', 'https://github.com/x#fragment'])
    await assert.rejects(fetch(url, options()), /Invalid public update request/);
  for (const change of [{ method: 'POST' }, { credentials: 'include' }, { redirect: 'follow' }, { cache: 'default' }])
    await assert.rejects(fetch(API_URL, { ...options(), ...change }), /Invalid public update request/);
  const abort = new AbortController(); abort.abort(); await assert.rejects(fetch(API_URL, options(abort.signal)), /cancelled/);
  assert.equal(requests.length, 0);
});
test('abort before headers rejects promptly, aborts native request and releases signal/listeners', async t => {
  const { fetch, requests } = fakeNet(t, () => {}), { abort, listeners } = trackedAbort();
  const pending = fetch(API_URL, options(abort.signal)); abort.abort(); await assert.rejects(pending, /cancelled/); await tick();
  assert.equal(requests[0].aborts, 1); assert.equal(listeners.size, 0); assert.deepEqual(requests[0].eventNames(), ['error']);
});
test('abort during stalled body rejects pending reader and releases native request', async t => {
  const { fetch, requests } = fakeNet(t, request => request.respond({ pending: true })), { abort, listeners } = trackedAbort();
  const response = await fetch(API_URL, options(abort.signal)), reader = response.body.getReader(), pending = reader.read();
  abort.abort(); await assert.rejects(pending, /cancelled/); await tick();
  assert.equal(requests[0].aborts, 1); assert.equal(listeners.size, 0); assert.equal(requests[0].listenerCount('error'), 1);
});
test('reader cancellation resolves pending read and aborts without replaying buffered bytes', async t => {
  const { fetch, requests } = fakeNet(t, request => request.respond({ pending: true })), { abort, listeners } = trackedAbort();
  const response = await fetch(API_URL, options(abort.signal)), reader = response.body.getReader(), pending = reader.read();
  await reader.cancel(); assert.equal((await pending).done, true); await tick();
  assert.equal(requests[0].aborts, 1); assert.equal(listeners.size, 0);
});
test('non-200 response is exposed without buffering its error payload and native transaction aborts', async t => {
  const { fetch, requests } = fakeNet(t, request => request.respond({ status: 503, pending: true, headers: { 'Retry-After': ['60'] } }));
  const response = await fetch(API_URL, options()); assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), '60'); assert.equal((await response.body.getReader().read()).done, true); await tick();
  assert.equal(requests[0].aborts, 1);
});
test('request error before headers is preserved and abort cleanup completes', async t => {
  const { fetch, requests } = fakeNet(t, request => request.emit('error', new Error('fixture request failed')));
  await assert.rejects(fetch(API_URL, options()), /fixture request failed/); await tick(); assert.deepEqual(requests[0].eventNames(), ['error']);
});
test('response stream error rejects pending read without accepting truncated bytes', async t => {
  const { fetch, requests } = fakeNet(t, request => request.respond({ pending: true }));
  const response = await fetch(API_URL, options()), pending = response.body.getReader().read();
  requests[0].response.emit('error', new Error('fixture stream failed')); await assert.rejects(pending, /fixture stream failed/); await tick();
  assert.equal(requests[0].aborts, 1);
});
test('native close before body end fails pending read instead of reporting successful EOF', async t => {
  const { fetch, requests } = fakeNet(t, request => request.respond({ pending: true }));
  const response = await fetch(API_URL, options()), pending = response.body.getReader().read();
  requests[0].response.destroy(); await assert.rejects(pending, /closed before completion/);
});
test('normal EOF with insufficient declared installer bytes still fails existing size/hash validation', async t => {
  const expected = Buffer.from('MZcomplete-fixture-installer');
  const { fetch } = fakeNet(t, request => request.respond({ chunks: [expected.subarray(0, 5)] }));
  const published = require('../src/release-updater.cjs').publishedRelease(release(expected), '1.0.0');
  await assert.rejects(downloadInstaller(fetch, published, '1.0.0'), /published checksum/);
});
test('oversized transport chunk fails before unbounded enqueue', async t => {
  const { fetch } = fakeNet(t, request => request.respond({ chunks: [Buffer.alloc(MAX_BUFFERED + 1)] }));
  const response = await fetch(API_URL, options()); await assert.rejects(response.body.getReader().read(), /buffer exceeds/);
});
test('ignored native pause cannot accumulate more than the bounded transport queue', async t => {
  const { fetch, requests } = fakeNet(t, request => request.respond({ pending: true }));
  const response = await fetch(API_URL, options()); const incoming = requests[0].response;
  for (let i = 0; i <= MAX_BUFFERED / HIGH_WATER_MARK; i++) incoming.emit('data', Buffer.alloc(HIGH_WATER_MARK));
  await assert.rejects(response.body.getReader().read(), /buffer exceeds/); await tick(); assert.equal(requests[0].aborts, 1);
});
test('legitimate coalesced Chromium chunk above 256 KiB remains streamed and ordered', async t => {
  const chunks = [Buffer.alloc(337755, 1), Buffer.alloc(586842, 2), Buffer.alloc(1234, 3)];
  const { fetch } = fakeNet(t, request => request.respond({ chunks }));
  const response = await fetch(API_URL, options()), reader = response.body.getReader(), received = [];
  while (true) { const next = await reader.read(); if (next.done) break; received.push(next.value); await tick(); }
  assert.ok(Buffer.concat(received).equals(Buffer.concat(chunks)));
});
test('slow consumer pauses native stream and resumes in order without prebuffering the entire installer', async t => {
  const chunks = Array.from({ length: 20 }, (_, index) => Buffer.alloc(HIGH_WATER_MARK, index));
  const { fetch, requests } = fakeNet(t, request => request.respond({ chunks }));
  const response = await fetch(API_URL, options()); await tick(); const incoming = requests[0].response;
  assert.ok(incoming.delivered <= 1); assert.ok(incoming.pauses >= 2);
  const reader = response.body.getReader(), received = [];
  while (true) { const next = await reader.read(); if (next.done) break; received.push(next.value); await tick(); }
  assert.ok(Buffer.concat(received).equals(Buffer.concat(chunks))); assert.ok(incoming.resumes > 1); await reader.cancel(); await tick();
  assert.equal(requests[0].listenerCount('error'), 1); assert.equal(incoming.listenerCount('aborted'), 0);
});
test('Electron early Writable finish/close before headers does not retire the HTTP response', async t => {
  const { fetch, requests } = fakeNet(t, request => {
    request.emit('finish'); request.emit('close');
    queueMicrotask(() => request.respond({ chunks: [Buffer.from('later response')] }));
  });
  const response = await fetch(API_URL, options()), reader = response.body.getReader();
  assert.equal((await reader.read()).value.toString(), 'later response'); assert.equal((await reader.read()).done, true);
  await tick(); assert.equal(requests[0].aborts, 0); assert.deepEqual(requests[0].eventNames(), ['error']);
});
test('Electron early Writable close cannot suppress signal cancellation of active HTTP request', async t => {
  const { fetch, requests } = fakeNet(t, request => { request.emit('finish'); request.emit('close'); }), { abort, listeners } = trackedAbort();
  const pending = fetch(API_URL, options(abort.signal)); await tick(); abort.abort(); await assert.rejects(pending, /cancelled/); await tick();
  assert.equal(requests[0].aborts, 1); assert.equal(listeners.size, 0);
  assert.doesNotThrow(() => requests[0].emit('error', new Error('late native cancellation')));
});
test('auth/login challenge supplies no credentials and rejects request', async t => {
  let supplied;
  const { fetch, requests } = fakeNet(t, request => request.emit('login', { isProxy: true }, (...args) => supplied = args));
  await assert.rejects(fetch(API_URL, options()), /authentication/); await tick(); assert.deepEqual(supplied, []); assert.equal(requests[0].aborts, 1);
});
