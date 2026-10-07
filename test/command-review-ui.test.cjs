'use strict';
// Exercises the actual renderer controller with synthetic DOM/IPC; native acceptance is separate.
const test = require('node:test'), assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs');
const reviewHelpers = require('../ui/command-review.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function harness() {
  class Element {
    constructor(tag = 'div') { this.tag = tag; this.value = ''; this.textContent = ''; this.children = []; this.hidden = false; this.disabled = false; this.open = false; this.dataset = {}; this.listeners = {}; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; this.value = nodes[0]?.value || ''; }
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    dispatch(name) { this['on'+name]?.({}); for (const fn of this.listeners[name] || []) fn({ preventDefault() {} }); }
    showModal() { this.open = true; }
    close() { this.open = false; setImmediate(() => this.dispatch('close')); }
    focus() {} scrollIntoView() {} setAttribute() {}
    querySelectorAll() { return this.children.flatMap(c => [c, ...c.querySelectorAll()]).filter(c => c.tag === 'button'); }
  }
  const nodes = new Map(), $ = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const cancelled = [], reviewed = [], runs = [], copies = []; let listener, reviewResponse, runResponse = async () => null;
  const api = {
    workbenchContext: async () => ({ targets: [{ id: 'a', title: 'REMOTE A', local: false }, { id: 'b', title: 'REMOTE B', local: false }], preferences: { favorites: [] } }),
    workbenchActions: async () => ({ actions: [], platform: { system: 'Linux' } }),
    workbenchReview: async (id, request) => { reviewed.push({ id, ...request }); const result = { ...request, token: 'review-'+reviewed.length, destination: id, title: 'Command', persistence: 'Persistent', note: '', warnings: [], confirmWord: '' }; return reviewResponse ? reviewResponse(result) : result; },
    workbenchCancelReview: async token => { cancelled.push(token); },
    workbenchRun: async (...args) => { runs.push(args); return runResponse(...args); },
    copy: async text => { copies.push(text); }, workbenchDiagnostics: async () => ({ note: 'synthetic diagnostics' }),
    onEvent: fn => { listener = fn; }
  };
  const context = vm.createContext({ $, api, profiles: new Map(), panes: new Map(), views: new Map(), statuses: new Map(), active: '',
    openPane: async () => {}, render() {}, element: (tag, cls, text) => { const e = new Element(tag); e.textContent = text; return e; },
    button: (text, action) => { const e = new Element('button'); e.textContent = text; e.onclick = action; return e; },
    message() {}, run: promise => Promise.resolve(promise), TextEncoder, NerdSSHellCommandReview: reviewHelpers,
    document: { addEventListener() {}, querySelector: () => [...nodes.values()].find(n => n.open) }, window: {} });
  context.maxOpenViews = require('../src/session-limits.cjs').MAX_OPEN_VIEWS;
  context.pendingViewSlots = 0;
  const appSource = fs.readFileSync(require.resolve('../ui/app.js'), 'utf8'), guardStart = appSource.indexOf('function requireViewCapacity(');
  vm.runInContext(appSource.slice(guardStart, appSource.indexOf('\nconst activeTransfers', guardStart)), context);
  vm.runInContext(fs.readFileSync(require.resolve('../ui/workbench.js'), 'utf8'), context);
  return { $, api, cancelled, reviewed, runs, copies, context, ui: context.window.NerdSSHellWorkbench,
    event: e => listener(e), setReview(fn) { reviewResponse = fn; }, setRun(fn) { runResponse = fn; } };
}
async function ready(h) { await h.ui.open({ target: 'a' }); h.$('wbCode').value = 'printf synthetic'; h.$('wbCode').dispatch('input'); }

test('workbench refuses to create hidden work when retained offline tabs exhaust the renderer budget', async () => {
  const h = harness(); await ready(h); await h.$('wbReview').onclick();
  for (let i = 0; i < h.context.maxOpenViews; i++) h.context.views.set('offline/' + i, { ready: false });
  let localLaunches = 0; h.api.localOpen = async () => { localLaunches++; return null; };
  await h.$('wbRun').onclick();
  assert.equal(h.runs.length, 0); assert.ok(h.cancelled.includes('review-1'), 'Blocked review authorization is revoked');
  assert.match(h.$('wbFeedback').textContent, /64 open terminal views/);
  await h.$('wbOpenLocal').onclick(); await h.$('wbOpenFolder').onclick();
  assert.equal(localLaunches, 0); assert.equal(h.context.views.size, h.context.maxOpenViews);
});

