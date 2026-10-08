'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');
const { profile } = require('./core.cjs');
const { settings: quickSettings, recent: quickRecent, addRecent } = require('./quick-connect.cjs');
function quickPreferences(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Quick Connect preferences.');
  return { defaults: quickSettings(value.defaults), recent: quickRecent(value.recent ?? []) };
}
const { appearance } = require('../ui/appearance.js');
const { validateSettings } = require('./action-settings.cjs');
const { notifications, sessionDefaults, preferences } = require('./preferences.cjs');
const DEFAULT_APPEARANCE = Object.freeze(appearance());
function workbenchPreferences(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Quick Actions preferences.');
  const favorites = value.favorites === undefined ? ['system.info', 'system.disk', 'updates.check'] : value.favorites;
  if (!Array.isArray(favorites) || favorites.length > 3 || favorites.some(id => typeof id !== 'string' || !/^[a-z]+\.[a-z]+$/.test(id) || id.length > 64)) throw new Error('Invalid Quick Actions favorites.');
  return { favorites: [...new Set(favorites)] };
}
function initialState() { return { version: 1, profiles: [], pins: {}, quickConnect: quickPreferences(), appearance: appearance(), notifications: notifications(), sessionDefaults: sessionDefaults(), workspace: workspace(), workbench: workbenchPreferences(), actionConfiguration: validateSettings() }; }
function workspace(w = {}) {
  const layout = [1, 2, 4].includes(w.layout) ? w.layout : 1;
  const order = Array.isArray(w.order) ? [...new Set(w.order.filter(x => typeof x === 'string' && x.length < 240))].slice(0, 256) : [];
  const seen = new Set();
  const slots = Array.isArray(w.slots) && w.slots.length === layout ? w.slots.map(key => {
    if (typeof key !== 'string' || !order.includes(key) || seen.has(key)) return null;
    seen.add(key); return key;
  }) : [];
  return { layout,
    twoPaneOrientation: w.twoPaneOrientation === 'stacked' ? 'stacked' : 'side-by-side',
    order, slots,
    active: typeof w.active === 'string' ? w.active.slice(0, 240) : '',
    splitX: Math.min(80, Math.max(20, Number(w.splitX) || 50)),
    splitY: Math.min(80, Math.max(20, Number(w.splitY) || 50)) };
}
class StateStore {
  constructor(directory) {
    this.directory = directory; this.file = path.join(directory, 'settings.json');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.data = initialState();
    if (fs.existsSync(this.file)) {
      try {
        const v = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (v.version !== 1 || !Array.isArray(v.profiles) || typeof v.pins !== 'object' || !v.pins) throw new Error('Unsupported settings format.');
        const legacy = workbenchPreferences(v.workbench);
        const actionConfiguration = validateSettings(v.actionConfiguration ?? { favoritesByOS: Object.fromEntries(require('./action-settings.cjs').OS_TYPES.map(os => [os, legacy.favorites])) });
        this.data = { version: 1, profiles: v.profiles.map(profile), pins: { ...v.pins }, quickConnect: quickPreferences(v.quickConnect), appearance: appearance(v.appearance), notifications: notifications(v.notifications), sessionDefaults: sessionDefaults(v.sessionDefaults), workspace: workspace(v.workspace), workbench: legacy, actionConfiguration };
      } catch (e) {
        // Preserve corrupt data and fail explicitly, rather than silently losing connections or trust pins.
        throw new Error(`Cannot read ${this.file}. The file has not been changed. ${e.message}`);
      }
    }
  }
  save() {
    const temp = this.file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(this.data, null, 2) + '\n', { mode: 0o600 });
    // Windows requires a writable file handle for FlushFileBuffers.
    const fd = fs.openSync(temp, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.file + '.backup');
    fs.renameSync(temp, this.file);
  }
  putProfile(p) {
    p = profile(p); const prior = this.data.profiles;
    this.data.profiles = prior.filter(x => x.id !== p.id).concat(p);
    try { this.save(); } catch (error) { this.data.profiles = prior; throw error; } return p;
  }
  setQuickConnectDefaults(value) {
    const defaults = quickSettings(value), prior = this.data.quickConnect;
    return this.putQuickConnect({ defaults, recent: defaults.historyEnabled ? prior.recent : [] });
  }
  clearQuickConnectHistory() { return this.putQuickConnect({ ...this.data.quickConnect, recent: [] }); }
  rememberQuickConnect(target) {
    const prior = this.data.quickConnect;
    return prior.defaults.historyEnabled ? this.putQuickConnect({ ...prior, recent: addRecent(prior.recent, target) }) : prior;
  }
  putQuickConnect(value) {
    const next = quickPreferences(value), prior = this.data.quickConnect; this.data.quickConnect = next;
    try { this.save(); } catch (error) { this.data.quickConnect = prior; throw error; } return next;
  }
  setAppearance(value) { this.data.appearance = appearance(value); this.save(); return this.data.appearance; }
  setPreferences(value) {
    const next = preferences(value, this.data), prior = this.data;
    this.data = { ...prior, ...next };
    try { this.save(); } catch (error) { this.data = prior; throw error; }
    return next;
  }
  setWorkspace(w) { const prior = this.data.workspace; this.data.workspace = workspace(w); try { this.save(); } catch (error) { this.data.workspace = prior; throw error; } }
}
function publishExport(source, destination) {
  // Both paths are in the chosen directory. Hardlink creation is exclusive, so a
  // file appearing after the Save dialog cannot be overwritten by this export.
  try { fs.linkSync(source, destination); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('The export destination now exists. No file was overwritten.');
    throw error;
  }
}
/** Streaming VT text filter. State persists across packets, including split OSC/CSI sequences and UTF-8. */
class PlainText {
  constructor() { this.decoder = new StringDecoder('utf8'); this.state = 'text'; this.cr = false; }
  push(data) {
    let out = '';
    for (const ch of this.decoder.write(data)) {
      if (this.cr) { this.cr = false; out += '\n'; if (ch === '\n') continue; }
      if (this.state === 'text') {
        if (ch === '\x1b') this.state = 'escape';
        else if (ch === '\r') this.cr = true;
        else if (ch === '\n' || ch === '\t' || ch.codePointAt(0) >= 32 && !/[\x7f-\x9f]/.test(ch)) out += ch;
      } else if (this.state === 'escape') {
        if (ch === '[') this.state = 'csi';
        else if (ch === ']' || ch === 'P' || ch === '_' || ch === '^' || ch === 'X') this.state = 'string';
        else if ('()*+-./'.includes(ch)) this.state = 'charset';
        else this.state = 'text';
      } else if (this.state === 'charset') this.state = 'text';
      else if (this.state === 'csi') { if (ch >= '@' && ch <= '~') this.state = 'text'; }
      else if (this.state === 'string') {
        if (ch === '\x07') this.state = 'text'; else if (ch === '\x1b') this.state = 'stringEscape';
      } else if (this.state === 'stringEscape') this.state = ch === '\\' ? 'text' : 'string';
    }
    return out;
  }
}
class Archive {
  constructor(root, profileId, limitMB = 256, segmentBytes = 4 * 1024 * 1024) {
    if (!/^[a-zA-Z0-9_-]+$/.test(profileId)) throw new Error('Invalid archive ID.');
    this.dir = path.join(root, 'history', profileId); this.limit = limitMB * 1024 * 1024;
    this.segmentBytes = Math.min(segmentBytes, this.limit); this.filters = new Map(); this.pending = []; this.pendingBytes = 0;
    this.queuedBytes = 0; this.sequence = 0; this.chain = Promise.resolve(); this.error = null; this.current = null; this.currentBytes = 0;
    this.searchBudgetBytes = 128 * 1024 * 1024; this.searchActive = false; this.chunkBudgetBytes = 8 * 1024 * 1024;
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.timer = setInterval(() => this.flush().catch(() => {}), 500); this.timer.unref();
  }
  append(key, bytes) {
    if (this.error) return;
    if (bytes.length > this.chunkBudgetBytes) {
      this.error = new Error('A history output chunk exceeded the recording memory budget. Recording stopped; live terminal remains available.');
      return;
    }
    let filter = this.filters.get(key); if (!filter) this.filters.set(key, filter = new PlainText());
    const clean = filter.push(bytes); if (!clean) return;
    const record = JSON.stringify({ at: new Date().toISOString(), key, text: clean }) + '\n';
    const size = Buffer.byteLength(record); this.pendingBytes += size; this.queuedBytes += size;
    // Never let a slow/full disk consume unbounded RAM or block remote jobs indefinitely.
    if (this.queuedBytes > 8 * 1024 * 1024) { this.error = new Error('History writer is too far behind. Recording stopped; live terminal remains available.'); return; }
    this.pending.push(record);
    if (this.pendingBytes >= 256 * 1024) this.flush().catch(() => {});
  }
  flush() {
    const records = this.pending.splice(0); const queued = this.pendingBytes; this.pendingBytes = 0;
    this.chain = this.chain.then(async () => {
      if (this.error) throw this.error;
      for (const record of records) {
        if (!this.current || this.currentBytes + Buffer.byteLength(record) > this.segmentBytes) {
          this.current = path.join(this.dir, `${Date.now()}-${String(this.sequence++).padStart(6, '0')}.jsonl`); this.currentBytes = 0;
        }
        await fsp.appendFile(this.current, record, { mode: 0o600 }); this.currentBytes += Buffer.byteLength(record);
      }
      await this.prune();
    }).catch(e => { this.error = e; throw e; }).finally(() => { this.queuedBytes = Math.max(0, this.queuedBytes - queued); });
    return this.chain;
  }
  async files() { return (await fsp.readdir(this.dir)).filter(n => /^\d+-\d+\.jsonl$/.test(n)).sort(); }
  async prune() {
    const files = await this.files(); let total = 0;
    const stats = await Promise.all(files.map(async n => [n, (await fsp.stat(path.join(this.dir, n))).size]));
    for (const [, size] of stats) total += size;
    for (const [name, size] of stats) {
      if (total <= this.limit) break;
      if (path.join(this.dir, name) === this.current) continue;
      await fsp.unlink(path.join(this.dir, name)); total -= size;
    }
  }
  async search(key, query, limit = 300) {
    if (this.searchActive) throw new Error('A local history search is already running.');
    this.searchActive = true;
    try {
      await this.flush();
      const needle = String(query).toLocaleLowerCase(); const found = [];
      limit = Math.max(1, Math.min(300, Number(limit) || 300));
      const readline = require('node:readline'); let tail = ''; let at = '';
      const files = await this.files(); let bytes = 0, first = files.length;
      for (let i = files.length - 1; i >= 0; i--) {
        const size = (await fsp.stat(path.join(this.dir, files[i]))).size;
        if (i < files.length - 1 && bytes + size > this.searchBudgetBytes) break;
        bytes += size; first = i;
      }
      for (const file of files.slice(first)) {
        const input = fs.createReadStream(path.join(this.dir, file));
        const lines = readline.createInterface({ input, crlfDelay: Infinity });
        try {
          for await (const line of lines) {
            let row; try { row = JSON.parse(line); } catch { continue; }
            if (row.key !== key) continue;
            at = row.at; const parts = (tail + row.text).split('\n'); tail = parts.pop().slice(-16384);
            for (const value of parts) {
              if (value && (!needle || value.toLocaleLowerCase().includes(needle))) {
                found.push({ at, text: value.slice(0, 16384) }); if (found.length > limit) found.shift();
              }
            }
          }
        } finally { lines.close(); input.destroy(); }
      }
      if (tail && (!needle || tail.toLocaleLowerCase().includes(needle))) found.push({ at, text: tail });
      return found.slice(-limit);
    } finally { this.searchActive = false; }
  }
  async exportTo(key, destination) {
    await this.flush(); const out = fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 });
    const { once } = require('node:events'); const readline = require('node:readline');
    let failure; out.on('error', e => { failure = e; });
    try {
      for (const file of await this.files()) {
        const input = fs.createReadStream(path.join(this.dir, file)); const lines = readline.createInterface({ input, crlfDelay: Infinity });
        try { for await (const line of lines) { const row = JSON.parse(line); if (row.key === key) { if (failure) throw failure; if (!out.write(row.text)) await once(out, 'drain'); } } }
        finally { lines.close(); input.destroy(); }
      }
      const done = once(out, 'finish'); out.end(); await done;
      if (failure) throw failure;
    } catch (e) { out.destroy(); throw e; }
  }
  async close() { clearInterval(this.timer); await this.flush(); }
}
module.exports = { StateStore, Archive, PlainText, workspace, appearance, DEFAULT_APPEARANCE, publishExport };
