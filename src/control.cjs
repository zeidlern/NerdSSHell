'use strict';
const { EventEmitter } = require('node:events');
const { unescapeOctal } = require('./core.cjs');

/** tmux control mode over a raw SSH exec channel; never pass this protocol through a local PTY. */
class Control extends EventEmitter {
  constructor(stream, { timeout = 15000, maxBuffer = 64 * 1024 * 1024 } = {}) {
    super(); this.stream = stream; this.timeout = timeout; this.maxBuffer = maxBuffer;
    this.fragments = []; this.pendingFragments = []; this.pendingBytes = 0; this.fragmentBytes = 0;
    this.queue = []; this.queuedBytes = 0; this.active = null; this.block = null; this.closed = false;
    this.started = false;
    this.ready = new Promise((resolve, reject) => { this.startResolve = resolve; this.startReject = reject; });
    // Attach a rejection observer immediately; callers still receive the original rejected promise.
    this.ready.catch(() => {});
    this.startTimer = setTimeout(() => this.fail(new Error('Session attachment timed out.')), timeout);
    stream.on('data', b => { try { this.feed(b); } catch (e) { this.fail(e); } });
    stream.on('error', e => this.fail(e));
    stream.on('close', () => this.fail(new Error('Session disconnected.')));
  }
  feed(chunk) {
    if (this.closed) return;
    if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk);
    let start = 0, eol;
    while ((eol = chunk.indexOf(10, start)) >= 0) {
      const part = chunk.subarray(start, eol);
      if (part.length > this.maxBuffer - this.fragmentBytes) throw new Error('Remote protocol buffer limit exceeded.');
      const line = this.fragmentBytes ? Buffer.concat([...this.fragments, ...this.pendingFragments, part], this.fragmentBytes + part.length) : part;
      this.fragments = []; this.pendingFragments = []; this.pendingBytes = 0; this.fragmentBytes = 0;
      this.line(line); start = eol + 1;
      if (this.closed) break;
    }
    if (!this.closed && start < chunk.length) {
      const part = chunk.subarray(start);
      if (part.length > this.maxBuffer - this.fragmentBytes) throw new Error('Remote protocol buffer limit exceeded.');
      this.pendingFragments.push(Buffer.from(part)); this.pendingBytes += part.length; this.fragmentBytes += part.length;
      if (this.pendingFragments.length >= 1024) {
        this.fragments.push(Buffer.concat(this.pendingFragments, this.pendingBytes));
        this.pendingFragments = []; this.pendingBytes = 0;
      }
    }
  }
  line(raw) {
    const str = raw.toString('utf8');
    const guard = /^%(begin|end|error) (\d+) (\d+) (\d+)$/.exec(str);
    if (this.block) {
      if (guard && guard[1] !== 'begin' && `${guard[2]} ${guard[3]} ${guard[4]}` === this.block.identity) {
        const body = this.block.lines; this.block = null;
        if (!this.started) {
          clearTimeout(this.startTimer);
          if (guard[1] === 'error') return this.fail(new Error(Buffer.concat(body).toString('utf8') || 'Attachment failed.'));
          this.started = true; this.startResolve(); this.pump(); return;
        }
        const active = this.active; this.active = null;
        if (!active) throw new Error('Unexpected protocol response.');
        clearTimeout(active.timer);
        if (guard[1] === 'error') active.reject(new Error(body.map(x => x.toString('utf8')).join('\n') || 'Remote command failed.'));
        else {
          try { active.onComplete?.(body); active.resolve(body); } catch (e) { active.reject(e); }
        }
        this.pump(); return;
      }
      // Budget the newline and retained Buffer/array overhead, including empty lines.
      this.block.bytes += raw.length + 64;
      if (this.block.bytes > this.maxBuffer) throw new Error('Session history response is too large. Reduce the history limit.');
      this.block.lines.push(Buffer.from(raw)); return;
    }
    if (guard && guard[1] === 'begin') {
      this.block = { identity: `${guard[2]} ${guard[3]} ${guard[4]}`, lines: [], bytes: 0 }; return;
    }
    const output = /^%output (%\d+) /.exec(str);
    if (output) { this.emit('output', output[1], unescapeOctal(raw.subarray(output[0].length))); return; }
    const extended = /^%extended-output (%\d+) \d+(?: [^:]*)? : /.exec(str);
    if (extended) { this.emit('output', extended[1], unescapeOctal(raw.subarray(extended[0].length))); return; }
    if (str.startsWith('%exit')) return this.fail(new Error('The persistent session ended or detached.'));
    if (str.startsWith('%')) this.emit('notification', str);
    // Login banners and shell startup output are ignored outside guarded protocol blocks.
  }
  request(command, onComplete, canSend) {
    if (typeof command !== 'string' || /[\r\n\0]/.test(command)) return Promise.reject(new Error('Invalid control command.'));
    if (this.closed) return Promise.reject(new Error('Session is disconnected. Input was not sent.'));
    if (canSend !== undefined && typeof canSend !== 'function') return Promise.reject(new Error('Invalid send guard.'));
    const size = Buffer.byteLength(command) + 64;
    if (this.queue.length >= 256 || size > 2 * 1024 * 1024 - this.queuedBytes) return Promise.reject(new Error('Session command queue is full.'));
    return new Promise((resolve, reject) => { this.queue.push({ command, size, resolve, reject, onComplete, canSend }); this.queuedBytes += size; this.pump(); });
  }
  pump() {
    if (!this.started || this.closed || this.active) return;
    while (this.queue.length) {
      const job = this.queue.shift(); this.queuedBytes -= job.size;
      // A view can close while its command waits behind another pane's request.
      // Reject it before the transport write without detaching the shared channel.
      try {
        if (job.canSend && !job.canSend()) throw new Error('View changed before sending input. Input was discarded.');
      } catch (error) { job.reject(error); continue; }
      this.active = job;
      // A timeout closes the channel; otherwise a late reply could be misassigned.
      job.timer = setTimeout(() => this.fail(new Error('Server response timed out. Reconnect to continue.')), this.timeout);
      try { this.stream.write(job.command + '\n'); } catch (error) { this.fail(error); }
      return;
    }
  }
  fail(error) {
    if (this.closed) return; this.closed = true; clearTimeout(this.startTimer);
    this.fragments = []; this.pendingFragments = []; this.pendingBytes = 0; this.fragmentBytes = 0; this.block = null;
    this.startReject(error);
    if (this.active) { clearTimeout(this.active.timer); this.active.reject(error); this.active = null; }
    for (const job of this.queue.splice(0)) job.reject(error);
    this.queuedBytes = 0;
    this.emit('closed', error);
    this.stream.destroy();
  }
  detach() {
    if (this.closed) return;
    // Closing a control client does not issue kill-session, kill-pane, Ctrl+C, or exit to the shell.
    this.fail(new Error('View detached. Remote work was left running.'));
  }
}
module.exports = { Control };
