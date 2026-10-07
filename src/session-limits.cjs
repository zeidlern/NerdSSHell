'use strict';

const MAX_OPEN_VIEWS = 64;
const MAX_DISCOVERED_PANES = 1024;
function resourceLimitError(message) { const error = new Error(message); error.code = 'NERDSSHELL_RESOURCE_LIMIT'; return error; }

// Count live/pending ordinary shells even before their renderer view opens.
// Persistent views and their shared shell records count once by provider/key.
class ViewBudget {
  constructor(connections, limit = MAX_OPEN_VIEWS) {
    this.connections = connections; this.limit = limit; this.pending = new Set(); this.transports = new WeakMap();
  }
  entries() {
    const entries = new Map();
    const add = (remote, key) => {
      let keys = entries.get(remote); if (!keys) entries.set(remote, keys = new Set()); keys.add(key);
    };
    for (const { remote } of this.connections.values()) {
      if (!remote || remote.connected === false || remote.closing) continue;
      for (const [key, view] of remote.views || []) if (view.active) add(remote, key);
      for (const [key, shell] of remote.shells || []) if (!shell.dead) add(remote, key);
    }
    for (const slot of this.pending) {
      // A closed/replaced view does not cancel an underlying SSH channel open.
      // Keep that old generation separate until its operation actually settles.
      const current = slot.resource && (slot.kind === 'shell'
        ? slot.remote?.shells?.get(slot.key) === slot.resource && !slot.resource.dead
        : slot.remote?.views?.get(slot.key) === slot.resource && slot.resource.active);
      add(slot.remote, current ? slot.key : slot);
    }
    return entries;
  }
  async run(remote, key, operation) {
    const entries = this.entries();
    const view = key !== undefined && remote?.views?.get(key), shell = key !== undefined && remote?.shells?.get(key);
    // Repeated opens of the same current view join its operation. A closed or
    // replaced generation must reserve separately even when its key is reused.
    const prior = key !== undefined && [...this.pending].find(slot => slot.remote === remote && slot.key === key && slot.kind === 'view' && slot.resource === view && view?.active);
    if (prior) return prior.task;
    const existing = key !== undefined && (view?.active || shell && !shell.dead);
    if (!existing && [...entries.values()].reduce((sum, keys) => sum + keys.size, 0) >= this.limit) {
      throw resourceLimitError(`Close an unused terminal tab before opening more (limit ${this.limit} across the app). Remote sessions were left running.`);
    }
    const slot = existing ? null : { remote, key, resource: null, kind: null, task: null, transport: null };
    if (slot) this.pending.add(slot); // Reserve synchronously, before any dialog/await.
    const unobserve = () => {
      if (!slot?.transport) return;
      const state = this.transports.get(slot.transport); state.slots.delete(slot);
      if (!state.slots.size) slot.transport.off('close', state.closed);
      slot.transport = null;
    };
    const release = () => { if (slot) { this.pending.delete(slot); unobserve(); } };
    const observe = provider => {
      if (!slot) return;
      const transport = provider?.client;
      if (slot.transport === transport) return;
      unobserve();
      if (typeof transport?.once === 'function' && typeof transport?.off === 'function') {
        let state = this.transports.get(transport);
        if (!state) {
          state = { slots: new Set(), closed: null };
          state.closed = () => { for (const held of state.slots) { this.pending.delete(held); held.transport = null; } state.slots.clear(); };
          this.transports.set(transport, state);
        }
        if (!state.slots.size) transport.once('close', state.closed);
        state.slots.add(slot); slot.transport = transport;
      }
    };
    observe(remote);
    const bind = (provider, identity) => {
      if (!slot) return;
      slot.remote = provider; slot.key = identity;
      observe(provider);
      const record = provider?.shells?.get(identity);
      slot.kind = record ? 'shell' : 'view'; slot.resource = record || provider?.views?.get(identity);
    };
    const before = new Set(remote?.shells?.keys() || []);
    try {
      const task = operation(bind);
      if (slot) {
        if (key !== undefined) bind(remote, key);
        else {
          const created = [...(remote?.shells?.keys() || [])].find(identity => !before.has(identity));
          if (created !== undefined) bind(remote, created);
        }
        slot.task = task;
      }
      return await task;
    }
    finally { release(); }
  }
}

module.exports = { MAX_OPEN_VIEWS, MAX_DISCOVERED_PANES, ViewBudget, resourceLimitError };
