'use strict';
/** Phase 3 extension: only synthetic text and pre-existing disposable SSH fixture views. */
async function commandReviewSmoke({ evaluate, wait, check }) {
  await evaluate(`NerdSSHellWorkbench.open({target:views.get(__smokeKeys[0]).pane.profileId}); true`);
  await wait(`$('workbenchDialog').open && $('wbTarget').value===views.get(__smokeKeys[0]).pane.profileId`, 'Command review fixture did not open.');
  const chat = 'Instructions\n```sh\nprintf synthetic_phase3_one\n```\nNext block\n```powershell\nWrite-Output synthetic_phase3_two\n```';
  await evaluate(`$('wbChat').value=${JSON.stringify(chat)}; $('wbImport').click(); $('wbBlocks').value='0'; $('wbBlocks').dispatchEvent(new Event('change',{bubbles:true})); true`);
  check('Chat import stages one exact block without running it', await evaluate(`$('wbCode').value==='printf synthetic_phase3_one' && $('wbRun').disabled && views.size===4`));
  await evaluate(`$('wbReview').click(); true`);
  await wait(`!$('wbReviewDetails').hidden && !$('wbRun').disabled`, 'Command review did not complete.');
  check('Review displays exact code and actual remote identity', await evaluate(`$('wbReviewText').textContent.includes('printf synthetic_phase3_one') && $('wbReviewText').textContent.includes('REMOTE') && views.size===4`));
  await evaluate(`$('wbCode').value='printf synthetic_phase3_edited'; $('wbCode').dispatchEvent(new Event('input',{bubbles:true})); true`);
  check('Editing a reviewed command removes its runnable approval', await evaluate(`$('wbRun').disabled && $('wbReviewDetails').hidden`));
  await evaluate(`$('wbReview').click(); true`); await wait(`!$('wbRun').disabled`, 'Second review did not complete.');
  await evaluate(`$('wbBlocks').value='1'; $('wbBlocks').dispatchEvent(new Event('change',{bubbles:true})); true`);
  check('Selecting another chat block invalidates rather than reuses approval', await evaluate(`$('wbCode').value==='Write-Output synthetic_phase3_two' && $('wbRun').disabled && views.size===4`));
  await evaluate(`$('wbClear').click(); $('wbCode').value='printf synthetic_phase3_close'; $('wbCode').dispatchEvent(new Event('input',{bubbles:true})); $('wbReview').click(); true`);
  await wait(`!$('wbRun').disabled`, 'Close-cancellation review did not complete.');
  await evaluate(`$('wbClose').click(); true`);
  check('Closing review removes approval and leaves remote work running', await evaluate(`!$('workbenchDialog').open && $('wbRun').disabled && views.size===4 && __smokeKeys.every(k=>views.get(k).ready)`));
  // The cancelled token must reject BEFORE displaying any native Run dialog.
  check('Cancelled backend ticket cannot launch a task', await evaluate(`(async()=>{const r=await api.workbenchReview(views.get(__smokeKeys[0]).pane.profileId,{code:'printf synthetic_phase3_cancelled'}); await api.workbenchCancelReview(r.token); try { await api.workbenchRun(r.token); return false; } catch(e) { return /expired|cancel|already used/i.test(e.message) && views.size===4; }})()`));
  try {
    await evaluate(`api.inputLock(__smokeKeys[0],true)`);
    check('Remote input lock is enforced behind the renderer', await evaluate(`api.input(__smokeKeys[0],'printf SHOULD_NOT_RUN\\r').then(()=>false,e=>e.message.includes('locked'))`));
    check('Lock applies only to its own remote view', await evaluate(`!!views.get(__smokeKeys[0]).locked && __smokeKeys.slice(1).every(k=>!views.get(k).locked)`));
  } finally { await evaluate(`api.inputLock(__smokeKeys[0],false)`); }
  check('Command review leaves every original remote banner and view intact', await evaluate(`__smokeKeys.every(k=>views.get(k).ready && __smokeTerminalText(views.get(k)).includes(__smokeBanners.get(k)))`));
  console.log('Phase 3 packaged command-review smoke completed. No reviewed task was executed by these UI checks.');
}
module.exports = { commandReviewSmoke };
