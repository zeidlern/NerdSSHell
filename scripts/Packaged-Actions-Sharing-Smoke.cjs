'use strict';
/** Real packaged renderer, isolated profile and fixture SSH only. Never executes an administrative recipe. */
async function actionsSharingSmoke({evaluate,wait,check,screenshot}) {
  const saved=await evaluate('api.actionConfiguration()');
  const findRow=title=>`[...$('wbActionList').children].find(r=>r.querySelector('.wb-action')?.textContent.startsWith(${JSON.stringify(title)}))`;
  try {
    await evaluate(`api.actionConfigurationSave({...${JSON.stringify(saved)},favoritesByOS:{...${JSON.stringify(saved.favoritesByOS)},Windows:[]}})`);
    await evaluate(`BetterSSHWorkbench.open({target:'local:powershell'}); true`);
    await wait(`$('workbenchDialog').open && $('wbTarget').value==='local:powershell' && $('wbPlatform').textContent.includes('Windows') && $('wbActionList').querySelectorAll('.wb-action').length===18`, 'Local action catalog did not load.');
    await evaluate(`$('wbSearch').value='task manager cpu'; $('wbSearch').dispatchEvent(new Event('input',{bubbles:true})); true`);
    check('Quick Actions finds Windows terminology without running anything',await evaluate(`$('wbActionList').querySelectorAll('.wb-action').length===1 && $('wbActionList').textContent.includes('Running processes') && views.size===4 && $('wbRun').disabled`));
    await evaluate(`$('wbSearch').value=''; $('wbSearch').dispatchEvent(new Event('input',{bubbles:true})); true`);
    check('Unsupported local administrative actions have visible reasons',await evaluate(`${findRow('Restart this computer')}?.querySelector('.wb-action').disabled && ${findRow('Restart this computer')}.textContent.includes('Unavailable:')`));
    await evaluate(`${findRow('System information')}.querySelector('.wb-pin').click(); true`);
    await wait(`$('preferencesDialog').open&&!$('preferences-favorites').hidden&&!$('savePreferences').disabled&&!$('workbenchDialog').open`, 'Workbench favorite did not open Favorites in Preferences.');
    await evaluate(`$('favoriteOS').value='Windows'; $('favoriteOS').dispatchEvent(new Event('change',{bubbles:true})); true`);
    await wait(`$('favoriteConfigList').children.length===18`, 'Windows favorite configuration did not load.');
    for(const title of ['System information','Disk space','Memory usage','Running processes']) await evaluate(`[...$('favoriteConfigList').children].find(r=>r.querySelector('span')?.textContent===${JSON.stringify(title)}).querySelector('input').click(); true`);
    check('Four per-OS favorites stay unsaved until explicit Save',await evaluate(`api.actionConfiguration().then(c=>c.favoritesByOS.Windows.length===0)`));
    await evaluate(`$('savePreferences').click(); true`);
    await wait(`!$('preferencesDialog').open&&api.actionConfiguration().then(c=>c.favoritesByOS.Windows.length===4)`, 'Explicit favorite save did not complete.');
    check('Favorites persist per OS with more than the former three-action limit',await evaluate(`api.actionConfiguration().then(c=>c.favoritesByOS.Windows.join(',')==='system.info,system.disk,system.memory,system.processes')`));
    await evaluate(`BetterSSHWorkbench.open({target:'local:powershell'}); true`);
    await wait(`$('workbenchDialog').open&&$('wbPlatform').textContent.includes('Windows')&&$('wbActionList').querySelectorAll('.wb-action').length===18`, 'Workbench did not reopen after favorite configuration.');
    await evaluate(`${findRow('Disk space')}.querySelector('.wb-action').click(); true`);
    await wait(`$('wbCode').value.includes('FreeGiB')`,'Disk action was not staged.');
    check('Picking a recipe stages its exact PowerShell with readable units, not execution',await evaluate(`$('wbRun').disabled && views.size===4 && $('wbTargetSummary').textContent.includes('LOCAL')`));
    await screenshot('workbench-quick-actions');
    const reopen = await evaluate(`(async()=>{const id=views.get(__smokeKeys[0]).pane.profileId;let oldClose;const closed=new Promise(resolve=>$('workbenchDialog').addEventListener('close',()=>{oldClose={open:$('workbenchDialog').open,target:$('wbTarget').value};resolve();},{once:true}));$('wbClose').click();const opening=BetterSSHWorkbench.open({target:id});await closed;await opening;return {oldClose,open:$('workbenchDialog').open,target:$('wbTarget').value,expected:id};})()`);
    check('Queued native dialog close preserves an immediate reopen for the new destination', reopen.open && reopen.target===reopen.expected && !!reopen.oldClose);
    try {
      await wait(`$('workbenchDialog').open && $('wbTarget').value===views.get(__smokeKeys[0]).pane.profileId && $('wbPlatform').textContent.includes('not inspected')`,'Remote catalog was not uninspected.');
    } catch (error) {
      const state = await evaluate(`(async()=>{const id=views.get(__smokeKeys[0]).pane.profileId;let backend;try{const a=await api.workbenchActions(id);backend={system:a.platform.system,id:a.platform.id||'',actions:a.actions.length,enabled:a.actions.filter(a=>a.enabled).length};}catch(e){backend={error:String(e.message).slice(0,256)};}return {open:$('workbenchDialog').open,expectedTarget:id,selectedTarget:$('wbTarget').value,platform:$('wbPlatform').textContent,feedback:$('wbFeedback').textContent.slice(0,256),closeDisabled:$('wbClose').disabled,viewCount:views.size,backend};})()`).catch(e=>({diagnosticError:String(e.message).slice(0,256)}));
      console.error('Remote catalog failure metadata: ' + JSON.stringify(state)); throw error;
    }
    check('Unknown remote platform remains disabled instead of guessing commands',await evaluate(`[...$('wbActionList').querySelectorAll('.wb-action')].every(b=>b.disabled) && views.size===4`));
    const clipboardAllowed=process.env.GITHUB_ACTIONS==='true'||process.argv.includes('--clipboard-fixture');
    if(clipboardAllowed) await evaluate(`api.copy('SHARING_SENTINEL')`);
    await evaluate(`$('wbDiagnostics').click(); true`);
    await wait(`$('wbDiagnosticsDialog').open && !$('wbDiagnosticsText').readOnly && !$('wbDiagnosticsCopy').disabled`,'Diagnostics did not prepare.');
    check('Diagnostics expose bounded scope and omit command/credential bodies',await evaluate(`(()=>{const d=JSON.parse($('wbDiagnosticsText').value);return d.limits.connections===64 && d.limits.events===100 && !JSON.stringify(d).includes('FreeGiB') && d.connections.every(c=>!('password' in c)&&!('privateKey' in c)&&!('command' in c));})()`));
    // Synthetic runner clipboard only, matching the existing clipboard-fixture consent rule.
    if(clipboardAllowed) {
      const marker='REDACTED_DIAGNOSTIC_FIXTURE';
      check('Opening diagnostics did not replace the clipboard',await evaluate(`api.paste()`)==='SHARING_SENTINEL');
      await evaluate(`$('wbDiagnosticsText').value=${JSON.stringify(marker)}; $('wbDiagnosticsCopy').click(); true`);
      await wait(`api.paste().then(t=>t===${JSON.stringify(marker)})`,'Explicit reviewed diagnostic copy failed.');
      check('Only the edited diagnostic text reaches the Windows clipboard');
    }
    await evaluate(`$('wbDiagnosticsClose').click(); true`);
    check('Closing sharing clears its text and disables copying immediately',await evaluate(`!$('wbDiagnosticsDialog').open && !$('wbDiagnosticsText').value && $('wbDiagnosticsCopy').disabled`));
    await evaluate(`active=__smokeKeys[0]; $('wbCopyOutput').click(); true`);
    await wait(`$('wbDiagnosticsDialog').open && !$('wbDiagnosticsText').readOnly`,'Output excerpt was not prepared.');
    check('Output sharing labels buffer/row limits and is not advertised as a full transcript',await evaluate(`$('wbDiagnosticsText').value.includes('Screen excerpt:') && $('wbDiagnosticsText').value.includes('older rows omitted') && $('wbDiagnosticsText').value.includes('NOT automatically redacted')`));
    await screenshot('workbench-sharing-review');
    await evaluate(`$('wbDiagnosticsClose').click(); $('wbClear').click(); $('wbClose').click(); true`);
    check('Quick Actions and sharing leave all existing SSH consoles untouched',await evaluate(`views.size===4 && __smokeKeys.every(k=>views.get(k).ready&&__smokeTerminalText(views.get(k)).includes(__smokeBanners.get(k)))`));
  } finally { await evaluate(`if($('preferencesDialog').open)$('cancelPreferences').click(); api.actionConfigurationSave(${JSON.stringify(saved)})`); }
}
module.exports={actionsSharingSmoke};