test('renderer review preserves exact code/target, performs no run and edits revoke the ticket', async () => {
  const h = harness(); await ready(h); await h.$('wbReview').onclick();
  assert.equal(h.runs.length, 0); assert.match(h.$('wbReviewText').textContent, /printf synthetic/); assert.equal(h.reviewed[0].id, 'a');
  h.$('wbCode').value = 'printf edited'; h.$('wbCode').dispatch('input');
  assert.equal(h.$('wbRun').disabled, true); assert.ok(h.cancelled.includes('review-1'));
});
test('late review response after an edit is cancelled and cannot restore Run', async () => {
  const h = harness(), d = deferred(); await ready(h); h.setReview(async r => { await d.promise; return r; });
  const pending = h.$('wbReview').onclick(); h.$('wbCode').dispatch('input'); d.resolve(); await pending;
  assert.equal(h.$('wbRun').disabled, true); assert.ok(h.cancelled.includes('review-1'));
});
test('switching targets rejects a late review rather than applying it to the new selection', async () => {
  const h = harness(), d = deferred(); await ready(h); h.setReview(async r => { await d.promise; return r; });
  const pending = h.$('wbReview').onclick(); h.$('wbTarget').value = 'b'; h.$('wbTarget').dispatch('change'); d.resolve(); await pending; await tick();
  assert.equal(h.$('wbRun').disabled, true); assert.equal(h.$('wbCode').value, 'printf synthetic'); assert.ok(h.cancelled.includes('review-1'));
});
test('disconnect invalidates a completed review, including a rapid reconnect', async () => {
  const h = harness(); await ready(h); await h.$('wbReview').onclick();
  h.event({ type: 'status', profileId: 'a', state: 'disconnected' }); h.event({ type: 'status', profileId: 'a', state: 'connected' });
  assert.equal(h.$('wbRun').disabled, true); assert.ok(h.cancelled.includes('review-1')); assert.equal(h.runs.length, 0);
});
test('disconnect invalidates a not-yet-returned review, but another target disconnect does not', async () => {
  const h = harness(), d = deferred(); await ready(h); h.setReview(async r => { await d.promise; return r; });
  const pending = h.$('wbReview').onclick(); h.event({ type: 'status', profileId: 'a', state: 'connecting' }); d.resolve(); await pending;
  assert.ok(h.cancelled.includes('review-1')); assert.equal(h.$('wbRun').disabled, true);
  h.setReview(null); await h.$('wbReview').onclick(); h.event({ type: 'status', profileId: 'b', state: 'disconnected' });
  assert.equal(h.$('wbRun').disabled, false);
});
test('disconnect cancels a running native confirmation and double click cannot start another', async () => {
  const h = harness(), d = deferred(); await ready(h); await h.$('wbReview').onclick(); h.setRun(() => d.promise);
  const pending = h.$('wbRun').onclick(); await h.$('wbRun').onclick();
  assert.equal(h.runs.length, 1); assert.equal(h.$('wbCode').readOnly, true);
  h.event({ type: 'status', profileId: 'a', state: 'disconnected' }); assert.ok(h.cancelled.includes('review-1'));
  d.resolve(null); await pending; assert.equal(h.$('wbRun').disabled, true);
});
test('chat block selection stages exactly one block and revokes earlier approval without running', async () => {
  const h = harness(); await ready(h); await h.$('wbReview').onclick();
  h.$('wbChat').value = '```sh\nprintf one\n```\ntext\n```powershell\nWrite-Output two\n```'; h.$('wbImport').onclick();
  h.$('wbBlocks').value = '1'; h.$('wbBlocks').dispatch('change');
  assert.equal(h.$('wbCode').value, 'Write-Output two'); assert.equal(h.runs.length, 0); assert.equal(h.$('wbRun').disabled, true);
  assert.ok(h.cancelled.includes('review-1'));
});
test('closing or clearing command review revokes its token', async () => {
  for (const close of [true, false]) {
    const h = harness(); await ready(h); await h.$('wbReview').onclick(); h.$(close ? 'wbClose' : 'wbClear').onclick();
    assert.ok(h.cancelled.includes('review-1')); assert.equal(h.$('wbRun').disabled, true);
    if (!close) assert.equal(h.$('wbCode').value, '');
  }
});

