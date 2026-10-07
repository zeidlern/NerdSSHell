"use strict";
/** Actual bundled UI, isolated smoke profile and disposable LOCAL pane only. */
async function uxActionsSmoke({ evaluate, wait, check, screenshot, key }) {
  if (typeof key !== 'string' || !key.startsWith('local:') || key.startsWith('local:cmd')) throw new Error('UX action smoke requires an existing disposable PowerShell pane.');
  const k = JSON.stringify(key), saved = await evaluate('api.actionConfiguration()');
  const titles = ['System information', 'Disk space', 'Memory usage', 'Running processes'];
  const action = title => `[...$('actionConfigList').children].find(r=>r.textContent===${JSON.stringify(title)})`;
  const favorite = title => `[...$('favoriteConfigList').children].find(r=>r.querySelector('span')?.textContent===${JSON.stringify(title)})`;
  async function openWindows() {
    await evaluate(`NerdSSHellPreferences.open('favorites'); true`);
    await wait(`$('preferencesDialog').open && !$('preferences-favorites').hidden && !$('savePreferences').disabled`, 'Preferences Favorites did not load.');
    await evaluate(`$('favoriteOS').value='Windows'; $('favoriteOS').dispatchEvent(new Event('change',{bubbles:true})); true`);
    await wait(`!!${favorite('System information')}`, 'Windows favorites did not load.');
  }
  async function setFourFavorites() {
    // Resolve each live checkbox after rendering; onchange replaces the rows.
    await evaluate(`(()=>{for(;;){const box=$('favoriteConfigList').querySelector('input:checked');if(!box)break;box.click();}return true;})()`);
    for (const title of titles) await evaluate(`${favorite(title)}.querySelector('input').click(); true`);
  }
  try {
    const before = await evaluate(`({count:views.size,remote:__smokeKeys.map(k=>__smokeTerminalText(views.get(k)))})`);
    await openWindows(); await setFourFavorites();
    check('Per-OS favorites remain a draft until Preferences Save', JSON.stringify(await evaluate('api.actionConfiguration()')) === JSON.stringify(saved));
    await evaluate(`$('cancelPreferences').click(); true`);
    await wait(`!$('preferencesDialog').open`, 'Preferences Cancel did not close.');
    check('Preferences Cancel discards the unsaved OS favorites', JSON.stringify(await evaluate('api.actionConfiguration()')) === JSON.stringify(saved));
    await openWindows(); await setFourFavorites();
    await evaluate(`$('preferenceTab-actions').click(); $('actionOS').value='Windows'; $('actionOS').dispatchEvent(new Event('change',{bubbles:true})); true`);
    await wait(`!!${action('System information')}`, 'Windows action editor did not load.');
    await evaluate(`$('actionNew').click(); $('actionName').value='Synthetic action smoke'; $('actionName').dispatchEvent(new Event('input',{bubbles:true})); $('actionCode').value="Write-Output ('UX_DIRECT_' + 'COMMAND_MARKER')"; $('actionCode').dispatchEvent(new Event('input',{bubbles:true})); $('actionStore').click(); true`);
    await wait(`$('actionConfigStatus').textContent.includes('staged') && !!${action('Synthetic action smoke')}`, 'Custom action was not staged.');
    check('Keeping an action stages text without persistence or execution', JSON.stringify(await evaluate('api.actionConfiguration()')) === JSON.stringify(saved) && await evaluate(`views.size===${before.count}`));
    await evaluate(`$('preferenceTab-favorites').click(); ${favorite('Synthetic action smoke')}.querySelector('input').click(); $('savePreferences').click(); true`);
    await wait(`!$('preferencesDialog').open && api.actionConfiguration().then(c=>c.favoritesByOS.Windows.length===5&&c.custom.some(a=>a.title==='Synthetic action smoke'))`, 'Preferences did not save the action and favorites together.');
    await wait(`views.get(${k}).actionBar.favoriteButtons.size===5 && !views.get(${k}).actionBar.all.disabled`, 'Existing LOCAL pane did not refresh its favorite buttons.');
    check('Each LOCAL pane exposes an Actions dropdown, native Favorite buttons and separate Configure Favorites', await evaluate(`(()=>{const a=views.get(${k}).actionBar;return a.all.tagName==='SELECT'&&a.all.options.length>=20&&a.configureFavorites.textContent==='Configure Favorites…'&&a.configureFavorites.type==='button'&&!a.favorites.contains(a.configureFavorites)&&a.favorites.getAttribute('role')==='group'&&a.favorites.querySelectorAll('button[type="button"]').length===5&&!a.bar.querySelector('.pane-favorite-select');})()`));
    const id = await evaluate(`api.actionConfiguration().then(c=>c.custom.find(a=>a.title==='Synthetic action smoke').id)`);
    const countMarker = `__smokeTerminalText(views.get(${k})).split('UX_DIRECT_COMMAND_MARKER').length-1`;
    const priorCount = await evaluate(countMarker);
    for (const [index, menu] of ['all', 'favorites'].entries()) {
      if (menu === 'all') await evaluate(`views.get(${k}).actionBar.all.value=${JSON.stringify(id)}; views.get(${k}).actionBar.all.dispatchEvent(new Event('change',{bubbles:true})); true`);
      else await evaluate(`views.get(${k}).actionBar.favoriteButtons.get(${JSON.stringify(id)}).click(); true`);
      await wait(`(${countMarker})===${priorCount + index + 1} && !views.get(${k}).actionBar.all.disabled`, `${menu} did not execute its marker in the invoking PowerShell console.`);
    }
    check('Actions and Favorites execute in the original LOCAL session without creating a console or opening review', await evaluate(`!$('workbenchDialog').open&&!$('preferencesDialog').open&&views.size===${before.count}`));
    await screenshot('ux-per-os-pane-actions');
    check('LOCAL Actions and Favorites preserve all existing SSH terminal contents', await evaluate(`views.size===${before.count}&&__smokeKeys.every((k,i)=>__smokeTerminalText(views.get(k))===${JSON.stringify(before.remote)}[i])`));
  } finally {
    await evaluate(`if($('workbenchDialog').open)$('wbClose').click(); if($('preferencesDialog').open)$('cancelPreferences').click(); api.actionConfigurationSave(${JSON.stringify(saved)}).then(()=>Promise.all([...views.values()].map(v=>BetterSSHPanes.refresh(v))))`);
  }
}
module.exports = { uxActionsSmoke };
