'use strict';
const { randomUUID } = require('node:crypto');
const { Remote } = require('./remote.cjs');
const { sessionName, integer, terminalBaud } = require('./core.cjs');

/** Ordinary SSH PTY shells. Authentication/trust remain in Remote; no exec/tmux commands. */
class StandardRemote extends Remote {
  constructor(settings, options = {}) {
    super({ ...settings, sessionMode: 'standard' }, options);
    this.shells = new Map();
  }
  async connect() {
    const panes = await super.connect();
    this.client.once('close', () => { for (const record of [...this.shells.values()]) this.finishShell(record); });
    return panes;
  }
  async ensureSupport() {} // Standard mode must never probe/install persistence support.
  async discover() {
    this.panes = [...this.shells.values()].filter(s => !s.dead).map(s => s.pane);
    this.emit('panes', this.panes); return this.panes;
  }
  activeShellCount() { return [...this.shells.values()].filter(s => !s.dead).length; }
  async create(name, launchCommand, baud = this.profile.terminalBaud) {
    const rate = terminalBaud(baud);
    sessionName(name);
    if (!this.connected || this.closing) throw new Error('Not connected.');
    if (this.activeShellCount() >= 16) throw new Error('Close a standard shell before opening more (limit 16 per connection).');
    const uuid = randomUUID(), key = `${this.profile.id}/standard-${uuid}`;
    const pane = { key, profileId: this.profile.id, sessionId: uuid, sessionToken: uuid,
      sessionName: name, windowId: uuid, windowName: 'Shell', windowPanes: 1,
      paneId: uuid, paneIndex: 0, windowIndex: 0, cols: 120, rows: 36,
      command: 'SSH shell', standard: true, dead: false,
      ...(this.profile.local ? {} : { terminalBaud: rate }) };
    const record = { pane, dead: false, channelClosed: false, stream: null, paused: true, serial: 0, pendingWrite: null, pendingBytes: 0, pendingCount: 0, tail: Promise.resolve() };
    const client = this.client; this.shells.set(key, record);
    try {
      const stream = await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error, channel) => {
          if (settled) { channel?.close(); return; }
          settled = true; record.cancelOpen = null; clearTimeout(timer); client.off('close', closed);
          if (error) reject(error); else resolve(channel);
        };
        const closed = () => finish(new Error('Connection closed while opening a standard shell.'));
        const timer = setTimeout(() => finish(new Error('Opening the standard SSH shell timed out.')), this.openTimeoutMs || 20000);
        record.cancelOpen = finish;
        client.once('close', closed);
        try {
          const geometry = { term: 'xterm-256color', cols: pane.cols, rows: pane.rows };
          // PTY creation only: existing jobs, tmux panes and local consoles remain untouched.
          if (!this.profile.local && rate !== 0) geometry.modes = { TTY_OP_ISPEED: rate, TTY_OP_OSPEED: rate };
          const validateOpening = () => { if (settled || record.dead || this.shells.get(key) !== record || this.client !== client || !this.connected || this.closing) throw new Error('Console opening was cancelled. No startup text was sent.'); };
          if (this.profile.local && client.openLocalShell) client.openLocalShell(geometry, launchCommand, finish, validateOpening);
          else if (launchCommand === undefined) client.shell(geometry, finish);
          else client.exec(launchCommand, { pty: geometry }, finish);
        }
        catch (error) { finish(error); }
      });
      if (!this.connected || this.closing || this.client !== client || record.dead) {
        stream.close(); throw new Error('Connection changed while opening a standard shell.');
      }
      record.stream = stream;
      stream.pause(); stream.stderr?.pause();
      const output = bytes => {
        if (!record.dead && this.views.get(key)?.initialized && this.connected && !this.closing) this.emit('output', key, Buffer.from(bytes));
      };
      stream.on('data', output); stream.stderr?.on('data', output);
      stream.on('error', error => { this.emit('notice', `Standard SSH: ${error.message}`); this.finishShell(record); });
      // ssh2 emits the channel's close once stdout drains, independently of
      // stderr. Keep the record available to renderer acknowledgements until
      // stderr also drains; closing it immediately loses a paused stderr tail.
      const finishOutput = () => {
        if (record.channelClosed && (!stream.stderr?.readable || stream.stderr.readableEnded)) this.finishShell(record);
      };
      stream.stderr?.on('end', finishOutput);
      stream.on('close', () => { record.channelClosed = true; record.serial++; finishOutput(); });
      await this.discover(); return pane;
    } catch (error) { this.finishShell(record); throw error; }
  }
  async open(key) {
    const record = this.shells.get(key);
    if (!this.connected || this.closing || !record?.stream || record.dead) throw new Error('This standard session ended. Explicitly open a new shell to continue.');
    if (this.views.get(key)?.initialized) return record.pane;
    this.views.set(key, { pane: record.pane, active: true, initialized: true });
    this.emit('snapshot', key, { data: '', cols: record.pane.cols, rows: record.pane.rows,
      cursorX: 0, cursorY: 0, alternate: false, modes: [0, 0, 0, 0, 0, 0, 1], standard: true });
    record.paused = false; record.stream.resume(); record.stream.stderr?.resume();
    return record.pane;
  }
  async snapshot() { throw new Error('Standard SSH has no retained server snapshot; a new shell must be opened explicitly.'); }
  setOutputPaused(key, paused) {
    const record = this.shells.get(key);
    if (!record?.stream || record.dead || !this.views.get(key)?.initialized || record.paused === paused) return;
    record.paused = paused;
    if (paused) { record.stream.pause(); record.stream.stderr?.pause(); }
    else { record.stream.resume(); record.stream.stderr?.resume(); }
  }
  async input(key, data) {
    const record = this.shells.get(key), view = this.views.get(key);
    if (!this.connected || this.closing || !view?.initialized || !record?.stream || record.dead || record.channelClosed) throw new Error('Not connected. Input was not sent.');
    if (record.pendingWrite?.timedOut) throw new Error('The previous SSH write is still pending. Input was not sent; wait for it to drain.');
    if (typeof data !== 'string' || Buffer.byteLength(data) > 1024 * 1024) throw new Error('Paste exceeds 1 MB. Upload a file instead.');
    let bytes = Buffer.from(data);
    const chunkBytes = this.profile.local ? 65536 : 32768;
    const size = bytes.length, serial = record.serial, stream = record.stream;
    if (record.pendingCount >= 256 || record.pendingBytes + size > 2 * 1024 * 1024) throw new Error('Standard-session input queue is full. Input was not sent.');
    record.pendingCount++; record.pendingBytes += size;
    const current = () => this.connected && !this.closing && !record.dead && !record.channelClosed && record.serial === serial && this.shells.get(key) === record && this.views.get(key) === view;
    const task = record.tail.then(async () => {
      for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
        if (!current()) throw new Error('View changed. Queued input was discarded.');
        await new Promise((resolve, reject) => {
          let settled = false;
          const pending = { timedOut: false, cancel: null }; record.pendingWrite = pending;
          const finish = error => {
            if (settled) return; settled = true; clearTimeout(timer); stream.off('close', closed);
            error ? reject(error) : resolve();
          };
          const written = error => {
            if (record.pendingWrite === pending) record.pendingWrite = null;
            finish(error);
          };
          const closed = pending.cancel = () => written(new Error('Standard shell closed. Remaining input was discarded.'));
          const timer = setTimeout(() => {
            // SSH window backpressure can occur on a healthy shell. Keep the
            // channel alive, invalidate queued messages, and admit no further
            // writes until this submitted chunk's callback eventually drains.
            pending.timedOut = true;
            if (record.serial === serial) record.serial++;
            finish(new Error('Standard SSH input timed out. Some bytes may already have reached the server, and the submitted chunk may still arrive. Unsubmitted input was discarded; the shell remains open.'));
          }, 20000);
          stream.once('close', closed);
          // Own only this chunk in ssh2: a subarray would retain the full paste
          // backing buffer after its timed-out task releases the remainder.
          try { stream.write(Buffer.from(bytes.subarray(offset, offset + chunkBytes)), written); } catch (error) { written(error); }
        });
      }
    }).catch(error => { if (record.serial === serial) record.serial++; throw error; })
      .finally(() => { record.pendingCount--; record.pendingBytes -= size; bytes = null; });
    record.tail = task.catch(() => {}); return task;
  }
  async resize(key, cols, rows) {
    integer(cols, 20, 1000, 'columns'); integer(rows, 5, 500, 'rows');
    const record = this.shells.get(key);
    if (!this.connected || record?.dead || record?.channelClosed || !record?.stream) return;
    record.stream.setWindow(rows, cols, 0, 0); record.pane.cols = cols; record.pane.rows = rows;
  }
  finishShell(record) {
    if (!record || record.dead) return;
    record.dead = true; record.serial++; record.pane.dead = true;
    record.cancelOpen?.(new Error('Console closed while opening.'));
    record.pendingWrite?.cancel(); record.pendingWrite = null;
    this.views.delete(record.pane.key); this.shells.delete(record.pane.key);
    const stream = record.stream; record.stream = null;
    try { stream?.close(); } catch {}
    this.panes = this.panes.filter(p => p.key !== record.pane.key);
    this.emit('ended', record.pane.key); this.emit('panes', this.panes);
  }
  closeView(key) { this.finishShell(this.shells.get(key)); }
  async endSession(key) { this.closeView(key); return this.discover(); }
  async rename(key, name) {
    sessionName(name); const record = this.shells.get(key);
    if (!record || record.dead) throw new Error('This standard session ended.');
    record.pane.sessionName = name; return this.discover();
  }
  disconnect() {
    this.closing = true;
    for (const record of [...this.shells.values()]) this.finishShell(record);
    super.disconnect();
  }
}
module.exports = { StandardRemote };
