'use strict';

// Run with a complete, script-disabled npm installation. An optional argument
// selects an isolated dependency checkout, leaving the supported app install alone.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const rootRequire = createRequire(path.join(root, 'package.json'));
const builderRequire = createRequire(rootRequire.resolve('app-builder-lib/package.json'));
const getRequire = createRequire(builderRequire.resolve('@electron/get'));
const proxyPackage = getRequire('global-agent/package.json');
assert.equal(proxyPackage.version, '4.1.3', 'Optional build proxy override must be installed');
assert.equal(builderRequire('@electron/get/package.json').version, '3.1.0');
assert.throws(() => getRequire.resolve('roarr'), { code: 'MODULE_NOT_FOUND' });
assert.throws(() => getRequire.resolve('sprintf-js'), { code: 'MODULE_NOT_FOUND' });

// The downloaded content, both endpoints and the forwarding allowlist are local.
const bytes = Buffer.from('NerdSSHell disposable build-proxy compatibility fixture\n');
const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
const tempRoot = path.resolve(os.tmpdir());
const cache = fs.mkdtempSync(path.join(tempRoot, 'nerdsshell-build-proxy-'));
assert.equal(path.dirname(cache), tempRoot, 'Cleanup must stay inside the disposable temp directory');
const directRequest = http.request;
const directAgent = new http.Agent({ keepAlive: false });
const sockets = new Set();
let originRequests = 0;
let proxyRequests = 0;
const origin = http.createServer((_request, response) => {
  originRequests++;
  response.writeHead(200, { 'content-length': bytes.length });
  response.end(bytes);
});
let originPort;
const proxy = http.createServer((request, response) => {
  proxyRequests++;
  const target = new URL(request.url);
  assert.equal(target.protocol, 'http:');
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(Number(target.port), originPort);
  const forwarded = directRequest(target, { agent: directAgent }, upstream => {
    response.writeHead(upstream.statusCode, upstream.headers);
    upstream.pipe(response);
  });
  forwarded.on('error', error => response.destroy(error));
  request.pipe(forwarded);
});
for (const server of [origin, proxy]) {
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
}
function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function main() {
  originPort = await listen(origin);
  const proxyPort = await listen(proxy);
  // Clear inherited download/proxy overrides inside this disposable process.
  for (const key of Object.keys(process.env)) {
    if (/^(?:npm_config_|ELECTRON_|GLOBAL_AGENT_|HTTP_PROXY$|HTTPS_PROXY$|NO_PROXY$)/i.test(key)) {
      delete process.env[key];
    }
  }
  process.env.ELECTRON_GET_USE_PROXY = '1';
  process.env.GLOBAL_AGENT_HTTP_PROXY = `http://127.0.0.1:${proxyPort}`;
  const get = builderRequire('@electron/get');
  assert.ok(global.GLOBAL_AGENT, '@electron/get must bootstrap the optional proxy');
  assert.equal(global.GLOBAL_AGENT.HTTP_PROXY, process.env.GLOBAL_AGENT_HTTP_PROXY);
  const download = (name, expected = checksum, mode = get.ElectronDownloadCacheMode.ReadWrite) => get.downloadArtifact({
    version: '9.9.9',
    artifactName: name,
    isGeneric: true,
    cacheRoot: cache,
    cacheMode: mode,
    checksums: { [name]: expected },
    mirrorOptions: { resolveAssetURL: async () => `http://127.0.0.1:${originPort}/${name}` },
    downloadOptions: { retry: { limit: 0 }, timeout: { request: 3000 } }
  });

  const proxied = await download('proxied.bin');
  assert.deepEqual(fs.readFileSync(proxied), bytes);
  assert.equal(proxyRequests, 1, 'Download must actually traverse the proxy');
  assert.equal(originRequests, 1);
  await download('proxied.bin');
  assert.equal(proxyRequests, 1, 'A valid cached artifact must avoid another download');
  assert.equal(originRequests, 1);

  global.GLOBAL_AGENT.NO_PROXY = '127.0.0.1';
  const bypassed = await download('bypassed.bin');
  assert.deepEqual(fs.readFileSync(bypassed), bytes);
  assert.equal(proxyRequests, 1, 'NO_PROXY must bypass forwarding');
  assert.equal(originRequests, 2);

  global.GLOBAL_AGENT.NO_PROXY = null;
  await assert.rejects(download('tampered.bin', '0'.repeat(64)), /checksum/i);
  assert.equal(proxyRequests, 2, 'Checksum rejection must exercise the proxy download');
  assert.equal(originRequests, 3);
  console.log('Verified optional build proxy bootstrap, loopback forwarding, cache reuse, NO_PROXY bypass and checksum rejection; roarr/sprintf-js absent.');
}

const deadline = setTimeout(() => {
  console.error('Build-proxy fixture timed out');
  process.exit(1);
}, 15000);
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  clearTimeout(deadline);
  for (const socket of sockets) socket.destroy();
  origin.close();
  proxy.close();
  directAgent.destroy();
  fs.rmSync(cache, { recursive: true, force: true });
});
