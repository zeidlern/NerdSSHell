'use strict';

function ownerKey(key) {
  if (typeof key !== 'string' || key.length > 240 || key.length < 3 || !key.includes('/') || /[\x00-\x1f\x7f]/.test(key)) throw new Error('Invalid file-browser session.');
  return key;
}
function browserToken(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) throw new Error('Invalid file-browser identity.');
  return value;
}
/** Pending listings belong to a browser instance and pane, never just to a host. */
class FileListings {
  constructor(limit = 16) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 64) throw new Error('Invalid listing concurrency limit.');
    this.limit = limit; this.requests = new Map(); this.pending = new Set();
  }
  async run({ key, browserId, profileId, valid }, operation) {
    ownerKey(key); browserToken(browserId);
    if (typeof valid !== 'function' || !valid()) throw new Error('File-browser session changed. Refresh and try again.');
    const prior = this.requests.get(browserId);
    if (prior && prior.key !== key) throw new Error('File browser belongs to a different session.');
    // Count superseded operations until cancellation settles. openSftp also
    // bounds channel opens and close acknowledgements after callers return.
    if (prior) this.cancel(key, browserId);
    if (this.pending.size >= this.limit) throw new Error('Too many directory requests. Wait for a listing to finish.');
    const controller = new AbortController();
    const request = { key, browserId, profileId, controller, valid };
    this.requests.set(browserId, request); this.pending.add(request);
    try {
      const result = await operation(controller.signal);
      if (controller.signal.aborted || this.requests.get(browserId) !== request || !valid()) throw new Error('File-browser session changed or listing was cancelled.');
      return result;
    } finally { this.pending.delete(request); if (this.requests.get(browserId) === request) this.requests.delete(browserId); }
  }
  cancel(key, browserId) {
    ownerKey(key); browserToken(browserId);
    const request = this.requests.get(browserId);
    if (request?.key === key) request.controller.abort();
  }
  cancelView(key) { for (const r of this.pending) if (r.key === key) r.controller.abort(); }
  cancelProfile(id) { for (const r of this.pending) if (r.profileId === id) r.controller.abort(); }
}
module.exports = { FileListings, ownerKey, browserToken };
