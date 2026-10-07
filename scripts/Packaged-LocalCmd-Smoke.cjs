'use strict';
let geometryObservation = 0;
/** Observe the app's ordinary CMD resize; never submit a resize or a shell command.
 * Local discovery reads the same pane record updated after native setWindow.
 */
async function waitForLocalGeometry({ evaluate, wait, key }) {
  if (typeof key !== 'string' || !/^local:cmd\/standard-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(key)) throw new Error('Geometry observation requires an owned ordinary CMD key.');
  const k = JSON.stringify(key), observation = JSON.stringify('cmd-geometry-' + ++geometryObservation);
  try {
    await evaluate(`(()=>{const v=views.get(${k});if(!v?.ready||!v.pane.local||v.pane.administrator||v.pane.profileId!=='local:cmd'||v.pane.shellId!=='local:cmd'||v.pane.key!==${k}||typeof v.pane.sessionToken!=='string'||!${k}.endsWith('/standard-'+v.pane.sessionToken))throw Error('Owned CMD geometry target is not ready');
      window.__smokeLocalGeometry??=new Map();__smokeLocalGeometry.set(${observation},{view:v,generation:v.generation,token:v.pane.sessionToken,accepted:null});return true;})()`);
    await wait(`(async()=>{const s=window.__smokeLocalGeometry?.get(${observation}),v=s?.view;
      const current=()=>v&&views.get(${k})===v&&v.generation===s.generation&&v.ready&&v.pane.local&&!v.pane.administrator&&v.pane.key===${k}&&v.pane.profileId==='local:cmd'&&v.pane.shellId==='local:cmd'&&v.pane.sessionToken===s.token;
      if(!current())throw Error('Owned CMD geometry target changed');
      // App render schedules fit on animation frame; ResizeObserver can queue
      // another fit during that frame. Consume both phases before its chain.
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      if(!current())throw Error('Owned CMD geometry target changed');
      const rendered=v.render;await rendered;if(!current())throw Error('Owned CMD geometry target changed');
      const shape=()=>{const cols=v.terminal.cols,rows=v.terminal.rows,hostWidth=v.host.clientWidth,hostHeight=v.host.clientHeight,bounded=Number.isInteger(cols)&&cols>=20&&cols<=1000&&Number.isInteger(rows)&&rows>=5&&rows<=500;
        // Rounded DOM canvas metrics can make a fresh public proposal differ
        // by one column from the fit just applied. It is diagnostic, not an
        // acknowledgment of layout or native resize.
        if(window.__smokeCmdGeometry?.view===v){const p=v.fit.proposeDimensions(),d=v.terminal._core?._renderService?.dimensions,parent=v.terminal.element?.parentElement,style=parent?getComputedStyle(parent):null;__smokeCmdGeometry.trace.latestShape={cols,rows,proposal:p||null,proposalUsedAsGate:false,hidden:!!v.wrapper.hidden,fitQueued:!!v.fitQueued,bounded,renderChanged:v.render!==rendered,hostWidth,hostHeight,parentWidth:style?.getPropertyValue('width'),parentHeight:style?.getPropertyValue('height'),cellWidth:d?.css.cell.width,cellHeight:d?.css.cell.height,canvasWidth:d?.css.canvas.width,deviceCharWidth:d?.device.char.width,dpr:window.devicePixelRatio};}
        return !v.wrapper.hidden&&!v.fitQueued&&bounded&&hostWidth>=50&&hostHeight>=30?{cols,rows,hostWidth,hostHeight}:null;};
      const size=shape();if(!size||v.render!==rendered)return false;
      const found=await api.discover('local:cmd');if(!current())throw Error('Owned CMD geometry target changed');
      const latest=shape();if(!latest||v.render!==rendered||latest.cols!==size.cols||latest.rows!==size.rows||latest.hostWidth!==size.hostWidth||latest.hostHeight!==size.hostHeight)return false;
      if(!Array.isArray(found)||found.length>16)throw Error('Invalid ordinary CMD discovery result');
      const pane=found.find(p=>p?.key===${k});if(!pane||!pane.local||pane.administrator||pane.profileId!=='local:cmd'||pane.shellId!=='local:cmd'||pane.sessionToken!==s.token||pane.dead)throw Error('Owned CMD geometry identity changed');
      if(!Number.isInteger(pane.cols)||pane.cols<20||pane.cols>1000||!Number.isInteger(pane.rows)||pane.rows<5||pane.rows>500)throw Error('Invalid native CMD dimensions');
      if(window.__smokeCmdGeometry?.view===v)__smokeCmdGeometry.trace.backendReadback={cols:pane.cols,rows:pane.rows};
      if(pane.cols!==size.cols||pane.rows!==size.rows)return false;s.accepted={cols:size.cols,rows:size.rows};s.host={width:size.hostWidth,height:size.hostHeight};return true;
    })()`, 'Production CMD resize did not acknowledge the current rendered layout.');
    return await evaluate(`(()=>{const s=__smokeLocalGeometry.get(${observation}),v=s.view,a=s.accepted;if(views.get(${k})!==v||v.generation!==s.generation||!v.ready||!v.pane.local||v.pane.administrator||v.pane.key!==${k}||v.pane.profileId!=='local:cmd'||v.pane.shellId!=='local:cmd'||v.pane.sessionToken!==s.token||v.wrapper.hidden||v.fitQueued||!a||v.terminal.cols!==a.cols||v.terminal.rows!==a.rows||v.host.clientWidth!==s.host.width||v.host.clientHeight!==s.host.height)throw Error('Owned CMD geometry changed after acknowledgment');return a;})()`);
  } finally {
    try { await evaluate(`(()=>{window.__smokeLocalGeometry?.delete(${observation});if(window.__smokeLocalGeometry?.size===0)delete window.__smokeLocalGeometry;return true;})()`); } catch {}
  }
}
/** Actual packaged renderer/IPC/ConPTY, using only disposable local commands.
 * Administrator token/UAC interaction is a separate native manual check.
 */
