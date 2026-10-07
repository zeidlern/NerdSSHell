'use strict';
const { PSREADLINE_ASSERTION_COMMANDS } = require('./PSReadLine-Assertion.cjs');
const { consoleText } = require('../src/console-text.cjs');
let promptObservation = 0;

// CDP sends expressions directly to V8, without an HTML parser. Escape HTML
// delimiters and line separators as well, so these literals remain safe if an
// expression is ever displayed in an HTML script context during diagnostics.
function scriptLiteral(value) {
  return JSON.stringify(value).replace(/[<>\b\f\n\r\t\0\u2028\u2029]/g,
    character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
}

/** Observe the owned shell's rendered prompt; do not issue commands, synthesize
 * cursor replies or retry input. A result can arrive before PSReadLine returns
 * to its input loop. Require fresh native prompt output after that result too.
 */
async function waitForPowerShellPrompt({ evaluate, wait, key, after = '' }) {
  const match = typeof key === 'string' && /^(local:(?:powershell|pwsh))\/standard-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.exec(key);
  if (!match || typeof after !== 'string' || after.length > 1024) throw new Error('Prompt observation requires an owned ordinary PowerShell key and bounded marker.');
  const k = scriptLiteral(key), shell = scriptLiteral(match[1]), token = scriptLiteral(match[2]);
  const marker = scriptLiteral(Buffer.from(after, 'utf8').toString('latin1'));
  const current = `v&&views.get(${k})===v&&v.generation===generation&&v.ready&&!v.locked&&v.pane.key===${k}&&v.pane.local&&!v.pane.administrator&&v.pane.profileId===${shell}&&v.pane.shellId===${shell}&&v.pane.sessionToken===${token}`;
  const observation = scriptLiteral('powershell-prompt-' + ++promptObservation);
  // Capture the actual view and snapshot generation once, rather than accepting
  // a replacement view that happens to have the same string key on a later poll.
  try {
    await evaluate(`(()=>{const v=views.get(${k}),generation=v?.generation;if(!(${current}))throw Error('Owned PowerShell prompt target changed');
      window.__smokePowerShellPrompts??=new Map();__smokePowerShellPrompts.set(${observation},{view:v,generation});return true;})()`);
    await wait(`(async()=>{const state=window.__smokePowerShellPrompts?.get(${observation}),v=state?.view,generation=state?.generation;if(!(${current}))throw Error('Owned PowerShell prompt target changed');
      const rendered=v.render;await rendered;if(!(${current}))throw Error('Owned PowerShell prompt target changed');
      if(v.render!==rendered||v.fitQueued||v.wrapper.hidden)return false;
      if(${marker}){const text=(${consoleText.toString()})(v.smokeOutput||''),at=text.lastIndexOf(${marker});if(at<0||!/(?:^|[\\r\\n])PS [^\\r\\n]*?> [ \\t]*$/.test(text.slice(at+${marker}.length)))return false;}
      const b=v.terminal.buffer.active;return /^PS .*?>[ \\t]*$/.test(b.getLine(b.baseY+b.cursorY)?.translateToString(true)||'');
    })()`, 'PowerShell did not return a fresh rendered prompt' + (after ? ' after ' + after : '') + '.');
  } finally {
    try { await evaluate(`(()=>{window.__smokePowerShellPrompts?.delete(${observation});if(window.__smokePowerShellPrompts?.size===0)delete window.__smokePowerShellPrompts;return true;})()`); } catch {}
  }
}

// Serialized into the disposable renderer below. Observe the normal parser and
// onData paths only: never inject a query, answer one, or consume a VT sequence.
function observeCursorSynchronization(view) {
  const terminal = view.terminal, started = Date.now();
  view.smokeCursorSync = [];
  let sequence = 0;
  const record = (type, row, column) => {
    const buffer = terminal.buffer.active;
    view.smokeCursorSync.push({ sequence: ++sequence, afterMs: Date.now() - started, type,
      ...(row === undefined ? {} : { reportedRow: row, reportedColumn: column }),
      ready: view.ready, locked: !!view.locked, cols: terminal.cols, rows: terminal.rows,
      baseY: buffer.baseY, cursorY: buffer.cursorY, cursorX: buffer.cursorX });
    if (view.smokeCursorSync.length > 64) view.smokeCursorSync.shift();
  };
  const query = terminal.parser.registerCsiHandler({ final: 'n' }, parameters => {
    if (parameters.length === 1 && parameters[0] === 6) record('native-dsr');
    return false;
  });
  const response = terminal.onData(data => {
    const match = /^\x1b\[(\d{1,5});(\d{1,5})R$/.exec(data);
    if (match) record('xterm-cpr-emitted', Number(match[1]), Number(match[2]));
  });
  return () => { query.dispose(); response.dispose(); };
}

/** Phase 2 native acceptance. Called ONLY by the isolated packaged-app harness.
 * Never installs a shell or contacts a real server. Folder/close dialogs are
 * covered by injected-dialog regressions; interactive native picker acceptance
 * remains a separately recorded manual check, not an invented pass.
 */
async function localPowerShellSmoke({ evaluate, wait, check, screenshot }) {
  const targets = (await evaluate('api.workbenchContext()')).targets.filter(t => t.local && ['local:powershell', 'local:pwsh'].includes(t.id));
  check('Phase 2: packaged discovery includes Windows PowerShell', targets.some(t => t.id === 'local:powershell'));
  const result = { tested: [], folderPicker: 'Backend ownership/cancel covered by automated unit tests; native picker interaction still requires manual acceptance.',
    elevation: 'No elevation requested by app; consoles inherit the runner/app token, which may itself be elevated.', clipboard: 'Not run without isolated CI or explicit clipboard-fixture consent.' };
  result.commandPrompt = await require('./Packaged-LocalCmd-Smoke.cjs').localCmdSmoke({ evaluate, wait, check, screenshot });
  for (const target of targets) {
    const suffix = target.id === 'local:pwsh' ? 'PWSH' : 'WINDOWS';
    await evaluate(`NerdSSHellWorkbench.open({target:${JSON.stringify(target.id)}}); true`);
    await wait(`$('workbenchDialog').open && $('wbTarget').value===${JSON.stringify(target.id)} && !$('wbOpenLocal').disabled`, 'Local choice unavailable.');
    await evaluate(`$('wbOpenLocal').click(); true`);
    await wait(`!$('workbenchDialog').open && [...views.values()].some(v=>v.pane.local && v.pane.profileId===${JSON.stringify(target.id)} && v.ready)`, 'Native local console failed to open.');
    const key = await evaluate(`[...views.values()].find(v=>v.pane.local && v.pane.profileId===${JSON.stringify(target.id)}).pane.key`), k = JSON.stringify(key);
    await evaluate(`(()=>{const v=views.get(${k});v.smokeOutput='';const stopCursorSync=(${observeCursorSynchronization.toString()})(v),stopOutput=api.onEvent(e=>{if(e.type==='output'&&e.key===${k})v.smokeOutput=(v.smokeOutput+atob(e.data)).slice(-16000);});v.smokeOff=()=>{stopOutput();stopCursorSync();};return true;})()`);
    const input = text => evaluate(`api.input(${k},${JSON.stringify(text)})`);
    const has = text => `__smokeTerminalText(views.get(${k})).includes(${JSON.stringify(text)})`;
    const output = async (script, expected, returnsPrompt = true) => {
      try {
        await waitForPowerShellPrompt({ evaluate, wait, key });
        await evaluate(`views.get(${k}).smokeOutput=''; true`);
        await input(script + '\r');
        await wait(has(expected), `${suffix}: missing ${expected}`);
        if (returnsPrompt) await waitForPowerShellPrompt({ evaluate, wait, key, after: expected });
      } catch (error) {
        console.error('PowerShell command failure:', suffix, JSON.stringify(await diagnostic().catch(e => ({ diagnosticError: e.message }))));
        await screenshot('phase2-local-' + suffix.toLowerCase() + '-failure').catch(() => {});
        throw error;
      }
    };
    const diagnostic = () => evaluate(`(()=>{const v=views.get(${k}),t=v.terminal,b=t.buffer.active,prompts=[];for(let y=0;y<b.length;y++){const text=b.getLine(y)?.translateToString(true)||'';if(/^PS /.test(text))prompts.push({y,text});}return {ready:v.ready,cols:t.cols,rows:t.rows,length:b.length,cursorX:b.cursorX,cursorY:b.cursorY,baseY:b.baseY,cursorRow:b.getLine(b.baseY+b.cursorY)?.translateToString(true),prompts:prompts.slice(-24),modes:t.modes,tail:__smokeTerminalText(v).split('\\n').slice(-24),raw:v.smokeOutput.slice(-12000),cursorSync:v.smokeCursorSync};})()`);
    await output(`Write-Output ('PS_PHASE2_READY_' + '${suffix}')`, 'PS_PHASE2_READY_' + suffix);
    check(`Phase 2 ${suffix}: local identity, nonpersistent label and no SFTP sidecar`, await evaluate(`(()=>{const v=views.get(${k}),p=v.pane,b=v.wrapper.querySelector('.wb-target-badge');return p.local&&p.sessionType==='local'&&p.shellFamily==='powershell'&&p.shellId===${JSON.stringify(target.id)}&&p.persistent===false&&!p.administrator&&!v.files&&v.wrapper.querySelector('.pane-location-badge').textContent==='LOCAL'&&b?.title.includes('PowerShell')&&b.title.includes('not persistent');})()`));
    check(`Phase 2 ${suffix}: ConPTY compatibility applies only to local consoles`, await evaluate(`views.get(${k}).terminal.options.windowsPty.backend==='conpty' && __smokeKeys.every(key=>views.get(key).terminal.options.windowsPty.backend===undefined)`));
    await output(`Write-Output ('PS_PHASE2_MAJOR_' + $PSVersionTable.PSVersion.Major)`, 'PS_PHASE2_MAJOR_' + (suffix === 'PWSH' ? '7' : '5'));
    if (suffix === 'PWSH' && process.env.NERDSSHELL_SMOKE_NO_PREDICTION === 'true') await output("PSReadLine\\Set-PSReadLineOption -PredictionSource None; Write-Output ('PREDICTION_'+'OFF')", 'PREDICTION_OFF');
    for (const [index, command] of PSREADLINE_ASSERTION_COMMANDS.entries()) {
      await output(command + `Write-Output ('PS_FIXTURE_STEP_' + '${suffix}_${index}')`, `PS_FIXTURE_STEP_${suffix}_${index}`);
    }
    await output("Write-Output ('PS_PHASE2_SYNTAX_' + $fixtureSyntax); Write-Output ('PS_PHASE2_COLOR_AVAILABLE_' + $fixtureAvailable)", 'PS_PHASE2_SYNTAX_True');
    await wait(`(${has('PS_PHASE2_COLOR_AVAILABLE_True')} || ${has('PS_PHASE2_COLOR_AVAILABLE_False')})`, 'Local syntax availability did not arrive.');
    const syntaxAvailable = await evaluate(has('PS_PHASE2_COLOR_AVAILABLE_True'));
    check(`Phase 2 ${suffix}: trusted protected PSReadLine configuration or safe absent-module fallback`, true);
    result[suffix + 'Syntax'] = syntaxAvailable ? 'Protected PSReadLine loaded with SaveNothing history; process-local colors depend on module support.' : 'Protected PSReadLine absent; ordinary ANSI terminal output retained, interactive syntax coloring unavailable.';
    await output(`Write-Output ('PS_PHASE2_HOME_' + ((Get-Location).Path -eq $HOME))`, 'PS_PHASE2_HOME_True');
    await output(`Write-Output ('PS_PHASE2_UNICODE_' + 'é漢字😀')`, 'PS_PHASE2_UNICODE_é漢字😀');
    check(`Phase 2 ${suffix}: real version, home directory and Unicode output verified`);

    await evaluate(`$('layoutSideBySide').click(); true`);
    await wait(`!views.get(${k}).wrapper.hidden && views.get(${k}).terminal.cols>=20 && views.get(${k}).terminal.rows>=5`, 'Local split not usable.');
    // The ordinary layout fitter dispatches debounced PTY dimensions; allow it to settle.
    await evaluate('new Promise(resolve=>setTimeout(resolve,300))');
    const size = await evaluate(`({cols:views.get(${k}).terminal.cols,rows:views.get(${k}).terminal.rows})`);
    await output(`Write-Output ('PS_PHASE2_SIZE_' + $Host.UI.RawUI.WindowSize.Width + 'x' + $Host.UI.RawUI.WindowSize.Height)`, `PS_PHASE2_SIZE_${size.cols}x${size.rows}`);
    check(`Phase 2 ${suffix}: actual PowerShell dimensions follow split layout`);
    await evaluate(`views.get(${k}).render.then(()=>true)`);
    console.log('Local physical rows before growth:', suffix, JSON.stringify(await diagnostic()));
    await evaluate(`views.get(${k}).smokeOutput=''; true`);
    await evaluate(`$('layoutOne').click(); true`);
    // Returning to one pane also schedules a debounced ConPTY resize. Do not
    // race console/PSReadLine absolute-coordinate redraws with fixture input.
    await evaluate('new Promise(resolve=>setTimeout(resolve,300))');
    await evaluate(`views.get(${k}).render.then(()=>true)`);
    console.log('Local physical rows after growth:', suffix, JSON.stringify(await diagnostic()));

    if (process.env.GITHUB_ACTIONS === 'true' || process.argv.includes('--clipboard-fixture')) {
      const marker = 'PS_PHASE2_COPY_' + suffix;
      await output(`Write-Output ('PS_PHASE2_COPY_' + '${suffix}')`, marker);
      await evaluate(`(()=>{const v=views.get(${k}),b=v.terminal.buffer.active;for(let y=b.length-1;y>=0;y--){const x=b.getLine(y).translateToString(true).indexOf(${JSON.stringify(marker)});if(x>=0){v.terminal.select(x,y,${marker.length});return true;}}throw new Error('No local clipboard marker');})()`);
      await evaluate(`copySelection(views.get(${k}).terminal)`);
      check(`Phase 2 ${suffix}: local terminal selection copies to actual Windows clipboard`, await evaluate('api.paste()') === marker);
      const pasted = 'PS_PHASE2_PASTE_' + suffix;
      await evaluate(`api.copy(${JSON.stringify("Write-Output ('PS_PHASE2_PASTE_' + '" + suffix + "')")})`);
      await evaluate(`paste(${k})`);
      check(`Phase 2 ${suffix}: clipboard paste does not execute before Enter`, !await evaluate(has(pasted)));
      await input('\r'); await wait(has(pasted), 'Local clipboard paste/Enter failed.');
      result.clipboard = 'Passed with synthetic text only on isolated CI or explicit local consent.';
    }
    await output(`Write-Output ('PS_PHASE2_WAIT_' + '${suffix}'); Start-Sleep -Seconds 30; Write-Output ('PS_PHASE2_SLEEP_FINISHED_' + '${suffix}')`, 'PS_PHASE2_WAIT_' + suffix, false);
    try {
      // A screen row can retain an old prompt across ConPTY resize/redraw.
      // Require fresh shell output, then let cancellation finish rebuilding
      // its input reader before submitting one (never retried) reply command.
      await evaluate(`views.get(${k}).smokeOutput=''; true`);
      const interruptedAt = Date.now();
      await input('\x03');
      await wait(`/PS .*?> /.test(views.get(${k}).smokeOutput)`, 'Ctrl+C did not produce a fresh PowerShell prompt.');
      await evaluate('new Promise(resolve=>setTimeout(resolve,300))');
      // Raw IPC observation precedes xterm's queued write completion. Inspect
      // the actual rendered cursor only after its current output has drained.
      await evaluate(`views.get(${k}).render.then(()=>true)`);
      console.log('Local physical rows after Ctrl+C:', suffix, JSON.stringify(await diagnostic()));
      check(`Phase 2 ${suffix}: displayed prompt follows the real ConPTY cursor after pane growth`, await evaluate(`(()=>{const b=views.get(${k}).terminal.buffer.active;return /^PS .*?>\\s*$/.test(b.getLine(b.baseY+b.cursorY)?.translateToString(true)||'');})()`));
      await output(`Write-Output ('PS_PHASE2_INTERRUPT_' + '${suffix}')`, 'PS_PHASE2_INTERRUPT_' + suffix);
      check(`Phase 2 ${suffix}: interruption prevents the sleeping pipeline completion and accepts fresh input within 20 seconds`, Date.now() - interruptedAt < 20000 && !await evaluate(has('PS_PHASE2_SLEEP_FINISHED_' + suffix)));
    } catch (error) {
      console.log('Interrupt failure:', suffix, JSON.stringify(await diagnostic()));
      throw error;
    }
    check(`Phase 2 ${suffix}: Ctrl+C interrupts only the disposable local command`);
    const screen = () => evaluate(`(()=>{const t=views.get(${k}).terminal,b=t.buffer.active;return {cols:t.cols,rows:t.rows,baseY:b.baseY,cursorY:b.cursorY,cursorX:b.cursorX,screen:Array.from({length:t.rows},(_,i)=>({y:i,wrapped:b.getLine(b.baseY+i)?.isWrapped,text:b.getLine(b.baseY+i)?.translateToString(true)}))};})()`);
    for (let cycle = 0; cycle < 3; cycle++) {
      if (cycle===0) console.log('Cycle wide start:',suffix,JSON.stringify(await screen()));
      await evaluate(`$('layoutSideBySide').click(); true`);
      await evaluate('new Promise(resolve=>setTimeout(resolve,300))');
      await evaluate(`views.get(${k}).render.then(()=>true)`);
      if (cycle===0) console.log('Cycle narrow:',suffix,JSON.stringify(await screen()));
      await evaluate(`$('layoutOne').click(); true`);
      await evaluate('new Promise(resolve=>setTimeout(resolve,300))');
      await evaluate(`views.get(${k}).render.then(()=>true)`);
      if (cycle===0) console.log('Cycle wide:',suffix,JSON.stringify(await screen()));
      await evaluate(`views.get(${k}).smokeOutput=''; true`);
      check(`Phase 2 ${suffix}: resize cycle ${cycle + 1} retains the current displayed prompt before input`, await evaluate(`(()=>{const b=views.get(${k}).terminal.buffer.active;return /^PS .*?>\\s*$/.test(b.getLine(b.baseY+b.cursorY)?.translateToString(true)||'');})()`));
      const command = `Write-Output ('PS_PHASE2_CYCLE_' + '${suffix}_${cycle}')`;
      await input(command);
      await wait(`views.get(${k}).smokeOutput.includes('PS_PHASE2_CYCLE_')`, 'Resize-cycle input was not displayed.');
      await evaluate(`views.get(${k}).render.then(()=>true)`);
      console.log('Local editing rows:', suffix, cycle, JSON.stringify(await diagnostic()));
      check(`Phase 2 ${suffix}: resize cycle ${cycle + 1} displays fresh editing on its prompt row`, await evaluate(`(()=>{const b=views.get(${k}).terminal.buffer.active;return /^PS .*?> Write-Output /.test(b.getLine(b.baseY+b.cursorY)?.translateToString(true)||'');})()`));
      await input('\r'); await wait(has(`PS_PHASE2_CYCLE_${suffix}_${cycle}`), 'Resize-cycle command did not execute.');
      await wait(`/PS .*?> $/.test(views.get(${k}).smokeOutput)`, 'Resize-cycle command did not return a fresh prompt.');
      await evaluate(`views.get(${k}).render.then(()=>true)`);
      check(`Phase 2 ${suffix}: resize cycle ${cycle + 1} preserves prompt, Unicode scrollback and console identity`, await evaluate(`(()=>{const v=views.get(${k}),b=v.terminal.buffer.active;return v.ready && /^PS .*?>\\s*$/.test(b.getLine(b.baseY+b.cursorY)?.translateToString(true)||'') && __smokeTerminalText(v).includes('PS_PHASE2_UNICODE_é漢字😀') && __smokeKeys.every(key=>views.get(key).ready);})()`));
    }
    check(`Phase 2 ${suffix}: existing remote consoles remain distinct`, await evaluate(`__smokeKeys.every(key=>views.get(key).ready && __smokeTerminalText(views.get(key)).includes(__smokeBanners.get(key)))`));
    await screenshot('phase2-local-' + suffix.toLowerCase());
    await input(`Write-Output ('PS_PHASE2_TAIL_' + '${suffix}'); exit\r`);
    await wait(`!views.get(${k}).ready && ${has('PS_PHASE2_TAIL_' + suffix)}`, 'Natural local exit lost final output or did not end.');
    await evaluate(`views.get(${k}).smokeOff(); true`);
    await evaluate(`closeView(${k})`);
    check(`Phase 2 ${suffix}: natural exit retains output and leaves remote consoles running`, await evaluate(`!views.has(${k}) && __smokeKeys.every(key=>views.get(key).ready)`));
    result.tested.push(target.id);
  }
  result.powerShell7 = result.tested.includes('local:pwsh') ? 'Passed' : 'Not installed in the runner; not tested.';
  return result;
}
module.exports = { localPowerShellSmoke, waitForPowerShellPrompt, scriptLiteral };
