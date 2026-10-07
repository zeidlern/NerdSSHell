'use strict';
/** Called only by the owned packaged-loopback fixture. Never clicks a transfer/OS picker. */
async function uxSftpSmoke({ evaluate, wait, check, send, key }) {
  key ||= await evaluate('__smokeKeys[0]');
  if (typeof key !== 'string' || !key.startsWith('fixture-')) throw new Error('UX SFTP smoke requires an owned loopback fixture pane.');
  const pane = `views.get(${JSON.stringify(key)})`, local = name => `${pane}.wrapper.querySelector('[data-local="${name}"]')`;
  await evaluate(`${pane}.files.show(true); true`);
  await wait(`${pane}.files.connected&&!${pane}.files.loading&&${pane}.files.directory!=='~'`, 'Remote dual-panel listing did not initialize.');
  await wait(`${local('path')}.value.length>0&&!${local('refresh')}.disabled`, 'Local dual-panel listing did not initialize.');
  check('Actual per-pane File SFTP drawer contains Local and Remote directory panels', await evaluate(`${pane}.wrapper.querySelector('.file-local')!==null&&${pane}.wrapper.querySelector('.file-remote')!==null`));
  check('Local panel exposes navigation, scoped-folder Browse and copy-only arrows', await evaluate(`[${local('home')},${local('up')},${local('refresh')},${local('browse')},${local('upload')},${local('download')}].every(Boolean)&&${local('upload')}.textContent.includes('→')&&${local('download')}.textContent.includes('←')`));
  // No private directory path or filenames are returned to the report/screenshot.
  await evaluate(`window.__uxLocalPath=${local('path')}.value; ${pane}.files.select(${pane}.files.entries.find(e=>e.kind==='file'&&!e.name.startsWith('.')).path); true`);
  check('Selecting a listed Remote file enables the arrow into this pane’s Local folder', await evaluate(`!${local('download')}.disabled`));
  if (typeof send !== 'function') throw new Error('Owned SFTP drag acceptance requires CDP pointer input.');
  const point = await evaluate(`(()=>{const v=${pane},row=[...v.wrapper.querySelector('[data-file="list"]').children].find(r=>r.dataset.path===v.files.selectedPath);if(!row||row.disabled)throw new Error('Fixture Remote row cannot be dragged.');row.scrollIntoView({block:'center',inline:'center'});window.__uxDragRow=row;window.__uxDragListener=e=>{try{const value=JSON.parse(e.dataTransfer.getData(NerdSSHellLocalFiles.TYPE));window.__uxDragObserved={trusted:e.isTrusted,copy:e.dataTransfer.effectAllowed==='copy',owner:value.key===v.files.key,browser:value.browserId===v.files.browserId,epoch:value.epoch===v.files.epoch,side:value.side==='remote'};}finally{e.preventDefault();}};row.addEventListener('dragstart',__uxDragListener);const r=row.getBoundingClientRect();if(r.width<=0||r.height<=0)throw new Error('Fixture Remote row is not visible.');return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  try {
    // Synthetic drag stores do not model the writable effectAllowed state of
    // an actual dragstart. Observe trusted input, then cancel before any drop.
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x + 20, y: point.y, button: 'left', buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x + 20, y: point.y, button: 'left', clickCount: 1 });
    await wait('window.__uxDragObserved!==undefined', 'Trusted fixture file dragstart did not occur.');
    const observed = await evaluate('__uxDragObserved');
    if (!Object.values(observed).every(value => value === true)) throw new Error('Trusted SFTP drag failed: ' + JSON.stringify(observed));
    check('Actual trusted remote drag advertises copy and carries immutable pane/browser/listing identity');
  } finally {
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x + 20, y: point.y, button: 'left', clickCount: 1 });
    await evaluate(`__uxDragRow.removeEventListener('dragstart',__uxDragListener);delete window.__uxDragRow;delete window.__uxDragListener;delete window.__uxDragObserved;true`);
  }
  await evaluate(`(()=>{const v=${pane}, data=new DataTransfer();data.setData(NerdSSHellLocalFiles.TYPE,JSON.stringify({key:v.files.key,browserId:'stale-browser',path:v.files.selectedPath,side:'remote',epoch:v.files.epoch}));v.wrapper.querySelector('[data-local="panel"]').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));return true;})()`);
  check('Cross-browser file drag is rejected before any copy prompt or transfer', await evaluate(`$('notice').textContent.includes('same File SFTP pane')&&activeTransfers.size===0`));
  await evaluate(`(()=>{const v=${pane}, data=new DataTransfer();data.setData(NerdSSHellLocalFiles.TYPE,JSON.stringify({key:v.files.key,browserId:v.files.browserId,path:v.files.selectedPath,side:'remote',epoch:v.files.epoch-1}));v.wrapper.querySelector('[data-local="panel"]').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));return true;})()`);
  check('A stale Remote listing drag is rejected before any copy prompt or transfer', await evaluate(`$('notice').textContent.includes('dragged folder listing changed')&&activeTransfers.size===0`));
  await evaluate(`${pane}.files.show(false); true`);
  check('Collapsing File SFTP disables both Local copy arrows', await evaluate(`${local('upload')}.disabled&&${local('download')}.disabled`));
  await evaluate(`${pane}.files.show(true); true`);
  await wait(`!${local('refresh')}.disabled&&!${pane}.files.loading`, 'Reopened dual-panel browser did not reload.');
  check('Reopened Local panel preserves its own folder and discards stale selection', await evaluate(`${local('path')}.value===__uxLocalPath&&${local('upload')}.disabled`));
  await evaluate(`delete window.__uxLocalPath; true`);
}
module.exports = { uxSftpSmoke };
