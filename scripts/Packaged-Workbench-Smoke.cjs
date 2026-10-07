'use strict';
/** Extends the existing isolated packaged-app harness; never points at a user's server/profile. */
async function workbenchSmoke({ evaluate, wait, check, screenshot }) {
  await evaluate(`NerdSSHellWorkbench.open(); true`);
  await wait(`$('workbenchDialog').open && !!$('wbTarget').options.length`, 'Workbench did not open.');
  check('Workbench keeps action execution unavailable until review', await evaluate(`$('wbRun').disabled && !$('wbCode').value`));
  await evaluate(`$('wbCode').value='printf harmless'; $('wbCode').dispatchEvent(new Event('input',{bubbles:true})); $('wbReview').click(); true`);
  await wait(`!$('wbReviewDetails').hidden && !$('wbRun').disabled`, 'Remote command review did not complete.');
  check('Remote review names its immutable destination and does not open another SSH shell', await evaluate(`$('wbReviewText').textContent.includes('REMOTE') && views.size===4`));
  await evaluate(`$('wbTarget').value='local:powershell'; $('wbTarget').dispatchEvent(new Event('change',{bubbles:true})); true`);
  await wait(`!$('wbLocalTools').hidden`, 'Local PowerShell choice missing.');
  check('Switching to local target invalidates old remote approval', await evaluate(`$('wbRun').disabled && $('wbCode').value==='printf harmless'`));
  await evaluate(`$('wbCode').value=''; $('wbCode').dispatchEvent(new Event('input',{bubbles:true})); $('wbOpenLocal').click(); true`);
  await wait(`[...views.values()].some(v=>v.pane.local&&v.ready)`, 'Packaged native PowerShell failed to open.');
  const key = await evaluate(`[...views.values()].find(v=>v.pane.local).pane.key`), k=JSON.stringify(key);
  await evaluate(`api.input(${k},${JSON.stringify("Write-Output ('LOCAL_' + 'WORKBENCH_42')\r")})`);
  await wait(`__smokeTerminalText(views.get(${k})).includes('LOCAL_WORKBENCH_42')`, 'Local PowerShell did not display output.');
  check('Packaged local PowerShell uses actual ConPTY and does not have an SFTP browser', await evaluate(`!views.get(${k}).files && views.get(${k}).wrapper.textContent.includes('LOCAL')`));
  await evaluate(`api.inputLock(${k},true)`);
  check('Local input lock is enforced in the main process', await evaluate(`api.input(${k},'Write-Output BAD\\r').then(()=>false,e=>e.message.includes('locked'))`));
  await evaluate(`api.inputLock(${k},false)`);
  await require('./UX-Actions-Smoke.cjs').uxActionsSmoke({ evaluate, wait, check, screenshot, key });
  check('Existing remote panes remain distinct while local PowerShell is open', await evaluate(`__smokeKeys.every(k=>views.get(k).ready&&__smokeTerminalText(views.get(k)).includes(__smokeBanners.get(k)))`));
  await screenshot('workbench-local-powershell');
  await evaluate(`api.input(${k},'exit\\r')`);
  await wait(`!views.get(${k}).ready`, 'Disposable PowerShell did not end.');
  await evaluate(`closeView(${k})`);
  check('Exiting the local console leaves all four remote consoles running', await evaluate(`views.size===4 && __smokeKeys.every(k=>views.get(k).ready)`));
  await evaluate(`NerdSSHellWorkbench.open(); true`);await wait(`$('workbenchDialog').open`, 'Workbench did not reopen.');
  await screenshot('workbench-command-review');await evaluate(`$('wbClose').click(); true`);
  await require('./Packaged-CommandReview-Smoke.cjs').commandReviewSmoke({ evaluate, wait, check });
  await require('./Packaged-Actions-Sharing-Smoke.cjs').actionsSharingSmoke({ evaluate, wait, check, screenshot });
  const localResult = await require('./Packaged-LocalPowerShell-Smoke.cjs').localPowerShellSmoke({ evaluate, wait, check, screenshot });
  console.log('Phase 2 native local PowerShell: ' + JSON.stringify(localResult));
}
module.exports = { workbenchSmoke };
