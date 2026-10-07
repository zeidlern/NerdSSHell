'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { installWorkbench, preferences } = require('../src/workbench.cjs');
const { LocalRemote, installedShells, launchArguments, NATIVE_HASHES, verifyNativePty } = require('../src/local-remote.cjs');
const { extractBlocks, selectionText } = require('../ui/command-review.js');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const fixtureShell = { id: 'local:powershell', name: 'Windows PowerShell', executable: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' };
function harness() {
  const handlers = {}, calls = [], events = [], messages = [];
  const profile = { id: 'a', name: 'Alpha', host: 'alpha.example', username: 'tester', port:22, sessionMode:'persistent' };
  const remote = { connected:true, closing:false, views:new Map([['a/pane',{active:true,inputSerial:0}]]), shells:new Map(),
    checked: async (...args) => { calls.push(['checked',...args]); return 'system:Linux\nID=ubuntu\ncap:apt\ncap:systemctl\ncap:systemd\ncap:journalctl\ncap:sudo\ncap:shutdown'; },
    createTask: async (name, code) => { calls.push(['task',name,code]); return { key:'a/task',profileId:'a',sessionName:name }; } };
  const connections = new Map([['a', {profile,remote,state:'connected'}]]), store = {data:{},save(){calls.push(['save']);}};
  let confirmation = async options => { messages.push(options); return {response:0}; };
  const workbench = installWorkbench({ handle:(n,fn)=>{handlers[n]=fn;}, connections, getStore:()=>store,
    app:{isPackaged:false,getVersion:()=> 'test'}, dialog:{showMessageBox:(...args)=>confirmation(args[1]),showOpenDialog:async()=>({canceled:true})},getWindow:()=>({}),
    emit:(type,data)=>events.push({type,...data}),queueOutput(){},discardOutput(){},output:{flush(){}},
    forKey:key=>{const r=connections.get(key.split('/')[0]); if(!r?.remote.connected||!r.remote.views.has(key))throw Error('Unknown view');return r;},
    shellProvider:()=>[fixtureShell], localFactory:()=>{throw Error('A remote test must never spawn a local process');} });
  return { handlers,connections,remote,calls,events,messages,store,workbench,setConfirmation(fn){confirmation=fn;} };
}
test('workbench is discovery-only until explicit Detect; no remote commands on opening',()=>{const h=harness();const c=h.handlers.workbenchContext();assert.equal(c.targets.length,2);assert.ok(h.handlers.workbenchActions('a').actions.every(a=>!a.enabled));assert.deepEqual(h.calls,[]);});
test('platform inspection uses a separate bounded exec and caches only on that connection',async()=>{const h=harness();await h.handlers.workbenchDetect('a');const cmd=h.calls[0];assert.equal(cmd[0],'checked');assert.match(cmd[1],/uname/);assert.equal(cmd[2].maxBytes,16384);assert.equal(cmd[2].timeout,10000);assert.ok(h.handlers.workbenchActions('a').actions.some(a=>a.enabled));h.connections.get('a').remote={...h.remote};assert.ok(h.handlers.workbenchActions('a').actions.every(a=>!a.enabled));});
test('late platform response cannot populate a replacement connection',async()=>{const h=harness(),d=deferred();h.remote.checked=()=>d.promise;const p=h.handlers.workbenchDetect('a');h.connections.get('a').remote={...h.remote};d.resolve('system:Linux\ncap:apt');await assert.rejects(p,/changed/);});
test('review performs no command; accepted execution uses a new task not existing input',async()=>{const h=harness();const r=h.handlers.workbenchReview('a',{code:'printf hello'});assert.deepEqual(h.calls,[]);const result=await h.handlers.workbenchRun(r.token);assert.equal(result.pane.key,'a/task');assert.equal(h.calls[0][0],'task');assert.equal(h.calls[0][2],'printf hello');assert.match(h.messages[0].message,/alpha.example/);await assert.rejects(h.handlers.workbenchRun(r.token),/already used/);});
test('native confirmation cancellation creates nothing and consumes the review',async()=>{const h=harness();h.setConfirmation(async()=>({response:1}));const r=h.handlers.workbenchReview('a',{code:'echo hello'});assert.equal(await h.handlers.workbenchRun(r.token),null);assert.deepEqual(h.calls,[]);await assert.rejects(h.handlers.workbenchRun(r.token));});
test('changing remote connection during native confirmation prevents execution',async()=>{const h=harness(),d=deferred();h.setConfirmation(()=>d.promise);const r=h.handlers.workbenchReview('a',{code:'echo hello'});const pending=h.handlers.workbenchRun(r.token);h.connections.get('a').remote={...h.remote};d.resolve({response:0});await assert.rejects(pending,/changed/);assert.deepEqual(h.calls,[]);});
test('changing active connection elsewhere does not redirect reviewed command',async()=>{const h=harness();const r=h.handlers.workbenchReview('a',{code:'echo hello'});h.connections.set('b',{profile:{id:'b'},remote:{connected:true,views:new Map(),createTask(){throw Error('Wrong target');}}});await h.handlers.workbenchRun(r.token);assert.equal(h.calls[0][2],'echo hello');});
test('disruptive built-ins require exact host and edited templates cannot masquerade as built-ins',async()=>{const h=harness();await h.handlers.workbenchDetect('a');const template=h.handlers.workbenchTemplate('a','system.reboot');assert.throws(()=>h.handlers.workbenchReview('a',{code:'rm something',actionId:'system.reboot'}),/edited/);const r=h.handlers.workbenchReview('a',{code:template.code,actionId:'system.reboot'});assert.equal(r.confirmWord,'alpha.example');await assert.rejects(h.handlers.workbenchRun(r.token,'Alpha'),/exact remote hostname/);assert.equal(h.messages.length,0);});
test('disconnect cancels pending reviews and input locks',async()=>{const h=harness();const r=h.handlers.workbenchReview('a',{code:'echo hello'});h.handlers.inputLock('a/pane',true);h.workbench.disconnect('a');assert.doesNotThrow(()=>h.workbench.assertInput('a/pane'));await assert.rejects(h.handlers.workbenchRun(r.token));});
test('input lock invalidates pending submissions, blocks the backend and not a sibling',()=>{const h=harness();h.remote.views.set('a/other',{active:true});const record={serial:0};h.remote.shells.set('a/pane',record);h.handlers.inputLock('a/pane',true);assert.equal(record.serial,1);assert.equal(h.remote.views.get('a/pane').inputSerial,1);assert.throws(()=>h.workbench.assertInput('a/pane'),/locked/);h.workbench.assertInput('a/other');h.handlers.inputLock('a/pane',false);h.workbench.assertInput('a/pane');});
test('an input lock cannot attach itself to a replacement view',()=>{const h=harness();h.handlers.inputLock('a/pane',true);h.remote.views.set('a/pane',{active:true});assert.doesNotThrow(()=>h.workbench.assertInput('a/pane'));});
test('favorites are limited, persisted, and contain no user script text',()=>{const h=harness();assert.deepEqual(h.handlers.workbenchPreferences({favorites:['system.disk'],script:'secret'}),{favorites:['system.disk']});assert.deepEqual(h.store.data.workbench,{favorites:['system.disk']});assert.throws(()=>preferences({favorites:['unknown']}));assert.throws(()=>preferences({favorites:Array(4).fill('system.disk')}));});
test('diagnostics bound their events and never include command or credential bodies',()=>{const h=harness();for(let i=0;i<150;i++)h.workbench.observe('status',{state:'connected',profileId:'a',detail:'SYNTHETIC_SECRET'});h.handlers.workbenchReview('a',{code:'echo COMMAND_SECRET'});const d=h.handlers.workbenchDiagnostics();assert.equal(d.events.length,100);assert.doesNotMatch(JSON.stringify(d),/SYNTHETIC_SECRET|COMMAND_SECRET/);assert.equal(d.connections[0].host,'alpha.example');});
test('local shell discovery never searches PATH or accepts arbitrary profile executables',()=>{const s=installedShells({platform:'win32',env:{SystemRoot:'C:\\Windows',ProgramFiles:'C:\\Program Files',PATH:'D:\\Untrusted'},exists:()=>true});assert.equal(s.length,3);assert.equal(s[2].id,'local:cmd');assert.match(s[2].executable,/System32\\cmd\.exe$/);assert.match(s[0].executable,/WindowsPowerShell/);assert.match(s[1].executable,/PowerShell\\7\\pwsh.exe/);assert.deepEqual(installedShells({platform:'linux'}),[]);});
test('local task arguments preserve UTF16 after the fixed syntax bootstrap and do not bypass policy or elevate',()=>{const args=launchArguments("Write-Output 'こんにちは 😀'");assert.deepEqual(args.slice(0,3),['-NoLogo','-NoProfile','-NoExit']);assert.equal(Buffer.from(args[4],'base64').toString('utf16le'),require('../src/local-powershell.cjs').syntaxBootstrap()+"Write-Output 'こんにちは 😀'");assert.doesNotMatch(args.join(' '),/ExecutionPolicy|RunAs/);assert.throws(()=>launchArguments('a'.repeat(8193)));});
class FakePty {
  constructor(){this.events=new EventEmitter();this.writes=[];this.pauses=0;this.resumes=0;this.kills=0;this.sizes=[];}
  onData(fn){this.events.on('data',fn);return{dispose:()=>this.events.off('data',fn)};}
  onExit(fn){this.events.on('exit',fn);return{dispose:()=>this.events.off('exit',fn)};}
  write(s){this.writes.push(s);}pause(){this.pauses++;}resume(){this.resumes++;}kill(){this.kills++;}resize(c,r){this.sizes.push([c,r]);}
}
async function localFixture(t) {
  const ptys=[],spawns=[];const r=new LocalRemote(fixtureShell,{home:os.tmpdir(),spawn:(...args)=>{spawns.push(args);const p=new FakePty();ptys.push(p);return p;}});
  await r.connect();t.after(()=>r.disconnect());const pane=await r.create('Test');await r.open(pane.key);return {r,pane,ptys,spawns};
}
test('local console uses ConPTY DLL mode with ordered native Unicode input',async t=>{const {r,pane,ptys,spawns}=await localFixture(t);assert.equal(pane.local,true);assert.equal(spawns[0][2].useConptyDll,true);assert.equal(spawns[0][2].useConpty,true);assert.equal(r.profile.record,false);const text='😀'.repeat(9000);await Promise.all([r.input(pane.key,text),r.input(pane.key,'\r')]);assert.deepEqual(ptys[0].writes,[text,'\r']);await r.resize(pane.key,130,40);assert.deepEqual(ptys[0].sizes,[[130,40]]);});
test('closing a local console closes only its PTY and discards queued input',async t=>{const {r,pane,ptys}=await localFixture(t);const other=await r.create('Other');await r.open(other.key);r.closeView(pane.key);assert.equal(ptys[0].kills,1);assert.equal(ptys[1].kills,0);await assert.rejects(r.input(pane.key,'echo wrong'));});
test('natural local exit drains output and is not killed or resurrected',async t=>{const {r,pane,ptys}=await localFixture(t);const seen=[];r.on('output',(_key,b)=>seen.push(b.toString()));ptys[0].events.emit('data','final output');ptys[0].events.emit('exit',{});await tick();await tick();assert.equal(seen.join(''),'final output');assert.equal(ptys[0].kills,0);await assert.rejects(r.open(pane.key));});
test('local output backpressure pauses only its PTY and resumes on acknowledgement',async t=>{const {r,pane,ptys}=await localFixture(t);r.setOutputPaused(pane.key,true);ptys[0].events.emit('data','a'.repeat(131072));assert.ok(ptys[0].pauses>0);r.setOutputPaused(pane.key,false);await tick();assert.ok(ptys[0].resumes>0);});
test('local native components fail closed when absent or tampered',t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'betterssh-integrity-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));for(const relative of Object.keys(NATIVE_HASHES)){const f=path.join(dir,relative);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,'synthetic corrupt');}assert.throws(()=>verifyNativePty(dir),/integrity/);assert.equal(Object.keys(NATIVE_HASHES).length,3);});
test('local command size, input rate and terminal count stay bounded',async t=>{const {r,pane}=await localFixture(t);await assert.rejects(r.input(pane.key,'x'.repeat(65537)),/64 KiB/);for(let i=0;i<4;i++)await r.input(pane.key,'x'.repeat(65536));await assert.rejects(r.input(pane.key,'x'),/rate limit/);});
test('chat extraction returns independent blocks with exact content and no automatic execution',()=>{const s="Instructions\n```powershell\nGet-Process\n```\nNow remote\n```bash\nsudo apt update\n```";assert.deepEqual(extractBlocks(s),[{language:'powershell',code:'Get-Process'},{language:'bash',code:'sudo apt update'}]);assert.equal(extractBlocks('ordinary prose').length,0);assert.equal(extractBlocks('```sh\n$ echo hi\n```')[0].code,'$ echo hi');});
test('chat extraction rejects incomplete, excessive and oversized messages',()=>{assert.throws(()=>extractBlocks('```sh\necho hello'),/incomplete/);assert.throws(()=>extractBlocks('a'.repeat(65537)),/64 KiB/);assert.throws(()=>extractBlocks('```\necho hi\n```\n'.repeat(33)),/Too many/);});
test('copyable output joins soft wraps without inventing command boundaries',()=>{const rows=[['hello ',false],['world',true],['next',false]];const term={buffer:{active:{length:3,getLine:i=>({translateToString:()=>rows[i][0],isWrapped:rows[i][1]})}}};assert.equal(selectionText(term),'hello world\nnext');assert.equal(selectionText(term,1),'next');});
test('workbench renderer resources are allowlisted, backend command catalog is not',()=>{const {assetPath}=require('../src/app-protocol.cjs');assert.ok(assetPath('betterssh://app/ui/workbench.js',undefined,'/app'));assert.equal(assetPath('betterssh://app/src/action-catalog.cjs',undefined,'/app'),null);});

test('failed reinspection discards old platform capabilities instead of keeping stale update recipes',async()=>{
 const h=harness();await h.handlers.workbenchDetect('a');assert.ok(h.handlers.workbenchActions('a').actions.some(a=>a.enabled));
 h.remote.checked=async()=>{throw Error('Probe failed');};await assert.rejects(h.handlers.workbenchDetect('a'),/Probe failed/);
 assert.ok(h.handlers.workbenchActions('a').actions.every(a=>!a.enabled));
});
test('update installs require exact hostname and repeat consequences in native confirmation',async()=>{
 const h=harness();await h.handlers.workbenchDetect('a');const p=h.handlers.workbenchTemplate('a','updates.install');
 const r=h.handlers.workbenchReview('a',{actionId:'updates.install',code:p.code});assert.equal(r.confirmWord,'alpha.example');
 await assert.rejects(h.handlers.workbenchRun(r.token,'Alpha'),/exact remote hostname/);assert.equal(h.messages.length,0);
 const r2=h.handlers.workbenchReview('a',{actionId:'updates.install',code:p.code});h.setConfirmation(async options=>{h.messages.push(options);return {response:1};});
 assert.equal(await h.handlers.workbenchRun(r2.token,'alpha.example'),null);assert.match(h.messages[0].detail,/interrupt SSH/);
 assert.ok(!h.calls.some(c=>c[0]==='task'));
});
