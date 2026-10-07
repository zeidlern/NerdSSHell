'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os');
const { Remote } = require('../src/remote.cjs');
const { StandardRemote } = require('../src/standard-remote.cjs');
const { shellQuote:q } = require('../src/core.cjs');
function fixture(Type,socket) {
  const host=process.env.NERDSSHELL_TEST_HOST||'127.0.0.1';assert.equal(host,'127.0.0.1','Disposable loopback only');
  const port=Number(process.env.NERDSSHELL_TEST_PORT||22222),pub=fs.readFileSync(process.env.NERDSSHELL_TEST_HOST_KEY+'.pub','utf8').trim().split(/\s+/);
  return new Type({id:socket,name:'Workbench integration',host,port,username:process.env.NERDSSHELL_TEST_USER||os.userInfo().username,auth:'key',keyPath:process.env.NERDSSHELL_TEST_KEY,socket},
    {knownHosts:`[${host}]:${port} ${pub[0]} ${pub[1]}\n`,pins:{},ask:async()=>{throw Error('No prompts/install allowed');},trust:async()=>{throw Error('Unexpected host');}});
}
for(const [mode,Type] of [['persistent',Remote],['standard',StandardRemote]])test(`real SSH ${mode}: reviewed command starts once in a NEW task and leaves existing console intact`,{skip:!process.env.NERDSSHELL_TEST_KEY,timeout:60000},async t=>{
  const socket=`nerdsshell-workbench-${mode}-${process.pid}`,r=fixture(Type,socket),proof='/tmp/'+socket+'-proof';
  t.after(async()=>{try{if(r.connected){await r.exec(`rm -f ${q(proof)}`);if(mode==='persistent')await r.exec(`${r.prefix} kill-server 2>/dev/null`);}}finally{r.disconnect();}});
  await r.connect();const original=await r.create('Existing work');await r.open(original.key);const view=r.views.get(original.key);
  const task=await r.createTask('Reviewed task',`printf '%s' ${q("task output ' 😀")} > ${q(proof)}`);
  assert.notEqual(task.key,original.key);await r.open(task.key);
  let result='';for(let i=0;i<100;i++){result=await r.checked(`cat ${q(proof)} 2>/dev/null || true`);if(result)break;await new Promise(res=>setTimeout(res,50));}
  assert.equal(result,"task output ' 😀");assert.equal(r.views.get(original.key),view);assert.ok(view.active);
  if(mode==='persistent'){r.closeView(task.key);await r.open(task.key);assert.equal(await r.checked(`cat ${q(proof)}`),result);await r.endSession(task.key);await r.endSession(original.key);}
  else{r.closeView(task.key);r.closeView(original.key);}
});
