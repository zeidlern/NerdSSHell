'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { actions, compileAction, availableActions, parsePlatform, taskCommand, commandWarnings, scriptText, ReviewTickets } = require('../src/action-catalog.cjs');
const linux = { system: 'Linux', caps: ['apt', 'systemctl', 'systemd', 'journalctl', 'sudo', 'shutdown', 'docker', 'ip', 'ss', 'free'] };
test('unknown platforms fail closed instead of guessing an update command', () => { assert.ok(availableActions({system:'unknown'}).every(a=>!a.enabled)); });
test('platform data is parsed, never evaluated as shell source', () => {
  assert.deepEqual(parsePlatform('system:Linux\nID="ubuntu"\ncap:apt\ncap:docker\ncap:rm\n'), {system:'Linux',id:'ubuntu',caps:['apt','docker']});
  assert.equal(parsePlatform('system:Linux\nID="$(touch /tmp/no)"').id,'');
});
test('Arch only offers complete upgrade, never pacman -Sy alone', () => {
  const arch={system:'Linux',caps:['pacman','sudo']}; assert.equal(compileAction('updates.install',arch).code,'sudo pacman -Syu');
  assert.throws(()=>compileAction('updates.check',arch)); arch.caps.push('checkupdates'); assert.equal(compileAction('updates.check',arch).code,'checkupdates');
});
test('update checking describes cached apt metadata and dnf status 100', () => {
  assert.match(compileAction('updates.check',linux).note,/existing metadata/);
  assert.match(compileAction('updates.check',{system:'Linux',caps:['dnf']}).note,/100/);
});
test('local updates open Windows settings rather than executing apt or auto-installing', () => { assert.equal(compileAction('updates.check',{system:'Windows'}).code,"Start-Process 'ms-settings:windowsupdate'"); assert.throws(()=>compileAction('updates.install',{system:'Windows'})); });
test('sudo explanation does not claim global elevation or an expiry countdown', () => { assert.match(compileAction('admin.authenticate',linux).note,/Other consoles may ask again/); });
test('destructive operations are labelled and not hidden among read-only actions', () => { for(const id of ['system.reboot','system.shutdown','services.restart','docker.restart'])assert.equal(actions.find(a=>a.id===id).risk,'disruptive'); });
for (const value of ['x;id','$(whoami)','--all','a\nb','a b','foo/../bar',"a'b"]) test('reject command injection in parameter '+JSON.stringify(value),()=>assert.throws(()=>compileAction('services.restart',linux,value)));
test('service and container arguments are exact, quoted tokens',()=>{assert.equal(compileAction('services.status',linux,'agent@user.service').code,"systemctl status --no-pager -- 'agent@user.service'");assert.equal(compileAction('docker.logs',linux,'project-1').code,"docker logs --tail 200 -- 'project-1'");});
test('control bytes, bidi overrides, oversized and empty scripts rejected',()=>{for(const s of ['','a\x1bb','a\x00b','\u202erun','x'.repeat(32769)])assert.throws(()=>scriptText(s));assert.equal(scriptText('é\r\necho ok'),'é\necho ok');});
test('shell mismatch flags are advisory and never rewrite code',()=>{assert.match(commandWarnings('sudo apt update','powershell').join(' '),/Unix/);assert.match(commandWarnings('Get-Process','posix').join(' '),/PowerShell/);});
test('task scripts run in a new /bin/sh process and retain output in an interactive console',()=>{const c=taskCommand("printf '%s' hello");assert.match(c,/^\/bin\/sh -c /);assert.match(c,/exec \/bin\/sh -i/);});
test('review token is single-use, expires, and validates captured ownership',()=>{
  let now=0,valid=true;const tickets=new ReviewTickets({now:()=>now}),owner={validate:()=>{if(!valid)throw Error('Changed');}};
  const a=tickets.issue({code:'whoami'},owner);assert.equal(tickets.take(a).plan.code,'whoami');assert.throws(()=>tickets.take(a));
  const b=tickets.issue({},owner);now=300001;assert.throws(()=>tickets.take(b));
  const c=tickets.issue({},owner);valid=false;assert.throws(()=>tickets.take(c),/Changed/);
});
test('pending review storage is bounded and cancellation frees a slot',()=>{const t=new ReviewTickets(),o={validate(){}};const tokens=Array.from({length:16},()=>t.issue({},o));assert.throws(()=>t.issue({},o));t.cancel(tokens[0]);t.issue({},o);});

