'use strict';
// Only observe owned fixture traffic. Production SSH encoder/decoder are untouched.
function receivedTerminalBaud(payload) {
  if (payload[0] !== 98) return null;
  let offset = 5;
  const string = () => { const length = payload.readUInt32BE(offset); offset += 4; const value = payload.subarray(offset, offset + length); offset += length; return value; };
  if (string().toString() !== 'pty-req') return null;
  offset++; string(); offset += 16;
  const bytes = string(), modes = {};
  for (let i = 0; i < bytes.length;) { const opcode = bytes[i++]; if (!opcode) break; const value = bytes.readUInt32BE(i); i += 4; if (opcode === 128 || opcode === 129) modes[opcode] = value; }
  return { input: modes[128] ?? null, output: modes[129] ?? null };
}
async function terminalBaudSmoke({ evaluate, send, wait, check, received }) {
  const point = selector => evaluate('(()=>{const element=document.querySelector(' + JSON.stringify(selector) + ');element.scrollIntoView({block:"nearest"});const r=element.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()');
  const click = async selector => { const position = await point(selector); for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...position, button: 'left', clickCount: 1 }); };
  const key = async (name, code) => { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: name, code: name, windowsVirtualKeyCode: code }); };
  const before = await evaluate('[...views.keys()]');
  const local = await evaluate('[...profiles.values()].find(p=>p.local)?.id');
  if (!local) throw Error('Disposable local profile is required to verify hidden baud settings.');
  await evaluate('run(chooseNewSession(' + JSON.stringify(local) + ')); true');
  await wait("$('newSessionDialog').open", 'Local new-session dialog did not open.');
  check('Packaged local consoles hide and disable unsupported terminal baud settings', await evaluate("$('newSessionBaudField').hidden&&$('newSessionBaud').disabled"));
  await click('#cancelNewSession');
  const count = received().length;
  check('Packaged IPC rejects Persistent terminal baud overrides without creating remote work', await evaluate("api.create('fixture-a','Unsupported baud',true,9600).then(()=>false,error=>error.message.includes('only to new Standard SSH'))"));
  check('Packaged IPC rejects local terminal baud overrides without creating local work', await evaluate('api.create(' + JSON.stringify(local) + ',"Unsupported baud",false,9600).then(()=>false,error=>error.message.includes("only to new Standard SSH"))'));
  check('Unsupported packaged baud options never allocate an SSH PTY', received().length === count);
  await evaluate("run(newSession('fixture-a')); true"); await wait("$('newSessionDialog').open", 'Baud creation dialog did not open.');
  check('Packaged Persistent choice disables unsupported terminal baud overrides', await evaluate("$('newSessionBaud').disabled&&$('newSessionBaudHint').textContent.includes('tmux')"));
  await click('#newSessionPersistent'); await click('#newSessionBaudField summary');
  await click('#newSessionBaud'); await key('End', 35); await key('ArrowUp', 38); await key('Enter', 13);
  await wait("$('newSessionBaud').value==='115200'&&!$('newSessionBaud').disabled", 'Mouse/keyboard selection did not choose the baud override.');
  check('Packaged Standard window chooses 115200 with native select interaction', await evaluate("$('newSessionBaud').value==='115200'&&$('newSessionBaudHint').textContent.includes('does not change SSH bandwidth')"));
  const requestCount = received().length;
  await click('#newSessionForm button[type="submit"]');
  await wait('[...views.keys()].some(key=>!' + JSON.stringify(before) + '.includes(key)&&views.get(key).ready)', 'New Standard window did not attach after pointer submission.');
  const added = await evaluate('[...views.keys()].filter(key=>!' + JSON.stringify(before) + '.includes(key))');
  check('Packaged creation keeps the originating saved profile and independent window rate', added.length === 1 && await evaluate('views.get(' + JSON.stringify(added[0]) + ').pane.profileId==="fixture-a"&&views.get(' + JSON.stringify(added[0]) + ').pane.terminalBaud===115200'));
  const requests = received();
  check('Exact packaged IPC and SSH send input/output baud 115200 on the received protocol request', requests.length === requestCount + 1 && requests.at(-1).input === 115200 && requests.at(-1).output === 115200);
  check('The original packaged Standard windows retain their own profile/default rates', await evaluate(JSON.stringify(before) + '.every(key=>views.get(key).ready&&views.get(key).pane.terminalBaud===(key.startsWith("fixture-a/")?9600:0))'));
}
module.exports = { receivedTerminalBaud, terminalBaudSmoke };
