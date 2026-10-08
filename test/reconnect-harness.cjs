'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const settle = () => new Promise(resolve => setImmediate(resolve));
function source(relative, revision) {
  return revision ? execFileSync('git', ['show', revision + ':' + relative], { cwd: root, encoding: 'utf8' }) : fs.readFileSync(path.join(root, relative), 'utf8');
}
function createMain({ revision, profiles, behavior = async () => {} } = {}) {
  const events = [], created = [], deadlines = new Map(), handlers = new Map(); let nextDeadline = 0;
  const filename = path.join(root, 'src/main.cjs'), localRequire = createRequire(filename);
  class SessionProvider extends EventEmitter {
    constructor(settings, options) {
      super(); this.profile = settings; this.options = options; this.secrets = options.secrets;
      this.views = new Map(); this.controls = new Map(); this.shells = new Map(); this.panes = [];
      this.client = new EventEmitter(); this.client.end = () => this.client?.emit('close');
      this.connected = false; this.closing = false; this.disconnectCount = 0; this.launchCount = 0;
      created.push(this);
    }
    async connect() { await behavior(this); if (this.closing) throw new Error('Sign-in cancelled.'); this.connected = true; return this.panes; }
    async prompt() { const answer = await this.options.ask({ title: 'Fixture login', message: 'Synthetic fixture only.', secret: true, credentialKind: 'ssh-password' }); if (answer === null || this.closing) throw new Error('Sign-in cancelled.'); this.secrets.password = answer; }
    async createSession() { this.launchCount++; }
    disconnect() { this.disconnectCount++; this.closing = true; this.connected = false; this.client = null; this.secrets = {}; for (const view of this.views.values()) view.active = false; this.views.clear(); }
    drop(reason = new Error('Fixture network loss.')) { this.connected = false; this.emit('disconnected', reason); }
    activeShellCount() { return this.shells.size; }
  }
  const app = { isPackaged: true, getPath: () => root, setPath() {}, commandLine: { getSwitchValue: () => root }, requestSingleInstanceLock: () => false, quit() {} };
  const electron = { app, dialog: {}, protocol: { registerSchemesAsPrivileged() {} }, ipcMain: { handle: (name, fn) => handlers.set(name, fn) } };
  const context = vm.createContext({ Buffer, process, console, AbortController, __dirname: path.dirname(filename),
    require: name => name === 'electron' ? electron : name === './mixed-remote.cjs' ? { MixedRemote: SessionProvider } : localRequire(name),
    setTimeout(fn, ms) { const id = ++nextDeadline; deadlines.set(id, { fn, ms }); return id; }, clearTimeout(id) { deadlines.delete(id); }, events, profiles });
  vm.runInContext(source('src/main.cjs', revision) + `
    window = { isDestroyed: () => false, webContents: { send: (_channel, event) => events.push(event) } };
    store = { data: { profiles, pins: {} }, save() {} };
    globalThis.probe = { connect, disconnect, connections, prompts, output,
      respond: (id, value) => prompts.get(id)?.(value),
      cleanup: () => { for (const id of connections.keys()) disconnect(id); } };
  `, context);
  return { ...context.probe, events, created, deadlines, handlers, fireRetry() { const entry = [...deadlines].find(([, item]) => item.ms <= 30000); if (!entry) return false; deadlines.delete(entry[0]); entry[1].fn(); return true; } };
}
function loadRemote(revision) {
  if (!revision) return require('../src/remote.cjs').Remote;
  const filename = path.join(root, 'src/remote.cjs'), module = { exports: {} };
  vm.runInNewContext(source('src/remote.cjs', revision), { require: createRequire(filename), module, Buffer, process, console, setTimeout, clearTimeout });
  return module.exports.Remote;
}
module.exports = { createMain, loadRemote, settle, root };
