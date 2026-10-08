'use strict';
// Exact-ASAR startup offer with controlled release bytes and inert installation.
// No user profile, registry, real installer, external request or clipboard use.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),args=process.argv.slice(2),at=name=>{const n=args.indexOf(name);return n<0?undefined:args[n+1]};
const output=path.resolve(at('--output')||path.join(root,'.local','startup-update-ui'));
if(!process.versions.electron){
 (async()=>{fs.mkdirSync(output,{recursive:true});for(const scenario of ['decline','accept','bad-hash']){
  const data=fs.realpathSync.native(fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'nerdsshell-startup-ui-')));
  const child=spawn(require('electron'),[__filename,'--scenario',scenario,'--output',output,'--data',data,'--user-data-dir='+data],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>process.stdout.write(b));child.stderr.resume();
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)});
  assert.equal(fs.realpathSync.native(data),data);assert.equal(path.dirname(data).toLowerCase(),fs.realpathSync.native(os.tmpdir()).toLowerCase());assert.ok(path.basename(data).startsWith('nerdsshell-startup-ui-'));fs.rmSync(data,{recursive:true,force:true});
  if(code!==0)throw new Error('Owned startup offer acceptance failed');
 }})().catch(e=>{console.error(e.message);process.exitCode=1});
}else{
 (async()=>{
  const electron=require('electron'),{app,BrowserWindow}=electron,{createRequire,Module}=require('node:module'),vm=require('node:vm');
  const scenario=at('--scenario'),data=fs.realpathSync.native(at('--data')),physical=require('original-fs');
  assert.ok(['decline','accept','bad-hash'].includes(scenario));assert.equal(path.dirname(data).toLowerCase(),fs.realpathSync.native(os.tmpdir()).toLowerCase());assert.ok(path.basename(data).startsWith('nerdsshell-startup-ui-'));
  app.setPath('userData',data);const archive=physical.realpathSync.native(path.join(root,'dist','win-unpacked','resources','app.asar')),main=path.join(archive,'src','main.cjs'),packed=createRequire(main),metadata=packed('../package.json');
  const bytes=Buffer.from('MZowned-inert-startup-offer'),target=metadata.version.split('.').map(Number);target[2]++;const newer=target.join('.'),name='NerdSSHell-'+newer+'-x64-Setup.exe';
  const release={id:91,tag_name:'v'+newer,html_url:'https://github.com/zeidlern/NerdSSHell/releases/tag/v'+newer,draft:false,prerelease:false,published_at:'2026-10-08T12:00:00Z',assets:[{id:92,name,state:'uploaded',size:bytes.length,digest:'sha256:'+createHash('sha256').update(bytes).digest('hex'),browser_download_url:'https://github.com/zeidlern/NerdSSHell/releases/download/v'+newer+'/'+name}]};
  const calls={metadata:0,downloads:0,arm:0,release:0,cancel:0,quit:0};let quitHandler,window,plan;
  const report={scope:'Exact unmodified ASAR main/UI/preload under Windows SDK with controlled public-release transport, app/process identity and inert handoff; not actual NSIS install',scenario,runtimePid:process.pid,appVersion:metadata.version,runtime:process.versions.electron,asarSha256:createHash('sha256').update(physical.readFileSync(archive)).digest('hex'),checks:[],calls};
  fs.mkdirSync(output,{recursive:true});const persist=()=>fs.writeFileSync(path.join(output,scenario+'.json'),JSON.stringify(report,null,2)+'\n');const check=(label,value)=>{assert.equal(value,true,label);report.checks.push(label);persist();console.log(label)};
  const proxyApp=new Proxy(app,{get(object,key){if(key==='isPackaged')return true;if(key==='getVersion')return()=>metadata.version;if(key==='on')return(event,handler)=>{if(event==='before-quit'){quitHandler=handler;return proxyApp}object.on(event,handler);return proxyApp};if(key==='quit')return()=>{const event={preventDefault(){this.prevented=true}};quitHandler(event);if(!event.prevented)calls.quit++};const value=object[key];return typeof value==='function'?value.bind(object):value}});
  class HiddenWindow extends BrowserWindow{constructor(options){super({...options,show:false});window=this}}
  const api=packed('./release-updater.cjs').API_URL;
  const mockNet={...electron.net,async fetch(url,options){if(url===api){calls.metadata++;return new Response(JSON.stringify(release))}if(url===release.assets[0].browser_download_url){calls.downloads++;return new Response(scenario==='bad-hash'?Buffer.from('MZdifferent-update'):bytes)}if(String(url).startsWith('file:'))return electron.net.fetch(url,options);throw new Error('Unexpected external request')}};
  const fakeElectron={...electron,app:proxyApp,BrowserWindow:HiddenWindow,net:mockNet,dialog:{...electron.dialog,showErrorBox(_title,message){report.status='failed';report.failure='Main startup: '+message;persist()}},clipboard:{readText(){throw new Error('No clipboard use allowed')},writeText(){throw new Error('No clipboard use allowed')}}};
  const source=fs.readFileSync(main,'utf8');for(const file of ['src/main.cjs','src/release-updater.cjs','ui/app.js','ui/index.html','src/preload.cjs'])assert.ok(fs.readFileSync(path.join(archive,file)).equals(fs.readFileSync(path.join(root,file))),file);
  const shim=name=>name==='electron'?fakeElectron:name==='./update-handoff.cjs'?{async armUpdate(value){calls.arm++;plan=value;return{async release(){calls.release++},async cancel(){calls.cancel++}}}}:packed(name);shim.resolve=packed.resolve;
  const module=new Module(main);module.filename=main;module.paths=Module._nodeModulePaths(path.dirname(main));
  const fakeProcess=new Proxy(process,{get(object,key){return key==='execPath'?path.join(data,'NerdSSHell.exe'):object[key]}});
  let send,evaluate;
  try{
   vm.runInThisContext('(function(exports,require,module,__filename,__dirname,process){'+source+'\n})',{filename:main})(module.exports,shim,module,main,path.dirname(main),fakeProcess);
   for(let n=0;n<200&&!window;n++)await new Promise(r=>setTimeout(r,25));assert.ok(window);for(let n=0;n<400&&window.webContents.getURL()!=='nerdsshell://app/ui/index.html';n++)await new Promise(r=>setTimeout(r,25));window.webContents.debugger.attach('1.3');send=(method,params={})=>window.webContents.debugger.sendCommand(method,params);
   evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error('Owned UI evaluation failed');return result.result.value};
   const wait=async expression=>{for(let n=0;n<200;n++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,25))}throw new Error('Owned startup UI wait failed')};
   await send('Runtime.enable');await send('Emulation.setFocusEmulationEnabled',{enabled:true});await wait("typeof $==='function'&&$('promptDialog').open&&$('promptTitle').textContent==='NerdSSHell update available'");
   check('Startup contacts only the fixed controlled release endpoint',calls.metadata===1&&calls.downloads===0);
   check('Actual upgrade dialog has pointer-usable Upgrade and Not now with safe default focus',await evaluate("$('promptAccept').textContent==='Upgrade'&&$('cancelPrompt').textContent==='Not now'&&document.activeElement===$('cancelPrompt')&&!$('promptAccept').disabled&&!$('cancelPrompt').disabled"));
   check('Owned Windows parent remains enabled',window.isEnabled());
   const selector=scenario==='decline'?'#cancelPrompt':'#promptAccept';const point=await evaluate('(()=>{const r=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()');
   for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});await wait("!$('promptDialog').open");
   for(let n=0;n<200;n++){if(scenario==='decline'||scenario==='accept'&&calls.quit===1||scenario==='bad-hash'&&await evaluate("$('notice').textContent.includes('could not finish')"))break;await new Promise(r=>setTimeout(r,25))}
   if(scenario==='decline')check('Pointer Not now keeps app open without download or installer',calls.downloads===0&&calls.arm===0&&calls.quit===0);
   else if(scenario==='accept'){check('Pointer Upgrade downloads only approved bytes',calls.downloads===1&&plan&&fs.readFileSync(plan.installerPath).equals(bytes));check('Actual main uses acknowledged inert handoff and normal quit',calls.arm===1&&calls.release===1&&calls.quit===1)}
   else check('Bad checksum keeps actual app open and never arms installer',calls.downloads===1&&calls.arm===0&&calls.quit===0);
   report.status='passed';persist();
  }catch(error){report.status='failed';report.failure=error.message;persist();throw error}
  finally{try{window?.webContents.debugger.detach();window?.destroy()}catch{}if(plan)try{plan.cleanup()}catch{}app.exit(report.status==='passed'?0:1)}
 })().catch(()=>require('electron').app.exit(1));
}