async function localCmdSmoke({ evaluate, wait, check, screenshot }) {
  check('CMD: fixed shell appears in packaged discovery', await evaluate("api.workbenchContext().then(c=>c.targets.some(t=>t.id==='local:cmd'&&t.local))"));
  await evaluate("$('localCommandAdmin').checked=false; $('localCommandPrompt').click(); true");
  await wait("[...views.values()].some(v=>v.ready&&v.pane.profileId==='local:cmd')", 'Command Prompt launcher did not open a local console.');
  const key = await evaluate("[...views.values()].find(v=>v.ready&&v.pane.profileId==='local:cmd').pane.key"), k = JSON.stringify(key);
  const input = text => evaluate(`api.input(${k},${JSON.stringify(text)})`);
  const has = text => `__smokeTerminalText(views.get(${k})).includes(${JSON.stringify(text)})`;
  check('CMD: first rendered pane is local, nonpersistent, has no remote controls and identifies its shell', await evaluate(`(()=>{const v=views.get(${k}),p=v.pane,b=v.wrapper.querySelector('.wb-target-badge');return p.local&&p.sessionType==='local'&&p.shellFamily==='cmd'&&p.shellId==='local:cmd'&&p.persistent===false&&!p.administrator&&!v.files&&!v.wrapper.querySelector('.pane-disconnect')&&v.wrapper.querySelector('.pane-location-badge').textContent==='LOCAL'&&b?.title.includes('Command Prompt')&&b.title.includes('not persistent');})()`));
  await input('set "NERDSSH_CMD_VALUE=one"\recho CMD_NATIVE_%NERDSSH_CMD_VALUE%\rset "NERDSSH_CMD_QUOTED=two & three é漢字😀"\recho "CMD_QUOTED_%NERDSSH_CMD_QUOTED%"\recho CMD_CARET_^\rCONTINUED\rfor %i in (1 2) do (\recho CMD_LOOP_%i\r)\r');
  for (const marker of ['CMD_NATIVE_one', 'CMD_QUOTED_two & three é漢字😀', 'CMD_CARET_CONTINUED', 'CMD_LOOP_1', 'CMD_LOOP_2']) await wait(has(marker), 'CMD failed to render ' + marker);
  check('CMD: actual shell executes multiline variables, quoted ampersands, Unicode, caret continuation and groups');

  await evaluate(`(()=>{const v=views.get(${k}),started=performance.now();const trace={started,resizes:[],output:''};
    const record=()=>{const d=v.terminal._core?._renderService?.dimensions;trace.resizes.push({afterMs:Math.round(performance.now()-started),cols:v.terminal.cols,rows:v.terminal.rows,proposal:v.fit.proposeDimensions(),cellWidth:d?.css.cell.width,canvasWidth:d?.css.canvas.width,hostWidth:v.host.clientWidth});if(trace.resizes.length>32)trace.resizes.shift();};record();
    const resized=v.terminal.onResize(record),off=api.onEvent(e=>{if(e.type==='output'&&e.key===${k})trace.output=(trace.output+atob(e.data)).slice(-8192);});
    window.__smokeCmdGeometry={view:v,trace,stop:()=>{resized.dispose();off();}};return true;})()`);
  await evaluate("$('layoutSideBySide').click(); true");
  let size;
  try {
    size = await waitForLocalGeometry({ evaluate, wait, key });
    await evaluate(`(()=>{const s=__smokeCmdGeometry;s.trace.query={afterMs:Math.round(performance.now()-s.trace.started),cols:s.view.terminal.cols,rows:s.view.terminal.rows,fitQueued:!!s.view.fitQueued};return true;})()`);
    await input('mode con\r');
    await wait(`(()=>{const text=__smokeTerminalText(views.get(${k}));return /Columns:\\s+${size.cols}(?!\\d)/.test(text)&&/Lines:\\s+${size.rows}(?!\\d)/.test(text);})()`, 'CMD geometry did not follow the actual split layout.');
    const accepted = await evaluate(`(()=>{const s=__smokeCmdGeometry;return {expected:${JSON.stringify(size)},latestShape:s.trace.latestShape,query:s.trace.query,backendReadback:s.trace.backendReadback,resizes:s.trace.resizes};})()`);
    console.log('CMD native geometry acknowledged: ' + JSON.stringify(accepted));
  } catch (error) {
    const diagnostic = await evaluate(`(()=>{const s=__smokeCmdGeometry,v=s.view,text=__smokeTerminalText(v);return {expected:${JSON.stringify(size)},current:{cols:v.terminal.cols,rows:v.terminal.rows,fitQueued:!!v.fitQueued,ready:v.ready},latestShape:s.trace.latestShape,query:s.trace.query,backendReadback:s.trace.backendReadback,resizes:s.trace.resizes,nativeDimensions:[...text.matchAll(/(Columns|Lines):\\s+(\\d+)/g)].slice(-8).map(m=>({name:m[1],value:Number(m[2])})),renderedTail:text.slice(-4096),ownedOutputTail:s.trace.output};})()`).catch(e=>({diagnosticError:String(e.message).slice(0,256)}));
    console.error('CMD native geometry failure: ' + JSON.stringify(diagnostic)); throw error;
  } finally {
    try { await evaluate('(()=>{window.__smokeCmdGeometry?.stop();delete window.__smokeCmdGeometry;return true;})()'); } catch {}
  }
  check('CMD: actual ConPTY dimensions follow split layout');
  await evaluate("$('layoutOne').click(); true");
  await waitForLocalGeometry({ evaluate, wait, key });
  await input('echo CMD_AFTER_RESIZE_%NERDSSH_CMD_VALUE%\r');
  await wait(has('CMD_AFTER_RESIZE_one'), 'CMD did not accept input after pane growth.');
  check('CMD: pane growth retains console identity and fresh command input', await evaluate(`views.get(${k}).ready&&views.get(${k}).pane.key===${k}&&${has('CMD_QUOTED_two & three é漢字😀')}`));

  if (process.env.GITHUB_ACTIONS === 'true' || process.argv.includes('--clipboard-fixture')) {
    const marker = 'CMD_NATIVE_one';
    await evaluate(`(()=>{const t=views.get(${k}).terminal,b=t.buffer.active;for(let y=b.length-1;y>=0;y--){const x=b.getLine(y).translateToString(true).indexOf(${JSON.stringify(marker)});if(x>=0){t.select(x,y,${marker.length});return true;}}throw Error('Missing CMD clipboard fixture');})()`);
    await evaluate(`copySelection(views.get(${k}).terminal)`);
    check('CMD: selected synthetic output copies to Windows clipboard', await evaluate('api.paste()') === marker);
    await evaluate(`api.copy('echo CMD_PASTE_%NERDSSH_CMD_VALUE%')`); await evaluate(`paste(${k})`);
    check('CMD: clipboard paste waits for Enter', !await evaluate(has('CMD_PASTE_one')));
    await input('\r'); await wait(has('CMD_PASTE_one'), 'CMD clipboard paste did not execute after Enter.');
  }
  await input('ping -n 31 127.0.0.1 >nul\r');
  await evaluate('new Promise(resolve=>setTimeout(resolve,1000))');
  const interruptedAt = Date.now(); await input('\x03');
  await evaluate('new Promise(resolve=>setTimeout(resolve,300))');
  await input('echo CMD_INTERRUPT_%NERDSSH_CMD_VALUE%\r');
  await wait(has('CMD_INTERRUPT_one'), 'CMD Ctrl+C did not permit a fresh command.');
  check('CMD: Ctrl+C interrupts its disposable loopback wait', Date.now() - interruptedAt < 20000);
  check('CMD: remote fixture sessions stay distinct and running', await evaluate('__smokeKeys.every(key=>views.get(key).ready&&__smokeTerminalText(views.get(key)).includes(__smokeBanners.get(key)))'));
  await screenshot('local-command-prompt');
  await input('echo CMD_TAIL_%NERDSSH_CMD_VALUE% & exit\r');
  await wait(`!views.get(${k}).ready&&${has('CMD_TAIL_one')}`, 'CMD natural exit lost output or did not end.');
  await evaluate(`closeView(${k})`);
  check('CMD: natural exit preserves final output and leaves remote sessions running', await evaluate(`!views.has(${k})&&__smokeKeys.every(key=>views.get(key).ready)`));
  return { tested: 'local:cmd', native: 'Packaged ConPTY, Unicode, multiline input, dimensions, Ctrl+C and natural exit.', elevation: 'This fixture did not request Windows UAC.' };
}
module.exports = { localCmdSmoke, waitForLocalGeometry };
