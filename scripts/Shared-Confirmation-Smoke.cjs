'use strict';
// Actual production executable, owned generated Standard shells, no clipboard use.
async function sharedConfirmationSmoke({ evaluate, send, wait, check, screenshot }) {
  const point = selector => evaluate('(()=>{const r=document.querySelector(' + JSON.stringify(selector) + ').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()');
  const click = async selector => { const position = await point(selector); for (const type of ['mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...position, button: 'left', clickCount: 1 }); };
  const begin = () => evaluate("window.__sharedDisconnect={done:false,value:null};api.disconnect('fixture-a').then(value=>{__sharedDisconnect={done:true,value};},()=>{__sharedDisconnect={done:true,value:'error'};});true");
  await begin(); await wait("$('promptDialog').open&&promptKind==='confirmation'", 'Owned Standard disconnect did not open the themed confirmation.');
  check('Production executable consequence approval uses the shared modal with explicit Continue and focused Cancel', await evaluate("$('promptTitle').textContent==='Close nonpersistent consoles?'&&$('promptAccept').textContent==='Continue'&&document.activeElement===$('cancelPrompt')&&$('promptValue').hidden&&$('promptRememberField').hidden"));
  await screenshot('shared-standard-confirmation');
  await click('#preferences');
  check('Production confirmation backdrop keeps approval pending and does not activate background controls', await evaluate("$('promptDialog').open&&!$('preferencesDialog').open&&!__sharedDisconnect.done&&__smokeKeys.every(key=>views.get(key).ready)"));
  await click('#cancelPrompt'); await wait('__sharedDisconnect.done', 'Pointer Cancel did not return a decision.');
  check('Production pointer Cancel preserves every original Standard shell', await evaluate("__sharedDisconnect.value===false&&__smokeKeys.every(key=>views.get(key).ready)"));
  await begin(); await wait("$('promptDialog').open&&promptKind==='confirmation'", 'Second owned disconnect confirmation did not appear.');
  await click('#promptAccept'); await wait('__sharedDisconnect.done', 'Pointer Continue did not return a decision.');
  await wait("statuses.get('fixture-a')?.state==='disconnected'&&__smokeKeys.filter(key=>key.startsWith('fixture-a/')).every(key=>!views.get(key).ready)", 'The approved owned profile did not disconnect.');
  check('Production pointer Continue succeeds and closes only the expressly approved profile', await evaluate("__sharedDisconnect.value===true&&__smokeKeys.filter(key=>key.startsWith('fixture-b/')).every(key=>views.get(key).ready)"));
}
module.exports = { sharedConfirmationSmoke };
