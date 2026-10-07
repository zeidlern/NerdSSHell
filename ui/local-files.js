/* global window, document */
'use strict';
(function (root) {
  const TYPE = 'application/x-nerdsshell-file';
  function parseDrag(raw, { key, browserId, remoteEpoch, localEpoch }, destination) {
    if (typeof raw !== 'string' || !raw || raw.length > 5000) throw new Error('Invalid file drag.');
    const value = JSON.parse(raw);
    if (!value || value.key !== key || value.browserId !== browserId || typeof value.path !== 'string' || !value.path || value.path.length > 4096 || /[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u.test(value.path) || !['local','remote'].includes(value.side)) throw new Error('Drag between Local and Remote in the same File SFTP pane.');
    if (value.side === destination) return null;
    if (value.epoch !== (value.side === 'local' ? localEpoch : remoteEpoch)) throw new Error('The dragged folder listing changed. Select the file again.');
    return value;
  }
  function attach({ api, model, drawer, error }) {
    const el = name => drawer.querySelector(`[data-local="${name}"]`);
    let current = null, selected = null, busy = false, serial = 0, destroyed = false, attempted = false, wasEligible = false, filter = '', hidden = false;
    function eligible() { return !destroyed && !model.disposed && model.visible && model.connected; }
    function status(text) { el('status').textContent = text; }
    function matches(item) { return (hidden || !item.name.startsWith('.')) && item.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()); }
    function controls() {
      const enabled = eligible() && !busy;
      for (const name of ['home','up','refresh','browse','path','go']) el(name).disabled = !enabled;
      el('upload').disabled = !enabled || !selected || model.loading;
      el('download').disabled = !enabled || !current || model.loading || model.selected()?.kind !== 'file';
      for (const row of el('list').children) { row.disabled = !enabled; row.hidden = !matches(current.entries.find(item => item.path === row.dataset.path)); }
      if (el('copy')) el('copy').disabled = !enabled || !current;
    }
    function render(result) {
      current = result; selected = null; el('path').value = result.directory; el('path').title = result.directory;
      el('list').replaceChildren();
      for (const item of result.entries) {
        const row = document.createElement('button'); row.type = 'button'; row.className = 'file-entry'; row.dataset.path = item.path;
        for (const [kind, text] of [['file-kind', item.kind === 'directory' ? 'DIR' : item.kind === 'link' ? 'LINK' : 'FILE'], ['file-name', item.name], ['file-size', item.kind === 'file' ? (item.size / 1024).toFixed(1) + ' KiB' : '']]) {
          const span = document.createElement('span'); span.className = kind; span.textContent = text; row.append(span);
        }
        row.title = item.path;
        const modified = document.createElement('span'); modified.className = 'file-modified'; modified.textContent = new Date(item.modified * 1000).toLocaleString(); row.append(modified);
        row.onclick = e => { e.stopPropagation(); if (!eligible() || busy) return; selected = item.kind === 'file' ? item.path : null; for (const sibling of el('list').children) { const on = sibling === row; sibling.classList.toggle('selected', on); sibling.setAttribute('aria-pressed', String(on)); } controls(); };
        row.ondblclick = e => { e.stopPropagation(); if (item.kind === 'directory') load(item.path); };
        row.onkeydown = e => { if (e.key === 'Enter' && item.kind === 'directory') { e.preventDefault(); load(item.path); } };
        if (item.kind === 'file') { row.draggable = true; row.ondragstart = e => { if (!eligible() || busy || !current?.entries.includes(item) || !matches(item)) { e.preventDefault(); return; } e.stopPropagation(); e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData(TYPE, JSON.stringify({ key: model.key, browserId: model.browserId, side: 'local', path: item.path, epoch: serial })); }; }
        el('list').append(row);
      }
      status(`${result.entries.length} items${result.truncated ? ' · listing limited' : ''} · Browse grants a different folder`); controls();
    }
    async function load(directory = current?.directory || '~', choose = false) {
      if (!eligible() || busy) return; const generation = ++serial; attempted = true; busy = true; selected = null; status('Loading local folder…'); controls();
      try {
        const result = choose ? await api.localFilesChoose(model.key, model.browserId) : await api.localFilesList(model.key, model.browserId, directory);
        if (destroyed || generation !== serial || !eligible()) return;
        if (result) render(result); else status('Folder selection cancelled.');
      } catch (e) { if (!destroyed && generation === serial) { current = null; el('list').replaceChildren(); status(e.message); } }
      finally { if (!destroyed && generation === serial) { busy = false; controls(); } }
    }
    async function upload(file = selected) {
      if (!eligible() || busy || model.loading || !file || !current?.entries.some(x => x.path === file && x.kind === 'file' && matches(x))) return;
      const remote = model.directory, generation = serial; busy = true; controls();
      try { await api.localFilesUpload(model.key, model.browserId, file, remote); if (eligible() && generation === serial) await model.load(remote); }
      catch (e) { error(e.message); } finally { if (!destroyed && generation === serial) { busy = false; controls(); } }
    }
    async function download(file = model.selected()?.path) {
      if (!eligible() || busy || model.loading || !current || !model.entries.some(x => x.path === file && x.kind === 'file' && model.matches(x))) return;
      const directory = current.directory, generation = serial; busy = true; controls();
      try { const result = await api.localFilesDownload(model.key, model.browserId, file); if (result) error('Downloaded to ' + result); }
      catch (e) { error(e.message); }
      finally { if (!destroyed && generation === serial) { busy = false; if (eligible()) await load(directory); else controls(); } }
    }
    el('browse').onclick = () => load('~', true); el('home').onclick = () => load('~'); el('up').onclick = () => load(current?.parent || '~'); el('refresh').onclick = () => load(current?.directory || '~');
    el('go').onclick = () => load(el('path').value); el('path').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); load(el('path').value); } };
    el('upload').onclick = () => upload(); el('download').onclick = () => download();
    if (el('filter')) el('filter').oninput = () => { filter = el('filter').value.slice(0, 500); if (!current?.entries.some(item => item.path === selected && matches(item))) selected = null; controls(); };
    if (el('hidden')) el('hidden').onchange = () => { hidden = el('hidden').checked; if (!current?.entries.some(item => item.path === selected && matches(item))) selected = null; controls(); };
    if (el('copy')) el('copy').onclick = () => { if (eligible() && current) api.copy(selected || current.directory).catch(e => error(e.message)); };
    const local = el('panel'), remote = drawer.querySelector('.file-remote');
    function accept(panel, side) {
      panel.addEventListener('dragover', e => { if (Array.from(e.dataTransfer.types).includes(TYPE) || Array.from(e.dataTransfer.types).includes('Files')) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = side === 'local' && !Array.from(e.dataTransfer.types).includes(TYPE) ? 'none' : 'copy'; } });
      panel.addEventListener('drop', e => {
        if (!Array.from(e.dataTransfer.types).includes(TYPE) && !e.dataTransfer.files.length) return;
        e.preventDefault(); e.stopPropagation(); if (!eligible() || busy) return;
        const raw = e.dataTransfer.getData(TYPE);
        if (!raw) { if (side === 'remote') model.upload(Array.from(e.dataTransfer.files)).catch(x => error(x.message)); return; }
        try { const value = parseDrag(raw, { key: model.key, browserId: model.browserId, remoteEpoch: model.epoch, localEpoch: serial }, side); if (!value) return; if (side === 'local') download(value.path); else upload(value.path); }
        catch (x) { error(x.message); }
      });
    }
    accept(local, 'local'); accept(remote, 'remote');
    return { changed() {
      const active = eligible();
      if (!active && wasEligible) { serial++; busy = false; selected = null; attempted = false; }
      wasEligible = active;
      controls(); if (active && !attempted && !busy) load();
    }, destroy() { destroyed = true; serial++; current = selected = null; } };
  }
  if (typeof module !== 'undefined') module.exports = { attach, TYPE, parseDrag };
  else root.NerdSSHellLocalFiles = { attach, TYPE, parseDrag };
})(typeof window === 'undefined' ? globalThis : window);
