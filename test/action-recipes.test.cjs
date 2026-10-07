'use strict';
// Syntax-only parsing of generated recipes. No update, sudo, shutdown or service action executes.
const test=require('node:test'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {actions,compileAction}=require('../src/action-catalog.cjs');
const caps=['apt','dnf','pacman','checkupdates','systemctl','systemd','journalctl','sudo','shutdown','docker','ip','ss','free','softwareupdate'];
if(process.platform!=='win32')test('all offered Unix recipes parse in POSIX sh without execution',()=>{
 for(const facts of [{system:'Linux',id:'ubuntu',caps},{system:'Linux',id:'fedora',caps},{system:'Linux',id:'arch',caps},{system:'Darwin',caps}])
  for(const a of actions){let p;try{p=compileAction(a.id,facts,a.argument?'synthetic.service':'');}catch{continue;}
   const r=spawnSync('/bin/sh',['-n'],{input:p.code,encoding:'utf8',timeout:5000});assert.equal(r.status,0,`${facts.id||facts.system}/${a.id}: ${r.stderr||r.error}`);
  }
});
if(process.platform==='win32')test('all offered PowerShell recipes parse in installed PowerShell versions without execution',()=>{
 // CMD has no equivalent syntax-only parser; its native fixtures cover CMD separately.
 const {installedShells}=require('../src/local-remote.cjs'),shells=installedShells().filter(s=>s.family==='powershell');assert.ok(shells.some(s=>s.id==='local:powershell'));
 const scripts=actions.flatMap(a=>{try{return [compileAction(a.id,{system:'Windows',shell:'powershell'}).code];}catch{return [];}});
 const parser='$items=([Console]::In.ReadToEnd() | ConvertFrom-Json); foreach($text in $items) {$tokens=$null; $errors=$null; [void][System.Management.Automation.Language.Parser]::ParseInput($text,[ref]$tokens,[ref]$errors); if($errors.Count -gt 0){[Console]::Error.WriteLine(($errors | Out-String)); exit 1}}; [Console]::WriteLine("RECIPES_PARSED"); exit 0';
 for(const s of shells){const r=spawnSync(s.executable,['-NoLogo','-NoProfile','-EncodedCommand',Buffer.from(parser,'utf16le').toString('base64')],{input:JSON.stringify(scripts),encoding:'utf8',timeout:20000,windowsHide:true});
  assert.equal(r.status,0,`${s.name}: ${r.stderr||r.error}`);assert.match(r.stdout,/RECIPES_PARSED/);
 }
});
