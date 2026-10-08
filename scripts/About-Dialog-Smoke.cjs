'use strict';
// Run only in an owned app/browser fixture, with genuine pointer/keyboard input.
async function aboutDialogSmoke({ evaluate, send, wait, check }) {
  const point = selector => evaluate('(()=>{const element=document.querySelector(' + JSON.stringify(selector) + ');element.scrollIntoView({block:"nearest"});const r=element.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()');
  const mouse = async (type, position) => send('Input.dispatchMouseEvent', { type, ...position, button: 'left', clickCount: 1 });
  const click = async position => { await mouse('mousePressed', position); await mouse('mouseReleased', position); };
  const open = async () => { if (!await evaluate("$('helpDialog').open")) await click(await point('#help')); await wait("$('helpDialog').open", 'About did not open by mouse.'); };
  const dismissed = async label => {
    await wait("!$('helpDialog').open", label + ': About did not close.');
    check(label + ' returns keyboard focus to Help', await evaluate("document.activeElement===$('help')"));
  };
  await open();
  await click(await point('#aboutHeading')); check('Pointer click on About content keeps it open', await evaluate("$('helpDialog').open"));
  const padding = await evaluate("(()=>{const r=$('helpDialog').getBoundingClientRect();return {x:r.left+4,y:r.top+4};})()");
  await click(padding); check('Pointer click within About border and padding keeps it open', await evaluate("$('helpDialog').open"));
  const inside = await point('#aboutHeading'), outside = await point('#preferences');
  const bounds = await evaluate("(()=>{const r=$('helpDialog').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};})()");
  if (outside.x > bounds.left && outside.x < bounds.right && outside.y > bounds.top && outside.y < bounds.bottom) throw Error('Fixture background control must be outside About.');
  await mouse('mousePressed', inside); await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...outside, buttons: 1 }); await mouse('mouseReleased', outside);
  check('Selecting or dragging from About content onto its backdrop keeps it open', await evaluate("$('helpDialog').open"));
  await mouse('mousePressed', outside); await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...inside, buttons: 1 }); await mouse('mouseReleased', inside);
  check('Dragging from About backdrop into its content keeps it open', await evaluate("$('helpDialog').open"));
  await click(outside); await dismissed('Backdrop dismissal');
  check('Backdrop click does not activate the Preferences button underneath', await evaluate("!$('preferencesDialog').open"));
  await open(); await click(await point('#closeHelp')); await dismissed('About Close button');
  await open();
  for (const type of ['keyDown','keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await dismissed('About Escape');
  await open(); await click(await point('#help')); await dismissed('Clicking outside on the Help opener');
  check('A backdrop click over Help does not reopen the dialog through the completed click', await evaluate("!$('helpDialog').open"));
}
module.exports = { aboutDialogSmoke };