test('conflicting system or distribution claims fail closed, duplicate consistent claims are harmless', () => {
  for (const text of ['system:Linux\nsystem:Darwin\ncap:apt', 'system:Linux\nID=ubuntu\nID=fedora\ncap:apt', 'system:FreeBSD\ncap:apt'])
    assert.deepEqual(parsePlatform(text), {system:'unknown',id:'',caps:[]});
  assert.equal(parsePlatform('system:Linux\nsystem:Linux\nID=ubuntu\nID=ubuntu').system, 'Linux');
});
test('systemctl binary alone does not establish a running systemd manager', () => {
  const f = {system:'Linux',caps:['systemctl']};
  assert.throws(() => compileAction('services.status',f,'example'));
  assert.throws(() => compileAction('services.list',f));
  f.caps.push('systemd'); assert.match(compileAction('services.list',f).note,/not an inventory/);
});
test('journal inspection requires journalctl independently and never silently adds sudo', () => {
  assert.throws(() => compileAction('services.logs',{system:'Linux',caps:['systemctl','systemd']},'example'));
  const plan=compileAction('services.logs',{system:'Linux',caps:['journalctl']},'example');
  assert.match(plan.code,/^journalctl --no-pager -n 200/); assert.doesNotMatch(plan.code,/sudo|\s-f\b/);
  assert.match(plan.note,/current account/);
});
test('Windows readouts label units and distinguish total CPU time from utilization', () => {
  for (const [id,field] of [['system.disk','FreeGiB'],['system.memory','TotalMiB'],['system.processes','CPUSeconds']])
    assert.ok(compileAction(id,{system:'Windows'}).code.includes(field));
  assert.match(compileAction('system.processes',{system:'Windows'}).note,/not current percent/);
});
test('process and service inspections omit full command arguments and explain status limitations', () => {
  assert.doesNotMatch(compileAction('system.processes',{system:'Darwin'}).code,/ps aux|args|command/);
  assert.match(compileAction('system.processes',{system:'Darwin'}).code,/comm/);
  assert.match(compileAction('services.status',linux,'test').note,/inactive/);
});
test('every action has bounded useful search terms and unavailable actions explain why', () => {
  assert.equal(actions.length,18); assert.ok(actions.every(a=>typeof a.keywords==='string' && a.keywords.length<150));
  assert.match(actions.find(a=>a.id==='system.processes').keywords,/task manager/);
  assert.ok(availableActions({system:'unknown'}).every(a=>!a.enabled && a.reason.length>0));
});


test('updates use the detected distribution instead of the first installed manager',()=>{
  assert.equal(compileAction('updates.install',{system:'Linux',id:'fedora',caps:['apt','dnf','sudo']}).code,'sudo dnf upgrade --refresh');
  assert.equal(compileAction('updates.install',{system:'Linux',id:'ubuntu',caps:['apt','dnf','sudo']}).code,'sudo apt update && sudo apt upgrade');
  assert.throws(()=>compileAction('updates.install',{system:'Linux',id:'fedora',caps:['apt','sudo']}),/expected package manager/);
});
test('ambiguous managers and image-based tooling are not guessed',()=>{
  for (const caps of [['apt','dnf'],['dnf','rpm-ostree'],['dnf','bootc'],[]])
    assert.throws(()=>compileAction('updates.install',{system:'Linux',caps:[...caps,'sudo']}));
});
test('administrator and power actions require their tools, without fallback privilege escalation',()=>{
  assert.throws(()=>compileAction('admin.authenticate',{system:'Linux',caps:[]}),/sudo/);
  assert.throws(()=>compileAction('system.reboot',{system:'Linux',caps:['sudo']}),/shutdown/);
  assert.throws(()=>compileAction('services.restart',{system:'Linux',caps:['systemctl','systemd']},'example'),/sudo/);
  assert.throws(()=>compileAction('system.shutdown',{system:'Windows'}));
});
test('all package installs are disruptive and keep prompts, without forced updates or reboot',()=>{
  const facts=[{system:'Linux',id:'ubuntu',caps:['apt','sudo']},{system:'Linux',id:'fedora',caps:['dnf','sudo']},
    {system:'Linux',id:'arch',caps:['pacman','sudo']},{system:'Darwin',caps:['softwareupdate','sudo']}];
  for(const f of facts){const p=compileAction('updates.install',f);assert.equal(p.risk,'disruptive');
    assert.doesNotMatch(p.code,/--force|--noconfirm|(?:^|\s)-y(?:\s|$)|shutdown|reboot/);assert.match(p.note,/interrupt SSH/);}
});
test('docker restart acknowledges remote contexts rather than implying the SSH host owns the daemon',()=>{
  const p=compileAction('docker.restart',{system:'Linux',caps:['docker']},'example');
  assert.equal(p.code,"docker restart -- 'example'");assert.match(p.note,/another computer/);
});
