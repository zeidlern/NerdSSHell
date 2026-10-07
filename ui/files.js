/* global window, document, ResizeObserver */
'use strict';
(function (root) {
  function token() { return root.crypto.randomUUID ? root.crypto.randomUUID() : Array.from(root.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join(''); }
  function panelSize(requested, available, minimum = 180) {
    if (!Number.isFinite(available) || available <= 0) return 0;
    // Keep at least 35% of the pane for its terminal, even in a small quadrant.
    const maximum = Math.max(0, Math.min(available * 0.65, available - Math.min(160, available * 0.45)));
    return Math.round(Math.min(maximum, Math.max(Math.min(minimum, maximum), requested)));
  }
  /** A browser is permanently owned by one terminal view. No active-tab/host-global state. */
  class BrowserState {
    constructor(api, { key, profileId, browserId = token(), changed = () => {} } = {}) {
      if (typeof key !== 'string' || !key.startsWith(profileId + '/')) throw new Error('A file browser needs its owning terminal.');
      Object.defineProperties(this, { key: { value: key, enumerable: true }, id: { value: profileId, enumerable: true }, browserId: { value: browserId, enumerable: true } });
      this.api = api; this.changed = changed; this.visible = false; this.disposed = false; this.connected = false;
      this.label = ''; this.sessionLabel = ''; this.epoch = 0; this.loading = false;
      this.directory = '~'; this.parent = '~'; this.entries = []; this.error = ''; this.truncated = false; this.skipped = 0;
      this.filter = ''; this.hidden = false; this.selectedPath = null; this.dock = 'right'; this.width = 560; this.height = 320;
    }
    cancel() {
      this.epoch++;
      if (this.loading) Promise.resolve(this.api.cancelFileList(this.key, this.browserId)).catch(() => {});
      this.loading = false;
    }
    context(label, connected, sessionLabel = '') {
      if (this.disposed) return;
      const reconnect = !!connected && !this.connected;
      if (!!connected !== this.connected) this.cancel();
      const changed = label !== this.label || sessionLabel !== this.sessionLabel || !!connected !== this.connected;
      this.label = label; this.sessionLabel = sessionLabel; this.connected = !!connected;
      if (changed) this.changed();
      if (reconnect && this.visible) this.load(this.directory);
    }
    show(value) {
      if (this.disposed) return;
      const newlyOpened = !!value && !this.visible;
      this.visible = !!value;
      if (!value) this.cancel();
      this.changed();
      if (newlyOpened && this.connected) this.load(this.directory);
    }
    setDock(value) {
      if (!['right', 'bottom'].includes(value)) throw new Error('Invalid file-browser dock.');
      this.dock = value; this.changed();
    }
    setSize(value) {
      if (!Number.isFinite(value)) return;
      if (this.dock === 'right') this.width = Math.max(120, Math.min(900, value));
      else this.height = Math.max(120, Math.min(900, value));
      this.changed();
    }
    matches(entry) { return (this.hidden || !entry.name.startsWith('.')) && entry.name.toLocaleLowerCase().includes(this.filter.toLocaleLowerCase()); }
    setFilter(value) { this.filter = value.slice(0, 500); if (!this.selected()) this.selectedPath = null; this.changed(); }
    setHidden(value) { this.hidden = !!value; if (!this.selected()) this.selectedPath = null; this.changed(); }
    select(path) { this.selectedPath = this.entries.some(e => e.path === path && this.matches(e)) ? path : null; this.changed(); }
    selected() { return this.entries.find(e => e.path === this.selectedPath && this.matches(e)) || null; }
    async load(directory) {
      if (this.disposed || !this.visible || !this.connected) return;
      this.cancel(); const epoch = this.epoch;
      this.loading = true; this.error = ''; this.changed();
      try {
        const result = await this.api.listFiles(this.key, this.browserId, directory);
        if (this.epoch !== epoch || this.disposed || !this.visible || !this.connected) return;
        const sameDirectory = result.directory === this.directory;
        this.directory = result.directory; this.parent = result.parent; this.entries = result.entries;
        if (!sameDirectory || !this.selected()) this.selectedPath = null;
        this.truncated = result.truncated; this.skipped = result.skipped;
      } catch (error) { if (this.epoch === epoch && !this.disposed) this.error = error.message; }
      finally { if (this.epoch === epoch && !this.disposed) { this.loading = false; this.changed(); } }
    }
    async upload(files = null) {
      if (this.disposed || !this.visible || !this.connected || this.loading) return [];
      const directory = this.directory, epoch = this.epoch;
      const result = await this.api.browserUpload(this.key, directory, files);
      if (!this.disposed && this.visible && this.connected && this.epoch === epoch) await this.load(directory);
      return result;
    }
    async download() {
      const item = this.selected();
      if (this.disposed || !this.visible || !this.connected || this.loading || item?.kind !== 'file') return null;
      // Capture owner and path before any native dialog/await.
      return this.api.downloadFile(this.key, item.path);
    }
    destroy() { if (this.disposed) return; this.cancel(); this.disposed = true; this.changed = () => {}; }
  }
  function create({ api, onError, container, toggle, key, profileId, onStateChange = () => {} }) {
    const drawer = document.getElementById('fileBrowserTemplate').content.firstElementChild.cloneNode(true);
    const el = name => drawer.querySelector(`[data-file="${name}"]`);
    const model = new BrowserState(api, { key, profileId });
    drawer.id = 'files-' + model.browserId; drawer.dataset.ownerKey = key;
    toggle.setAttribute('aria-controls', drawer.id); toggle.setAttribute('aria-expanded', 'false');
    container.append(drawer);
    let entriesRendered, filterRendered, hiddenRendered, local;
    function text(tag, value, cls) { const n = document.createElement(tag); n.textContent = value; if (cls) n.className = cls; return n; }
    function size(bytes) { if (bytes === null) return ''; if (bytes < 1024) return `${bytes} B`; if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KiB`; return `${(bytes / 1048576).toFixed(1)} MiB`; }
    function resize() {
      if (model.disposed || !model.visible) return;
      const rect = container.getBoundingClientRect();
      drawer.style.width = model.dock === 'right' ? panelSize(model.width, rect.width) + 'px' : '100%';
      drawer.style.height = model.dock === 'bottom' ? panelSize(model.height, rect.height, 150) + 'px' : '100%';
      el('grip').setAttribute('aria-valuenow', String(Math.round(model.dock === 'right' ? drawer.offsetWidth : drawer.offsetHeight)));
    }
    function render() {
      if (model.disposed) return;
      drawer.hidden = !model.visible; container.dataset.fileDock = model.dock;
      toggle.classList.toggle('active', model.visible); toggle.setAttribute('aria-expanded', String(model.visible));
      drawer.setAttribute('aria-label', `Files for ${model.sessionLabel || 'terminal'} — ${model.label}`);
      el('server').textContent = model.label || 'Server disconnected';
      el('server').title = 'Uses this saved SSH connection and account, not a nested ssh or sudo shell.';
      el('session').textContent = model.sessionLabel;
      // Do not reset a path being edited just because focus moved or the pane resized.
      if (document.activeElement !== el('path')) el('path').value = model.directory;
      el('dock').value = model.dock; el('filter').value = model.filter; el('hidden').checked = model.hidden;
      el('grip').setAttribute('aria-orientation', model.dock === 'right' ? 'vertical' : 'horizontal');
      const enabled = model.visible && model.connected && !model.loading;
      for (const name of ['home', 'up', 'refresh', 'go', 'upload', 'path']) el(name).disabled = !enabled;
      el('download').disabled = !enabled || model.selected()?.kind !== 'file';
      el('copy').disabled = !enabled;
      el('status').textContent = !model.connected ? 'Disconnected — cached listing. Reconnect this terminal to browse.' : model.loading ? 'Loading…' : model.error || `${model.entries.length} items${model.truncated ? ' — listing limited to 1,000 entries / 256 KiB' : ''}${model.skipped ? `; ${model.skipped} unsupported names hidden` : ''}`;
      const list = el('list');
      if (entriesRendered !== model.entries || filterRendered !== model.filter || hiddenRendered !== model.hidden) {
        entriesRendered = model.entries; filterRendered = model.filter; hiddenRendered = model.hidden;
        list.replaceChildren();
        for (const item of model.entries) {
          if (!model.matches(item)) continue;
          const row = document.createElement('button'); row.type = 'button'; row.className = 'file-entry'; row.dataset.path = item.path;
          row.title = `${item.path}\n${item.kind}${item.modified !== null ? '\n' + new Date(item.modified * 1000).toLocaleString() : ''}`;
          row.append(text('span', item.kind === 'directory' ? 'DIR' : item.kind === 'link' ? 'LINK' : 'FILE', 'file-kind'), text('span', item.name, 'file-name'), text('span', item.kind === 'file' ? size(item.size) : '', 'file-size'));
          row.append(text('span', item.modified === null ? '' : new Date(item.modified * 1000).toLocaleString(), 'file-modified'));
          row.onclick = event => { event.stopPropagation(); model.select(item.path); };
          row.ondblclick = event => { event.stopPropagation(); if (item.kind === 'directory' || item.kind === 'link') model.load(item.path); };
          row.onkeydown = event => { if (event.key === 'Enter' && (item.kind === 'directory' || item.kind === 'link')) { event.preventDefault(); model.load(item.path); } };
          if (item.kind === 'file' && root.NerdSSHellLocalFiles) {
            row.draggable = true;
            row.ondragstart = event => {
              if (!model.visible || !model.connected || model.loading || model.disposed || !model.entries.includes(item)) { event.preventDefault(); return; }
              event.stopPropagation(); event.dataTransfer.effectAllowed = 'copy';
              event.dataTransfer.setData(root.NerdSSHellLocalFiles.TYPE, JSON.stringify({ key: model.key, browserId: model.browserId, side: 'remote', path: item.path, epoch: model.epoch }));
            };
          }
          list.append(row);
        }
      }
      for (const row of list.children) { row.disabled = !enabled; row.classList.toggle('selected', row.dataset.path === model.selectedPath); row.setAttribute('aria-pressed', String(row.dataset.path === model.selectedPath)); }
      local?.changed(); resize(); onStateChange();
    }
    model.changed = render;
    if (root.NerdSSHellLocalFiles && drawer.querySelector('[data-local="panel"]')) local = root.NerdSSHellLocalFiles.attach({ api, model, drawer, error: onError });
    toggle.onclick = () => model.show(!model.visible);
    el('close').onclick = () => { model.show(false); toggle.focus(); };
    el('dock').onchange = () => model.setDock(el('dock').value);
    el('home').onclick = () => model.load('~'); el('up').onclick = () => model.load(model.parent); el('refresh').onclick = () => model.load(model.directory);
    el('go').onclick = () => model.load(el('path').value);
    el('path').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); el('go').focus(); model.load(el('path').value); } };
    el('hidden').onchange = () => model.setHidden(el('hidden').checked);
    el('filter').oninput = () => model.setFilter(el('filter').value);
    el('upload').onclick = () => model.upload().catch(error => onError(error.message));
    el('download').onclick = () => model.download().then(result => { if (result) onError('Downloaded to ' + result); }).catch(error => onError(error.message));
    el('copy').onclick = () => api.copy(model.selected()?.path || model.directory).catch(error => onError(error.message));
    // Do not let a file drop bubble into the parent terminal's default-upload handler.
    drawer.addEventListener('dragover', event => {
      if (Array.from(event.dataTransfer.types).includes('Files')) { event.preventDefault(); event.stopPropagation(); }
    });
    drawer.addEventListener('drop', event => {
      if (!event.dataTransfer.files.length) return; // Pane dragging still belongs to the layout.
      event.preventDefault(); event.stopPropagation();
      model.upload(Array.from(event.dataTransfer.files)).catch(error => onError(error.message));
    });
    const grip = el('grip'); let dragging = null;
    const stop = () => { dragging = null; grip.classList.remove('dragging'); };
    grip.addEventListener('pointerdown', event => {
      event.preventDefault(); event.stopPropagation();
      dragging = { pointerId: event.pointerId, dock: model.dock }; grip.setPointerCapture(event.pointerId); grip.classList.add('dragging');
    });
    grip.addEventListener('pointermove', event => {
      if (!dragging || dragging.pointerId !== event.pointerId || dragging.dock !== model.dock) return;
      const rect = container.getBoundingClientRect();
      const requested = model.dock === 'right' ? rect.right - event.clientX : rect.bottom - event.clientY;
      model.setSize(panelSize(requested, model.dock === 'right' ? rect.width : rect.height, model.dock === 'right' ? 180 : 150));
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) grip.addEventListener(event, stop);
    grip.onkeydown = event => {
      const directions = model.dock === 'right' ? { ArrowLeft: 20, ArrowRight: -20 } : { ArrowUp: 20, ArrowDown: -20 };
      if (directions[event.key]) { event.preventDefault(); event.stopPropagation(); model.setSize((model.dock === 'right' ? drawer.offsetWidth : drawer.offsetHeight) + directions[event.key]); }
    };
    const observer = new ResizeObserver(resize); observer.observe(container);
    const destroy = model.destroy.bind(model);
    model.destroy = () => { destroy(); local?.destroy(); observer.disconnect(); stop(); toggle.onclick = null; drawer.remove(); };
    render(); return model;
  }
  if (typeof module !== 'undefined') module.exports = { BrowserState, panelSize };
  else root.NerdSSHellFiles = { create, BrowserState, panelSize };
})(typeof window === 'undefined' ? globalThis : window);