test('Escape revokes approval synchronously before the browser queues close', async () => {
  const h = harness(); await ready(h); await h.$('wbReview').onclick();
  h.$('workbenchDialog').dispatch('cancel');
  assert.equal(h.$('wbRun').disabled, true); assert.ok(h.cancelled.includes('review-1'));
});
test('late close event from an old dialog does not revoke a reopened review', async () => {
  const h = harness(); await ready(h); await h.$('wbReview').onclick(); h.$('wbClose').onclick();
  await ready(h); await h.$('wbReview').onclick(); await tick();
  assert.equal(h.$('workbenchDialog').open, true); assert.equal(h.$('wbRun').disabled, false);
  assert.ok(!h.cancelled.includes('review-2'));
});

test('queued close from the previous dialog cannot cancel reopen while destination IPC is pending', async () => {
  const h = harness(); await ready(h); await h.$('wbReview').onclick();
  const context = await h.api.workbenchContext(), response = deferred();
  h.$('wbClose').onclick();
  assert.ok(h.cancelled.includes('review-1'), 'Closing must revoke the previous command synchronously');
  h.api.workbenchContext = () => response.promise;
  const reopening = h.ui.open({ target: 'b' });
  // A real IPC response need not beat HTMLDialogElement's queued close event.
  // Deliver that old event during the new request's deliberately pending await.
  await tick(); assert.equal(h.$('workbenchDialog').open, false);
  response.resolve(context); await reopening;
  assert.equal(h.$('workbenchDialog').open, true, 'The old close event must not cancel the new destination request');
  assert.equal(h.$('wbTarget').value, 'b');
  h.$('wbCode').value = 'printf reopened'; h.$('wbCode').dispatch('input'); await h.$('wbReview').onclick();
  assert.equal(h.reviewed.at(-1).id, 'b'); assert.equal(h.$('wbRun').disabled, false);
  assert.ok(!h.cancelled.includes('review-2'), 'The new review retains its own approval');
});

test('deliberate Close or Escape cancels a pending destination switch and revokes its prior approval', async () => {
  for (const escape of [false, true]) {
    const h = harness(); await ready(h); await h.$('wbReview').onclick();
    const context = await h.api.workbenchContext(), response = deferred(); h.api.workbenchContext = () => response.promise;
    const switching = h.ui.open({ target: 'b' });
    if (escape) { h.$('workbenchDialog').dispatch('cancel'); h.$('workbenchDialog').close(); }
    else h.$('wbClose').onclick();
    assert.ok(h.cancelled.includes('review-1')); assert.equal(h.$('wbRun').disabled, true);
    await tick(); response.resolve(context); await switching;
    assert.equal(h.$('workbenchDialog').open, false, 'A cancelled pending switch must not reopen the dialog');
    assert.equal(h.$('wbRun').disabled, true); assert.equal(h.runs.length, 0);
  }
});

test('an older hidden reopen finishing cannot clear ownership of a newer pending destination', async () => {
  const h = harness(); await ready(h); await h.$('wbReview').onclick();
  const context = await h.api.workbenchContext(), older = deferred(), latest = deferred(), requests = [older.promise, latest.promise];
  h.$('wbClose').onclick(); h.api.workbenchContext = () => requests.shift();
  const first = h.ui.open({ target: 'a' }), second = h.ui.open({ target: 'b' });
  assert.ok(h.cancelled.includes('review-1')); assert.equal(h.$('wbRun').disabled, true);
  older.resolve(context); await first;
  assert.equal(h.$('workbenchDialog').open, false, 'The superseded request must not become visible');
  // The older request's finally ran before the old dialog's queued close.
  // That close must still recognize the latest pending request's ownership.
  await tick(); latest.resolve(context); await second;
  assert.equal(h.$('workbenchDialog').open, true); assert.equal(h.$('wbTarget').value, 'b');
  assert.equal(h.$('wbCode').value, ''); assert.equal(h.$('wbRun').disabled, true); assert.equal(h.runs.length, 0);
  h.$('wbCode').value = 'printf latest'; h.$('wbCode').dispatch('input'); await h.$('wbReview').onclick();
  assert.deepEqual(h.reviewed.map(item => item.id), ['a', 'b']); assert.equal(h.$('wbRun').disabled, false);
  assert.ok(!h.cancelled.includes('review-2')); assert.equal(h.runs.length, 0);
});

