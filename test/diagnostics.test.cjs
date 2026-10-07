'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {diagnosticSnapshot,boundedText}=require('../src/diagnostics.cjs');
const {outputExcerpt,selectionText,visibleText}=require('../ui/command-review.js');
function terminal(rows,type='normal') { return {buffer:{active:{type,length:rows.length,getLine:i=>({isWrapped:rows[i][1],translateToString:trim=>trim?rows[i][0].trimEnd():rows[i][0]})}}}; }
test('soft-wrap spaces are preserved while hard line endings remain separate',()=>{
 const t=terminal([['hello ',false],['world ',true],['next',false]]);
 assert.equal(selectionText(t),'hello world\nnext');
});
test('excerpt caps rows and UTF8 bytes, and explicitly reports a partial wrapped beginning',()=>{
 const t=terminal([['older',false],['é😀',true],['last',false]],'alternate');
 const e=outputExcerpt(t,2,131072);assert.equal(e.rows,2);assert.equal(e.omittedRows,1);assert.equal(e.startsMidLine,true);assert.equal(e.buffer,'alternate');assert.equal(e.bytes,Buffer.byteLength(e.text));
 const small=outputExcerpt(t,2,4);assert.equal(small.text,'last');assert.equal(small.bytes,4);assert.equal(small.rows,1);
});
test('an oversized row is omitted explicitly rather than allocating an unbounded excerpt',()=>{
 const e=outputExcerpt(terminal([['x'.repeat(300),false]]),200,10);assert.equal(e.text,'');assert.equal(e.rows,0);assert.equal(e.omittedRows,1);
});
test('invalid excerpt budgets cannot disable the limits',()=>{
 for(const n of [0,-1,201,NaN,Infinity,1.2])assert.throws(()=>outputExcerpt(terminal([]),n));
 for(const n of [0,-1,131073,Infinity])assert.throws(()=>outputExcerpt(terminal([]),200,n));
});
test('control and direction overrides become visible labels; ordinary Unicode and tabs remain',()=>{
 assert.equal(visibleText('é\t😀\u202ehide\x1b'),'é\t😀[U+202E]hide[U+001B]');
 const e=outputExcerpt(terminal([['x\u202e',false]]),200,5);assert.equal(e.text,'');
});
test('diagnostics allowlist and bound metadata, events and connection inventory without reading secrets',()=>{
 const r={profile:{name:'N'.repeat(1000),host:'host.example',username:'tester',sessionMode:'persistent'},state:'connected',remote:{views:new Map()}};
 Object.defineProperty(r,'secrets',{get(){throw Error('Must not inspect secrets');}});
 const connections=new Map(Array.from({length:100},(_,i)=>['p'+i,r]));
 const journal=Array.from({length:150},()=>({at:'now',event:'Connected',profileId:'p1',code:'SECRET',password:'SECRET'}));
 const d=diagnosticSnapshot(connections,journal,{version:'test',platform:'win32',architecture:'x64'});
 assert.equal(d.connections.length,64);assert.equal(d.omittedConnections,36);assert.equal(d.events.length,100);assert.equal(d.connections[0].name.length,256);
 assert.doesNotMatch(JSON.stringify(d),/SECRET/);assert.match(d.note,/not automatic secret redaction/);
 assert.equal(boundedText('safe\u202etext'),'safe[U+202E]text');
});
test('diagnostic returned records cannot mutate their source profiles or journal',()=>{
 const connections=new Map([['a',{profile:{name:'original'},state:'connected'}]]),events=[{event:'original',profileId:'a',at:'now'}];
 const d=diagnosticSnapshot(connections,events,{version:'x',platform:'x',architecture:'x'});d.connections[0].name='changed';d.events[0].event='changed';
 assert.equal(connections.get('a').profile.name,'original');assert.equal(events[0].event,'original');
});
for(const [cols,input,expected] of [[6,'hello world','hello world'],[5,'abcd中','abcd中'],[5,'a中 de','a中 de']])
 test(`actual xterm buffer retains soft wrapping and wide-cell padding: ${cols}/${input}`,async()=>{
  const {Terminal}=require('@xterm/xterm');const t=new Terminal({cols,rows:3});
  try{await new Promise(r=>t.write(input,r));assert.equal(outputExcerpt(t).text.trimEnd(),expected);}finally{t.dispose();}
 });
