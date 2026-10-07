'use strict';
const { randomUUID } = require('node:crypto');

/** Bounded per-view display delivery; renderer acknowledgements are generation-specific. */
class OutputBuffer {
  constructor({ emit, recover, maxBytes = 4 * 1024 * 1024, flushDelay = 12 } = {}) {
    if (typeof emit !== 'function' || typeof recover !== 'function') throw new Error('Output callbacks are required.');
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid output budget.');
    this.emit = emit; this.recover = recover; this.maxBytes = maxBytes; this.flushDelay = flushDelay;
    this.states = new Map();
  }
  keys() { return this.states.keys(); }
  discard(key) {
    const state = this.states.get(key);
    if (state) { clearTimeout(state.timer); state.chunks = []; state.bytes = 0; }
    this.states.delete(key);
  }
  queue(key, bytes) {
    if (!bytes.length) return;
    let state = this.states.get(key);
    if (!state) {
      state = { chunks: [], bytes: 0, inflight: false, sequence: 0, epoch: randomUUID(), overflow: false, recovering: false };
      this.states.set(key, state);
    }
    if (state.overflow) return;
    if (bytes.length > this.maxBytes - state.bytes) {
      state.overflow = true; state.chunks = []; state.bytes = 0;
      clearTimeout(state.timer);
      this.emit('recovering', { key });
      // If the FIRST event overflows there is no outstanding acknowledgement.
      // Start recovery ourselves, rather than wait forever for an impossible ack.
      if (!state.inflight) this.refresh(key, state);
      return;
    }
    state.chunks.push(bytes); state.bytes += bytes.length;
    clearTimeout(state.timer); state.timer = setTimeout(() => this.flush(key), this.flushDelay);
    if (state.bytes > 32768) this.flush(key);
  }
  flush(key) {
    const state = this.states.get(key);
    if (!state || state.overflow || state.inflight || !state.chunks.length) return;
    clearTimeout(state.timer);
    const data = Buffer.concat(state.chunks); state.chunks = []; state.bytes = 0;
    state.inflight = true; state.sequence++;
    this.emit('output', { key, sequence: state.sequence, epoch: state.epoch, data: data.toString('base64') });
  }
  ack(key, epoch, sequence) {
    const state = this.states.get(key);
    if (!state?.inflight || state.epoch !== epoch || state.sequence !== sequence) return;
    state.inflight = false;
    if (state.overflow) this.refresh(key, state); else this.flush(key);
  }
  refresh(key, state) {
    if (this.states.get(key) !== state || state.recovering) return;
    state.recovering = true;
    // Defer until the current remote-output callback unwinds. Keep one recovery
    // per overflow episode; close/snapshot/reconnect invalidate this exact state.
    state.recoveryTask = Promise.resolve().then(async () => {
      if (this.states.get(key) !== state) return;
      this.emit('notice', { message: 'The display buffer filled. Refreshing from retained server history; some older output may be missing.' });
      await this.recover(key);
      // A successful snapshot is delivered via main's snapshot handler, which
      // discards this state. A silent/no-op snapshot must not appear recovered.
      if (this.states.get(key) === state) throw new Error('No current snapshot was delivered.');
    }).catch(error => {
      if (this.states.get(key) !== state) return;
      this.emit('recovery-failed', { key });
      this.emit('notice', { message: `Display refresh failed: ${error.message}. Reopen this view to retry; remote work was left running.` });
      // Stay stale, drop further live bytes, and require an explicit reopen. No
      // automatic retry storm and no unhandled rejection on a failed refresh.
    });
  }
}
module.exports = { OutputBuffer };