test('failed hidden reopen releases its close guard and permits a fresh destination without old approval', async () => {
  const h = harness(); await ready(h); await h.$('wbReview').onclick();
  const context = await h.api.workbenchContext(), notices = []; let rejectContext;
  const response = new Promise((_resolve, reject) => { rejectContext = reject; });
  h.context.message = text => notices.push(text);
  h.$('workbenchDialog').close(); h.api.workbenchContext = () => response;
  const reopening = h.ui.open({ target: 'b' });
  assert.ok(h.cancelled.includes('review-1'), 'A hidden reopen must immediately revoke the previous approval');
  rejectContext(new Error('Synthetic destination IPC failure')); await reopening;
  assert.deepEqual(notices, ['Synthetic destination IPC failure']); assert.equal(h.$('workbenchDialog').open, false); assert.equal(h.$('wbRun').disabled, true);
  // After a failed request, ordinary native close cleanup must run again.
  h.$('wbTypedHost').value = 'stale confirmation'; await tick(); assert.equal(h.$('wbTypedHost').value, '');
  h.api.workbenchContext = async () => context; await h.ui.open({ target: 'b' });
  assert.equal(h.$('workbenchDialog').open, true); assert.equal(h.$('wbTarget').value, 'b'); assert.equal(h.$('wbCode').value, '');
  assert.equal(h.$('wbRun').disabled, true); assert.equal(h.runs.length, 0);
  h.$('wbCode').value = 'printf fresh'; h.$('wbCode').dispatch('input'); await h.$('wbReview').onclick();
  assert.equal(h.reviewed.at(-1).id, 'b'); assert.equal(h.$('wbRun').disabled, false); assert.equal(h.runs.length, 0);
});

test('action search understands Windows terminology without executing a template', async () => {
  const h=harness(); h.api.workbenchActions=async()=>({platform:{system:'Linux'},actions:[
    {id:'system.processes',title:'Running processes',description:'Inspect',group:'System',keywords:'task manager cpu',risk:'info',enabled:true},
    {id:'system.reboot',title:'Restart',description:'Reboot',group:'System',risk:'disruptive',enabled:true}
  ]});
  await ready(h);h.$('wbSearch').value='task manager';h.$('wbSearch').dispatch('input');
  const choices=h.$('wbActionList').querySelectorAll().filter(x=>x.textContent==='Running processes');
  assert.equal(choices.length,1);assert.equal(h.$('wbActionList').children.length,1);
  assert.equal(h.runs.length,0);assert.equal(h.reviewed.length,0);
});
test('workbench favorites revoke review and open explicit per-OS configuration without implicit writes',async()=>{
  const h=harness(),writes=[];let configured=0;
  h.api.workbenchActions=async()=>({platform:{system:'Linux'},actions:[
    {id:'system.info',title:'Info',description:'Inspect',group:'System',risk:'info',enabled:true},
    {id:'system.disk',title:'Disk',description:'Inspect',group:'System',risk:'info',enabled:true}
  ]});
  h.api.workbenchPreferences=async p=>{writes.push([...p.favorites]);return p;};
  h.context.window.NerdSSHellPanes={configure(){configured++;}};
  await ready(h);await h.$('wbReview').onclick();
  h.$('wbActionList').children[0].children[1].onclick();
  assert.equal(configured,1);assert.equal(h.$('workbenchDialog').open,false);
  assert.ok(h.cancelled.includes('review-1'));assert.deepEqual(writes,[]);assert.equal(h.runs.length,0);
});

