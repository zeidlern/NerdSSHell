'use strict';
// Main-only Chromium transport. Manual ClientRequest redirects are events, not
// net.fetch Responses: expose each redirect and let release-updater validate it.
const HIGH_WATER_MARK = 64 * 1024;
// Chromium can coalesce a native data event above the Readable high-water mark
// (337,755 bytes measured in the locked Windows runtime). Bound that event and
// the queued body separately from release-updater's total metadata/file limits.
const MAX_BUFFERED = 4 * 1024 * 1024;
const REQUEST_HEADERS = new Set(['accept', 'user-agent', 'x-github-api-version']);
// Electron can emit native request errors after its Writable has auto-destroyed.
// Keep a closure-free sink after detaching operation-owned listeners.
const ignoreLateRequestError = () => {};
function responseHeaders(values = {}, location) {
  const entries = new Map();
  for (const [name, value] of Object.entries(values)) entries.set(name.toLowerCase(),
    Array.isArray(value) ? value.join(', ') : String(value));
  if (location !== undefined) entries.set('location', location);
  return Object.freeze({ get(name) { return entries.get(String(name).toLowerCase()) ?? null; } });
}
function emptyResponse(status, headers) {
  return Object.freeze({ status, headers, body: new ReadableStream({ start(controller) { controller.close(); } }) });
}
function createReleaseFetch(net) {
  return async (input, options = {}) => {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
      !['api.github.com', 'github.com', 'release-assets.githubusercontent.com'].includes(url.hostname) ||
      options.method !== 'GET' || options.redirect !== 'manual' || options.credentials !== 'omit' || options.cache !== 'no-store')
      throw new Error('Invalid public update request.');
    const headers = {};
    for (const [name, value] of Object.entries(options.headers || {})) {
      if (!REQUEST_HEADERS.has(name.toLowerCase()) || typeof value !== 'string' || /[\r\n]/.test(value))
        throw new Error('Invalid public update header.');
      headers[name] = value;
    }
    const signal = options.signal;
    if (signal?.aborted) throw new Error('Update cancelled.');
    return new Promise((resolve, reject) => {
      let request, incoming, controller, settled = false, terminal = false, aborted = false;
      const detachSignal = () => signal?.removeEventListener('abort', onSignalAbort);
      function cleanupRequest() {
        detachSignal();
        request?.removeListener('response', onResponse); request?.removeListener('redirect', onRedirect);
        request?.removeListener('login', onLogin); request?.removeListener('error', onError);
        request?.removeListener('abort', onAbort);
      }
      function cleanupIncoming() {
        incoming?.removeListener('data', onData); incoming?.removeListener('end', onEnd);
        incoming?.removeListener('error', onError); incoming?.removeListener('aborted', onAbort);
        incoming?.removeListener('close', onIncomingClose);
      }
      const abortRequest = () => { if (!aborted) { aborted = true; try { request?.abort(); } catch {} } };
      function fail(error) {
        if (terminal) return;
        terminal = true; detachSignal();
        if (controller) controller.error(error);
        if (!settled) { settled = true; reject(error); }
        abortRequest(); cleanupRequest();
      }
      function onError(error) { fail(error instanceof Error ? error : new Error('Update transport failed.')); }
      function onAbort() { fail(new Error('Update transport aborted.')); }
      function onSignalAbort() { fail(new Error('Update cancelled.')); }
      function onIncomingClose() {
        if (!terminal) fail(new Error('Update response closed before completion.'));
        cleanupIncoming(); cleanupRequest();
      }
      function onLogin(_auth, callback) {
        // Never request or supply server/proxy credentials for a public update.
        fail(new Error('Public update authentication is unavailable.'));
        try { callback(); } catch {}
      }
      function exposeEmpty(status, headers) {
        terminal = true; settled = true; detachSignal();
        resolve(emptyResponse(status, headers)); abortRequest(); cleanupRequest();
      }
      function onRedirect(status, method, location, values) {
        if (terminal) return;
        if (![301, 302, 303, 307, 308].includes(status) || method !== 'GET') {
          fail(new Error('Invalid update redirect response.')); return;
        }
        // Intentionally never call followRedirect. Cancellation/errors from the
        // original transaction cannot reject the synthetic redirect response.
        exposeEmpty(status, responseHeaders(values, location));
      }
      function onData(chunk) {
        if (terminal) return;
        if (!Buffer.isBuffer(chunk) || chunk.length > MAX_BUFFERED ||
          HIGH_WATER_MARK - controller.desiredSize + chunk.length > MAX_BUFFERED) {
          fail(new Error('Update transport buffer exceeds its limit.')); return;
        }
        controller.enqueue(chunk);
        if (controller.desiredSize <= 0) incoming.pause();
      }
      function onEnd() {
        if (terminal) return;
        terminal = true; detachSignal(); controller.close(); cleanupRequest();
      }
      function onResponse(response) {
        if (terminal) return;
        incoming = response; incoming.pause();
        incoming.on('error', onError); incoming.on('aborted', onAbort); incoming.on('close', onIncomingClose);
        if (response.statusCode !== 200) {
          exposeEmpty(response.statusCode, responseHeaders(response.headers)); return;
        }
        const body = new ReadableStream({
          start(value) { controller = value; },
          pull() { if (!terminal) incoming.resume(); },
          cancel() { if (!terminal) { terminal = true; detachSignal(); abortRequest(); cleanupRequest(); } }
        }, { highWaterMark: HIGH_WATER_MARK, size: chunk => chunk.byteLength });
        // Install end before data as required by Electron IncomingMessage.
        incoming.on('end', onEnd); incoming.on('data', onData);
        settled = true; resolve(Object.freeze({ status: 200, headers: responseHeaders(response.headers), body }));
      }
      try {
        request = net.request({ url: url.href, method: 'GET', headers, redirect: 'manual', credentials: 'omit',
          useSessionCookies: false, cache: 'no-store', bypassCustomProtocolHandlers: true, referrerPolicy: 'no-referrer' });
        request.on('error', ignoreLateRequestError);
        request.on('response', onResponse); request.on('redirect', onRedirect); request.on('login', onLogin);
        request.on('error', onError); request.on('abort', onAbort);
        // In locked Electron, ClientRequest's Writable close fires at end()
        // before response headers. IncomingMessage owns the HTTP lifecycle.
        signal?.addEventListener('abort', onSignalAbort, { once: true });
        if (signal?.aborted) onSignalAbort(); else request.end();
      } catch (error) { fail(error); if (!request) cleanupRequest(); }
    });
  };
}
module.exports = { createReleaseFetch, HIGH_WATER_MARK, MAX_BUFFERED };
