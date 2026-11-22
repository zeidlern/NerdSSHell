'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { LocalFiles, localPath, inside } = require('../src/local-files.cjs');
const { createFileOperations } = require('../src/file-operations.cjs');
const { parseDrag, attach } = require('../ui/local-files.js');
const { BrowserState } = require('../ui/files.js');
const { EventEmitter } = require('node:events');
const { Readable, Writable } = require('node:stream');
const { upload, captureUploadSource } = require('../src/transfer.cjs');
const { download } = require('../src/sftp-browser.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
async function fixture(t) {
  // The real panel returns canonical paths. Windows temp roots can be case
  // aliases or junctions; use that same identity rather than a lexical alias.
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'nerdsshell-ux-files-'))); t.after(() => fs.rm(home, { recursive: true, force: true }));
  await fs.mkdir(path.join(home, 'sub')); await fs.writeFile(path.join(home, 'marker.txt'), 'synthetic fixture');
  const views = new Map([['host/a', { active: true }], ['host/b', { active: true }]]);
  const remote = { profile: { id: 'host', name: 'Fixture', host: 'fixture.invalid', username: 'synthetic', uploadDirectory: '/remote' }, connected: true, views };
  let online = true;
  const fileOwner = key => {
    const view = views.get(key); if (!view || !online) throw new Error('Session changed.');
    const valid = () => online && views.get(key) === view;
    const validate = () => { if (!valid()) throw new Error('Session changed.'); };
    return { remote, view, key, profileId: 'host', valid, validate };
  };
  const files = new LocalFiles(fileOwner, { home });
  return { home, files, fileOwner, remote, views, disconnect() { online = false; remote.connected = false; } };
}
const remoteListing = (directory = '/remote', file = 'report.txt') => ({ directory, entries: [{ path: `${directory}/${file}`, kind: 'file' }, { path: `${directory}/link`, kind: 'link' }] });
test('local grants allow navigation inside one chosen root and reject arbitrary absolute folders', async t => {
  const h = await fixture(t), first = await h.files.list('host/a', 'a', '~');
  assert.equal(first.directory, await fs.realpath(h.home));
  const nested = await h.files.list('host/a', 'a', path.join(h.home, 'sub')); assert.equal(nested.parent, first.directory);
  await assert.rejects(h.files.list('host/a', 'a', path.dirname(h.home)), /outside/);
  assert.equal(h.files.records.get('a').entries.length, 0, 'failed navigation clears old upload authorization');
  await assert.rejects(h.files.capture('host/a', 'a', path.join(h.home, 'marker.txt')), /Select/);
});
test('native folder grant is scoped to its pane rather than other same-host panes', async t => {
  const h = await fixture(t), chosen = await fs.mkdtemp(path.join(os.tmpdir(), 'nerdsshell-chosen-')); t.after(() => fs.rm(chosen, { recursive: true, force: true }));
  assert.equal((await h.files.list('host/a', 'a', '~', chosen)).directory, await fs.realpath(chosen));
  await h.files.list('host/b', 'b', '~'); await assert.rejects(h.files.list('host/b', 'b', chosen), /outside/);
  assert.throws(() => h.files.record('host/b', 'a'), /another session/);
});
test('stalled local filesystem times out promptly while retaining a bounded pending reservation', async t => {
  const h = await fixture(t), wait = deferred(), files = new LocalFiles(h.fileOwner, { home: h.home, timeoutMs: 10, io: { ...fs, realpath: () => wait.promise } });
  await assert.rejects(files.list('host/a', 'a', '~'), /timed out/); assert.equal(files.pending, 1);
  await assert.rejects(files.list('host/a', 'a', '~'), /Wait/);
  wait.resolve(await fs.realpath(h.home)); await tick(); assert.equal(files.pending, 0); assert.equal(files.records.get('a').entries.length, 0);
});
test('local path validation rejects relative, oversized, control and bidi paths', () => {
  for (const value of ['../file', '', 'x'.repeat(5000), path.resolve('bad\nname'), path.resolve('bad\u202efile')]) assert.throws(() => localPath(value));
  assert.equal(inside(path.resolve('one'), path.resolve('one-other')), false);
});
test('upload selection rejects arbitrary paths, directories and changed metadata', async t => {
  const h = await fixture(t); await h.files.list('host/a', 'a', '~');
  await assert.rejects(h.files.capture('host/a', 'a', path.join(h.home, 'sub')), /Select/);
  await assert.rejects(h.files.capture('host/a', 'a', path.join(h.home, 'not-listed.txt')), /Select/);
  await fs.writeFile(path.join(h.home, 'marker.txt'), 'changed content and size');
  await assert.rejects(h.files.capture('host/a', 'a', path.join(h.home, 'marker.txt')), /changed/);
});
test('captured source and folder become invalid on navigation, view replacement or disconnect', async t => {
  const h = await fixture(t); await h.files.list('host/a', 'a', '~'); const c = await h.files.capture('host/a', 'a', path.join(h.home, 'marker.txt'));
  await h.files.list('host/a', 'a', path.join(h.home, 'sub')); assert.throws(c.validate, /changed/);
  const d = await h.files.capture('host/a', 'a'); h.views.set('host/a', {}); assert.throws(d.validate, /changed/);
  await h.files.list('host/a', 'new', '~'); const e = await h.files.capture('host/a', 'new'); h.disconnect(); assert.throws(e.validate, /changed/);
});
test('source symlink replacement is refused during an upload confirmation', async t => {
  const h = await fixture(t); await h.files.list('host/a', 'a', '~'); const c = await h.files.capture('host/a', 'a', path.join(h.home, 'marker.txt'));
  const io = h.files.io; h.files.io = { ...io, lstat: async file => file === c.selected.path ? { isFile: () => false } : io.lstat(file) };
  await assert.rejects(c.revalidate(), /changed/);
});
test('root and destination reparse replacement is refused during download confirmation', async t => {
  const h = await fixture(t); await h.files.list('host/a', 'a', '~'); const c = await h.files.capture('host/a', 'a');
  const io = h.files.io; h.files.io = { ...io, realpath: async value => value === c.directory ? path.dirname(c.directory) : io.realpath(value) };
  await assert.rejects(c.revalidate(), /changed/);
});
test('remote upload destination and download source require a same-pane fresh listing', async t => {
  const h = await fixture(t); h.files.rememberRemote('host/a', 'a', remoteListing()); h.files.rememberRemote('host/b', 'b', remoteListing('/other'));
  assert.throws(() => h.files.captureRemote('host/a', 'a', '/other', true), /Refresh/);
  assert.throws(() => h.files.captureRemote('host/a', 'a', '/remote/link'), /Refresh/);
  assert.throws(() => h.files.captureRemote('host/b', 'b', '/remote/report.txt'), /Refresh/);
  const c = h.files.captureRemote('host/a', 'a', '/remote/report.txt'); h.files.clearRemote('host/a', 'a'); assert.throws(c.validate, /changed/);
});
function install(h, { confirm = async () => true, dialog = {}, adapters = {} } = {}) {
  const handlers = new Map(), calls = [], events = [];
  const operations = createFileOperations({
    forKey(key) { h.fileOwner(key); return { profile: h.remote.profile, remote: h.remote }; },
    getRemote: () => h.remote, getWindow() {}, confirm,
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [h.home] }), ...dialog },
    emit: (_type, event) => events.push(event)
  }, {
    listDirectory: async (_remote, directory) => remoteListing(directory),
    upload: async (remote, sources, options) => { calls.push({ remote, sources, directory: options.directory }); return ['copied']; },
    download: async (remote, source, target) => { calls.push({ remote, source, target }); return target; },
    ...adapters
  });
  operations.register((name, fn) => handlers.set(name, fn));
  const invoke = (name, ...args) => handlers.get(name)(...args);
  return { invoke, calls, events, operations, async prepare() {
    await invoke('localFilesChoose', 'host/a', 'a');
    await invoke('listFiles', 'host/a', 'a', '/remote');
  } };
}
test('local copy arrows preserve explicit owner and paths without using focus or active-tab state', async t => {
  const h = await fixture(t), i = install(h), source = path.join(h.home, 'marker.txt');
  await i.prepare();
  assert.deepEqual(await i.invoke('localFilesUpload', 'host/a', 'a', source, '/remote'), ['copied']);
  assert.equal(i.calls[0].remote, h.remote); assert.equal(i.calls[0].directory, '/remote'); assert.equal(i.calls[0].sources[0].file, source);
  assert.equal(await i.invoke('localFilesDownload', 'host/a', 'a', '/remote/report.txt'), path.join(h.home, 'report.txt'));
  assert.deepEqual(i.events.map(({ key, status }) => [key, status]), [['host/a', 'starting'], ['host/a', 'finished'], ['host/a', 'starting'], ['host/a', 'finished']]);
});
test('cancelled download starts no transfer; changes while prompt is pending fail closed', async t => {
  const h = await fixture(t), no = install(h, { confirm: async () => false });
  await no.prepare();
  assert.equal(await no.invoke('localFilesDownload', 'host/a', 'a', '/remote/report.txt'), null);
  assert.equal(no.calls.length, 0);
  const wait = deferred(), entered = deferred(), yes = install(h, { confirm: () => { entered.resolve(); return wait.promise; } });
  await yes.prepare();
  const copying = yes.invoke('localFilesDownload', 'host/a', 'a', '/remote/report.txt');
  const rejected = assert.rejects(copying, /changed/);
  await entered.promise;
  await yes.invoke('listFiles', 'host/a', 'a', '/other');
  wait.resolve(true); await rejected;
  assert.equal(yes.calls.length, 0); assert.equal(yes.events.length, 0);
});
test('local upload revalidation remains active after initial selection until confirmation completes', async t => {
  const h = await fixture(t), wait = deferred(), entered = deferred();
  const i = install(h, { confirm: () => { entered.resolve(); return wait.promise; } });
  await i.prepare();
  const copying = i.invoke('localFilesUpload', 'host/a', 'a', path.join(h.home, 'marker.txt'), '/remote');
  const rejected = assert.rejects(copying, /changed/);
  await entered.promise; // Replace only after capture reaches the confirmation boundary.
  await fs.writeFile(path.join(h.home, 'marker.txt'), 'replaced file'); wait.resolve(true); await rejected;
  assert.equal(i.calls.length, 0);
});
test('a terminal upload picked from disk cannot use approval after its pane is replaced on the same connection', async t => {
  const h = await fixture(t), wait = deferred(), entered = deferred(), source = path.join(h.home, 'marker.txt');
  const i = install(h, {
    dialog: { showOpenDialog: async () => ({ filePaths: [source] }) },
    confirm: () => { entered.resolve(); return wait.promise; }
  });
  const uploading = i.invoke('upload', 'host/a', null);
  await entered.promise;
  h.views.set('host/a', { active: true });
  wait.resolve(true);
  assert.deepEqual(await uploading, []);
  assert.equal(i.calls.length, 0);
  assert.equal(i.events.length, 0);
});
test('the per-pane upload compares its selection with the file identity reviewed by the transfer prompt', async t => {
  const h = await fixture(t), file = path.join(h.home, 'marker.txt');
  const reviewed = await captureUploadSource(file);
  reviewed.stat.ino += 1n;
  const i = install(h, { adapters: { captureUploadSource: async () => reviewed } });
  await i.prepare();
  await assert.rejects(i.invoke('localFilesUpload', 'host/a', 'a', file, '/remote'), /file changed/);
  assert.equal(i.calls.length, 0);
});
test('a pending folder picker cannot grant a replacement owner', async t => {
  const h = await fixture(t), wait = deferred(), i = install(h, { dialog: { showOpenDialog: () => wait.promise } });
  const selected = i.invoke('localFilesChoose', 'host/a', 'a'); h.views.set('host/a', { active: true }); wait.resolve({ canceled: false, filePaths: [h.home] });
  await assert.rejects(selected, /changed/);
  await i.invoke('listFiles', 'host/a', 'a', '/remote');
  await assert.rejects(i.invoke('localFilesDownload', 'host/a', 'a', '/remote/report.txt'), /Load a local folder/);
});
test('native and pane transfers share capacity until cancelled operations settle', async t => {
  const h = await fixture(t), full = deferred(), active = [];
  const i = install(h, {
    dialog: { showSaveDialog: async () => ({ filePath: path.join(h.home, 'chosen.txt') }) },
    adapters: { download: (_remote, _source, target, { signal }) => {
      const wait = deferred(); active.push({ wait, signal });
      if (active.length === 4) full.resolve();
      return wait.promise.then(() => { if (signal.aborted) throw new Error('Cancelled'); return target; });
    } }
  });
  await i.prepare();
  const pending = [i.invoke('downloadFile', 'host/b', '/remote/report.txt'), i.invoke('downloadFile', 'host/b', '/remote/report.txt'),
    i.invoke('localFilesDownload', 'host/a', 'a', '/remote/report.txt'), i.invoke('localFilesDownload', 'host/a', 'a', '/remote/report.txt')];
  const settled = Promise.allSettled(pending);
  await full.promise;
  const upload = () => i.invoke('upload', 'host/a', [path.join(h.home, 'marker.txt')]);
  await assert.rejects(upload(), /limit four/);
  i.invoke('cancelTransfer', i.events[0].id);
  assert.deepEqual(active.map(({ signal }) => signal.aborted), [true, false, false, false]);
  await assert.rejects(upload(), /limit four/);
  i.operations.cancelProfile('host');
  assert.ok(active.every(({ signal }) => signal.aborted));
  for (const { wait } of active) wait.resolve();
  assert.ok((await settled).every(result => result.status === 'rejected' && result.reason.message === 'Cancelled'));
  assert.equal(i.events.filter(event => event.status === 'finished').length, 4);
  assert.deepEqual(await upload(), ['copied']);
});
test('drag payloads cannot cross panes, replay a stale listing, carry controls or imply a move', () => {
  const scope = { key: 'host/a', browserId: 'browser', localEpoch: 2, remoteEpoch: 3 }, base = { key: 'host/a', browserId: 'browser', side: 'local', path: 'C:\\fixture.txt', epoch: 2 };
  assert.equal(parseDrag(JSON.stringify(base), scope, 'remote').path, base.path); assert.equal(parseDrag(JSON.stringify(base), scope, 'local'), null);
  for (const value of [{ ...base, key: 'host/b' }, { ...base, browserId: 'old' }, { ...base, epoch: 1 }, { ...base, path: '/bad\nname' }, { ...base, side: 'move' }, null]) assert.throws(() => parseDrag(JSON.stringify(value), scope, 'remote'));
  assert.throws(() => parseDrag('x'.repeat(5001), scope, 'remote')); assert.throws(() => parseDrag('{', scope, 'remote'));
});
test('hiding or disconnecting a local panel invalidates pending responses and reopens with a fresh list', async () => {
  const elements = new Map(); for (const name of ['home','up','refresh','browse','path','go','status','list','upload','download','panel']) elements.set(name, { children: [], value: '', disabled: false, replaceChildren() { this.children = []; }, addEventListener() {} });
  const remotePanel = { addEventListener() {} }, drawer = { querySelector: selector => selector === '.file-remote' ? remotePanel : elements.get(selector.match(/data-local="(.*?)"/)?.[1]) || null };
  const requests = [], api = { localFilesList: () => { const wait = deferred(); requests.push(wait); return wait.promise; } };
  const model = new BrowserState({}, { key: 'host/a', profileId: 'host', browserId: 'browser' }); model.connected = model.visible = true;
  const view = attach({ api, model, drawer, error() {} }); view.changed(); assert.equal(requests.length, 1);
  model.visible = false; view.changed(); requests[0].resolve({ directory: '/old', entries: [] }); await tick(); assert.equal(elements.get('path').value, '');
  model.visible = true; view.changed(); assert.equal(requests.length, 2); requests[1].resolve({ directory: '/new', parent: '/new', entries: [] }); await tick(); assert.equal(elements.get('path').value, '/new');
  model.connected = false; view.changed(); assert.equal(elements.get('upload').disabled, true); view.destroy();
});
function byteSftp(bytes, operations) {
  const s = new EventEmitter(), attrs = (name, directory = false) => ({ mode: directory ? 0o040700 : 0o100600, mtime: 100, size: directory ? 0 : bytes.get(name).length, isFile: () => !directory, isDirectory: () => directory, isSymbolicLink: () => false });
  const missing = () => Object.assign(new Error('No such file'), { code: 2 });
  Object.assign(s, {
    end() { this.emit('close'); }, realpath(name, cb) { cb(null, name === '.' ? '/remote' : name); },
    lstat(name, cb) { cb(name === '/remote' || bytes.has(name) ? null : missing(), name === '/remote' ? attrs(name, true) : bytes.has(name) ? attrs(name) : undefined); },
    open(name, _flags, cb) { cb(null, Buffer.from(name)); }, fstat(handle, cb) { cb(null, attrs(handle.toString())); }, close(_handle, cb) { cb(null); },
    createReadStream(name, options) { assert.equal(options.handle.toString(), name); return Readable.from([bytes.get(name)]); },
    createWriteStream(name, options) {
      assert.equal(options.flags, 'wx'); assert.equal(bytes.has(name), false); const chunks = [];
      return new Writable({ write(chunk, _encoding, cb) { chunks.push(Buffer.from(chunk)); cb(); }, final(cb) { bytes.set(name, Buffer.concat(chunks)); cb(); } });
    },
    ext_openssh_hardlink(source, destination, cb) {
      operations.push('exclusive'); if (bytes.has(destination)) return cb(Object.assign(new Error('Already exists'), { code: 11 })); bytes.set(destination, bytes.get(source)); cb(null);
    },
    ext_openssh_rename(source, destination, cb) { operations.push('replace'); bytes.set(destination, bytes.get(source)); bytes.delete(source); cb(null); },
    unlink(name, cb) { bytes.delete(name); cb(null); }
  }); return s;
}
test('copy arrows stream exact Unicode/binary bytes and keep exclusive publication/no local overwrite', async t => {
  const h = await fixture(t), binary = Buffer.from([0, 255, 13, 10, 1, 128]), content = Buffer.concat([Buffer.from('SFTP 😀\n'), binary]);
  await fs.writeFile(path.join(h.home, 'marker.txt'), content);
  const bytes = new Map([['/remote/report.txt', content]]), operations = [];
  h.remote.sftp = async () => byteSftp(bytes, operations);
  const i = install(h, { adapters: { upload, download } });
  await i.prepare();
  await i.invoke('localFilesUpload', 'host/a', 'a', path.join(h.home, 'marker.txt'), '/remote');
  assert.deepEqual(bytes.get('/remote/marker.txt'), content); assert.deepEqual(operations, ['exclusive']); assert.equal([...bytes.keys()].some(name => name.includes('.part')), false);
  await i.invoke('localFilesDownload', 'host/a', 'a', '/remote/report.txt'); assert.deepEqual(await fs.readFile(path.join(h.home, 'report.txt')), content);
  await assert.rejects(i.invoke('localFilesDownload', 'host/a', 'a', '/remote/report.txt'), /No file was overwritten/);
  assert.deepEqual(await fs.readFile(path.join(h.home, 'report.txt')), content);
  assert.equal(i.events.filter(event => event.status === 'finished').length, 3);
  assert.equal((await fs.readdir(h.home)).some(name => name.startsWith('.nerdsshell-download-')), false);
});
test('local arrow upload cancellation at the existing remote-file prompt preserves its old bytes', async t => {
  const h = await fixture(t);
  const bytes = new Map([['/remote/marker.txt', Buffer.from('keep existing')]]), operations = [];
  h.remote.sftp = async () => byteSftp(bytes, operations);
  const prompts = [], i = install(h, { adapters: { upload }, confirm: async title => { prompts.push(title); return title === 'Upload files'; } });
  await i.prepare();
  assert.deepEqual(await i.invoke('localFilesUpload', 'host/a', 'a', path.join(h.home, 'marker.txt'), '/remote'), []);
  assert.deepEqual(prompts, ['Upload files', 'Replace existing remote file?']);
  assert.equal(bytes.get('/remote/marker.txt').toString(), 'keep existing'); assert.deepEqual(operations, []);
});