test('selecting a pane recipe automatically reviews exact code and captured pane without running it',async()=>{
  const h=harness(),templates=[];
  h.api.workbenchActions=async(id,key)=>{assert.equal(id,'a');assert.equal(key,'a/source');return {platform:{system:'Linux'},actions:[{id:'system.info',title:'Info',description:'Inspect',group:'System',risk:'info',enabled:true}]};};
  h.api.workbenchTemplate=async(...args)=>{templates.push(args);return {code:'printf exact',description:'Inspect'};};
  await h.ui.open({target:'a',key:'a/source',actionId:'system.info',review:true});
  assert.deepEqual(templates[0],['a','system.info','','a/source']);
  assert.equal(h.reviewed.length,1);assert.equal(h.reviewed[0].key,'a/source');assert.equal(h.reviewed[0].actionId,'system.info');assert.equal(h.reviewed[0].code,'printf exact');
  assert.equal(h.$('wbTarget').disabled,true);assert.equal(h.$('wbReviewDetails').hidden,false);assert.equal(h.runs.length,0);
});
test('failed pane template selection never reviews a previously staged command',async()=>{
  const h=harness();await ready(h);
  h.api.workbenchActions=async()=>({platform:{system:'Linux'},actions:[{id:'services.restart',title:'Restart service',description:'Changes state',group:'Services',risk:'disruptive',argument:'service',enabled:true}]});
  h.api.workbenchTemplate=async()=>{throw Error('Enter a service name');};
  await h.ui.open({target:'a',key:'a/source',actionId:'services.restart',review:true});
  assert.equal(h.$('wbCode').value,'');assert.equal(h.reviewed.length,0);assert.equal(h.runs.length,0);assert.equal(h.$('wbRun').disabled,true);
  assert.match(h.$('wbFeedback').textContent,/service name/);
});
test('unavailable action reason is visible text, not only a disabled-button tooltip',async()=>{
  const h=harness();h.api.workbenchActions=async()=>({platform:{system:'unknown'},actions:[
    {id:'system.info',title:'Info',description:'Inspect',group:'System',risk:'info',enabled:false,reason:'Detect this host first'}
  ]});await ready(h);const row=h.$('wbActionList').children[0];
  assert.equal(row.children[0].disabled,true);assert.match(row.children[0].children[0].textContent,/Detect this host first/);
});

test('diagnostic preview is editable and only explicitly reviewed text is copied',async()=>{
 const h=harness();await h.$('wbDiagnostics').onclick();assert.equal(h.copies.length,0);assert.equal(h.$('wbDiagnosticsText').readOnly,false);
 h.$('wbDiagnosticsText').value='redacted by user';await h.$('wbDiagnosticsCopy').onclick();assert.deepEqual(h.copies,['redacted by user']);
 h.$('wbDiagnosticsClose').onclick();assert.equal(h.$('wbDiagnosticsText').value,'');assert.equal(h.$('wbDiagnosticsCopy').disabled,true);
 await h.$('wbDiagnosticsCopy').onclick();assert.equal(h.copies.length,1);
});
test('closing during diagnostic loading discards late sensitive results',async()=>{
 const h=harness(),d=deferred();h.api.workbenchDiagnostics=()=>d.promise;
 const pending=h.$('wbDiagnostics').onclick();assert.equal(h.$('wbDiagnosticsText').readOnly,true);
 h.$('wbDiagnosticsClose').onclick();d.resolve({host:'late.example'});await pending;
 assert.equal(h.$('wbDiagnosticsDialog').open,false);assert.equal(h.$('wbDiagnosticsText').value,'');assert.equal(h.copies.length,0);
});
test('old diagnostic responses do not replace a reopened edited preview',async()=>{
 const h=harness(),d=deferred();h.api.workbenchDiagnostics=()=>d.promise;const old=h.$('wbDiagnostics').onclick();
 h.$('wbDiagnosticsClose').onclick();h.api.workbenchDiagnostics=async()=>({host:'new.example'});await h.$('wbDiagnostics').onclick();
 h.$('wbDiagnosticsText').value='my redactions';d.resolve({host:'old.example'});await old;await tick();
 assert.equal(h.$('wbDiagnosticsText').value,'my redactions');assert.equal(h.$('wbDiagnosticsCopy').disabled,false);
});
test('output preview captures its own endpoint and does not follow later active-pane changes',async()=>{
 const h=harness();const v={pane:{profileId:'a',sessionName:'Synthetic'},terminal:{buffer:{active:{type:'normal',length:1,getLine:()=>({isWrapped:false,translateToString:()=> 'synthetic output'})}}}};
 h.context.views.set('a/view',v);h.context.profiles.set('a',{name:'A',host:'a.example',username:'tester'});h.context.active='a/view';
 await h.$('wbCopyOutput').onclick();h.context.active='different';const text=h.$('wbDiagnosticsText').value;
 assert.match(text,/a\.example/);assert.match(text,/1 rows/);assert.match(text,/synthetic output/);assert.equal(h.copies.length,0);
});
test('oversized edited preview does not replace the clipboard',async()=>{
 const h=harness();await h.$('wbDiagnostics').onclick();h.$('wbDiagnosticsText').value='x'.repeat(524289);
 await assert.rejects(h.$('wbDiagnosticsCopy').onclick(),/512 KiB/);assert.equal(h.copies.length,0);
});
