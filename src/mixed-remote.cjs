'use strict';
const { Remote } = require('./remote.cjs');
const { StandardRemote } = require('./standard-remote.cjs');

/** One authenticated transport, two session providers. Persistence belongs to a session. */
class MixedRemote extends Remote {
  constructor(settings, options = {}) {
    super(settings, options);
    this.standard = new StandardRemote(settings, { ...options, secrets: {} });
    this.standard.views = this.views;
    this.shells = this.standard.shells;
    this.persistenceReady = false;
    this.supportTask = null;
    this.allowDiscovery = true;
    this.standard.on('panes', () => this.emit('panes', this.panes.filter(p => !p.standard)));
    for (const type of ['snapshot', 'output', 'notice', 'ended', 'detached']) this.standard.on(type, (...args) => this.emit(type, ...args));
  }
  emit(type, ...args) {
    if (type === 'panes' && this.standard) {
      this.panes = [...args[0].filter(p => !p.standard), ...this.standard.panes];
      return super.emit(type, this.panes);
    }
    return super.emit(type, ...args);
  }
  // Connect never installs anything. A new Persistent session explicitly enables support.
  async ensureSupport() {
    this.standard.client = this.client;
    this.standard.connected = true;
    this.standard.closing = false;
    const client = this.client;
    client.prependOnceListener('close', () => {
      if (this.standard.client !== client) return;
      this.standard.connected = false;
      for (const record of [...this.shells.values()]) this.standard.finishShell(record);
      this.standard.client = null;
    });
  }
  generic() { return this.profile.terminalType === 'generic'; }
  assertServerAutomation() {
    if (this.generic()) throw new Error('Network-device connections use a plain SSH shell. Linux actions, task commands and persistence are unavailable.');
  }
  exec(command, options) {
    if (this.generic()) return Promise.reject(new Error('Network-device connections never execute server probes or task commands. Use the interactive terminal.'));
    return super.exec(command, options);
  }
  async enablePersistence() {
    this.assertServerAutomation();
    if (this.persistenceReady) return;
    if (this.supportTask) return this.supportTask;
    const client = this.client;
    this.supportTask = (async () => {
      await Remote.prototype.ensureSupport.call(this);
      if (!this.connected || this.closing || this.client !== client) throw new Error('Connection changed while enabling persistence.');
      this.persistenceReady = true; this.allowDiscovery = true;
    })().finally(() => { this.supportTask = null; });
    return this.supportTask;
  }
  async discover() {
    if (!this.connected || this.closing) throw new Error('Not connected.');
    if (this.generic() || !this.allowDiscovery) { this.emit('panes', []); return this.panes; }
    if (!this.persistenceReady) {
      // Read-only check; do not ask for sudo merely because the connection was opened.
      let probe;
      try { probe = await this.exec('command -v tmux >/dev/null 2>&1 && tmux -V', { timeout: 10000, maxBytes: 1024 }); }
      catch (error) { if (!this.connected || this.closing) throw error; this.emit('panes', []); return this.panes; }
      if (!this.connected || this.closing) throw new Error('Connection changed while discovering sessions.');
      if (probe.code !== 0 || !/tmux (?:[4-9]|[1-9]\d)\.|tmux 3\.(?:[2-9]|[1-9]\d)/.test(probe.stdout)) {
        this.emit('panes', []); return this.panes;
      }
      this.persistenceReady = true;
    }
    await Remote.prototype.discover.call(this);
    return this.panes;
  }
  isStandard(key) { return typeof key === 'string' && key.startsWith(this.profile.id + '/standard-'); }
  activeShellCount() { return this.standard.activeShellCount(); }
  async createSession(name, persistent = !this.generic(), baud) {
    if (persistent) this.assertServerAutomation();
    if (persistent && baud !== undefined) throw new Error('Terminal baud overrides apply only to new Standard SSH shells.');
    if (typeof persistent !== 'boolean') throw new Error('Choose whether the session is persistent.');
    if (!persistent) return this.standard.create(name, undefined, baud);
    await this.enablePersistence(); return Remote.prototype.create.call(this, name);
  }
  async create(name, command) { this.assertServerAutomation(); await this.enablePersistence(); return Remote.prototype.create.call(this, name, command); }
  async createTask(name, code) { return this.createTaskFor(name, code, this.profile.sessionMode !== 'standard'); }
  async createTaskFor(name, code, persistent = true) {
    this.assertServerAutomation();
    if (typeof persistent !== 'boolean') throw new Error('Choose whether the task is persistent.');
    const command = require('./action-catalog.cjs').taskCommand(code);
    if (!persistent) return this.standard.create(name, command);
    return this.create(name, command);
  }
  open(key) { return this.isStandard(key) ? this.standard.open(key) : super.open(key); }
  input(key, data) { return this.isStandard(key) ? this.standard.input(key, data) : super.input(key, data); }
  resize(key, cols, rows) { return this.isStandard(key) ? this.standard.resize(key, cols, rows) : super.resize(key, cols, rows); }
  snapshot(key) { return this.isStandard(key) ? this.standard.snapshot(key) : super.snapshot(key); }
  setOutputPaused(key, paused) { if (this.isStandard(key)) this.standard.setOutputPaused(key, paused); }
  closeView(key) { return this.isStandard(key) ? this.standard.closeView(key) : super.closeView(key); }
  rename(key, name) { return this.isStandard(key) ? this.standard.rename(key, name) : super.rename(key, name); }
  endSession(key) { return this.isStandard(key) ? this.standard.endSession(key) : super.endSession(key); }
  disconnect() {
    for (const record of [...this.shells.values()]) this.standard.finishShell(record);
    this.standard.connected = false; this.standard.closing = true; this.standard.client = null; this.standard.secrets = {};
    super.disconnect();
  }
}
module.exports = { MixedRemote };
