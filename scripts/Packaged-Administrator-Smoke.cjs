'use strict';
const path = require('node:path');
const { PSREADLINE_ASSERTION_COMMANDS } = require('./PSReadLine-Assertion.cjs');
// Opt-in native UAC acceptance in the disposable packaged loopback harness.
// Windows owns consent: approve the first two prompts and cancel the third.
// Fixed shell IDs and harmless local commands never target existing sessions.
async function administratorSmoke({ evaluate, wait, check, screenshot }) {
  const before = await evaluate('views.size');
  const siblings = '__smokeKeys.every(k=>views.get(k).ready&&__smokeTerminalText(views.get(k)).includes(__smokeBanners.get(k)))';
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  // The rail prefers PS7 when installed. Use the same production IPC and result
  // handler with the fixed PS5 ID so this acceptance actually covers WinPS 5.1.
  async function launch(shell, label, number, cancel = false) {
    console.log(`UAC ${number}/3: ${cancel ? 'CANCEL' : 'APPROVE'} the Windows prompt for ${label}. Consent is never automated.`);
    await evaluate(`(()=>{
      const toggle=${shell === 'local:cmd' ? "document.getElementById('localCommandAdmin')" : "document.getElementById('localPowerShellAdmin')||document.getElementById('localAdmin')"};
      if(!toggle)throw Error('Missing administrator launcher switch');
      toggle.checked=true;
      window.__smokeAdministrator={done:false,cancelled:false,key:null,error:null};
      Promise.resolve().then(()=>api.localAdminOpen(${JSON.stringify(shell)})).then(async result=>{
        if(result?.cancelled){__smokeAdministrator.cancelled=true;}
        else if(result?.pane){await BetterSSHWorkbench.acceptResult(result);__smokeAdministrator.key=result.pane.key;}
        else throw Error('Administrator launch returned no result');
      }).catch(error=>{__smokeAdministrator.error=String(error.message||error);}).finally(()=>{__smokeAdministrator.done=true;});
      return true;
    })()`);
    const deadline = Date.now() + 180000;
    let result;
    do {
      result = await evaluate('({...__smokeAdministrator})');
      if (result.done) break;
      await delay(200);
    } while (Date.now() < deadline);
    if (!result.done) throw new Error(label + ': Windows consent/startup did not finish within 180 seconds. No retry was attempted.');
    if (result.error) throw new Error(label + ': ' + result.error);
    if (cancel) {
      check('UAC cancellation returns the production cancelled result without a console', result.cancelled === true && result.key === null);
      return result;
    }
    if (result.cancelled || !result.key) throw new Error(label + ': Windows consent was cancelled. No retry was attempted.');
    await wait(`views.get(${JSON.stringify(result.key)})?.ready===true`, label + ': embedded console did not become ready.');
    return result.key;
  }
  function consoleFor(key) {
    const k = JSON.stringify(key);
    return { k, input: script => evaluate(`api.input(${k},${JSON.stringify(script + '\r')})`),
      has: text => `__smokeTerminalText(views.get(${k})).includes(${JSON.stringify(text)})` };
  }
  async function splitSize(k) {
    await evaluate(`active=${k}; $('layoutSideBySide').click(); true`);
    await delay(300); // Let the actual debounced fit/ConPTY resize finish.
    await evaluate(`views.get(${k}).render.then(()=>true)`);
    return evaluate(`({cols:views.get(${k}).terminal.cols,rows:views.get(${k}).terminal.rows})`);
  }
  async function closeNatural(k, final) {
    await wait(`!views.get(${k}).ready&&__smokeTerminalText(views.get(${k})).includes(${JSON.stringify(final)})`, 'Administrator natural exit lost final output or did not end.');
    await evaluate(`closeView(${k})`);
    check('Administrator natural exit removes only its owned view and retains loopback siblings', await evaluate(`views.size===${before}&&${siblings}`));
  }
  try {
    const ps = consoleFor(await launch('local:powershell', 'Windows PowerShell 5.1', 1));
    check('Administrator PowerShell is one nonpersistent LOCAL PS5 view', await evaluate(`(()=>{const v=views.get(${ps.k}),p=v.pane;return views.size===${before + 1}&&p.local&&p.administrator&&p.profileId==='local:powershell-admin'&&p.shellId==='local:powershell'&&p.shellFamily==='powershell'&&p.persistent===false&&v.wrapper.querySelector('.pane-location-badge').textContent==='LOCAL'&&v.wrapper.textContent.includes('Administrator')&&!v.files;})()`));
    await wait(`/PS [^\\r\\n]*?> /.test(__smokeTerminalText(views.get(${ps.k})))`, 'Administrator PowerShell prompt did not finish its fixed bootstrap.');
    await ps.input("Write-Output ('ADMIN_PS_MAJOR_' + $PSVersionTable.PSVersion.Major); Write-Output ('ADMIN_PS_TOKEN_' + ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))");
    await wait(`${ps.has('ADMIN_PS_MAJOR_5')}&&${ps.has('ADMIN_PS_TOKEN_True')}`, 'Administrator PowerShell did not report PS5 and an administrator token.');
    check('Actual PS5 process reports an administrator token');
    await ps.input("Write-Output ('ADMIN_PS_UNICODE_' + 'é漢字😀')");
    await wait(ps.has('ADMIN_PS_UNICODE_é漢字😀'), 'Administrator PowerShell Unicode output was missing.');
    for (const [index, command] of PSREADLINE_ASSERTION_COMMANDS.entries()) {
      await ps.input(command + `Write-Output ('ADMIN_PS_TRUST_STEP_' + '${index}')`);
      await wait(ps.has('ADMIN_PS_TRUST_STEP_' + index), 'Administrator PSReadLine inspection did not finish step ' + index + '.');
    }
    await ps.input("Write-Output ('ADMIN_PS_TRUSTED_' + ($fixtureAvailable -and $fixtureSyntax)); Write-Output ('ADMIN_PS_HISTORY_' + (PSReadLine\\Get-PSReadLineOption).HistorySaveStyle)");
    await wait(`${ps.has('ADMIN_PS_TRUSTED_True')}&&${ps.has('ADMIN_PS_HISTORY_SaveNothing')}`, 'Administrator PS5 did not load trusted Windows PSReadLine with SaveNothing.');
    check('Administrator PS5 loads trusted Windows PSReadLine, uses SaveNothing and accepts Unicode');
    const psSize = await splitSize(ps.k);
    await ps.input("Write-Output ('ADMIN_PS_SIZE_' + $Host.UI.RawUI.WindowSize.Width + 'x' + $Host.UI.RawUI.WindowSize.Height)");
    await wait(ps.has(`ADMIN_PS_SIZE_${psSize.cols}x${psSize.rows}`), 'Administrator PowerShell dimensions did not follow the split layout.');
    await evaluate("$('layoutOne').click(); true"); await delay(300);
    await ps.input("Write-Output ('ADMIN_PS_AFTER_' + 'RESIZE')");
    await wait(ps.has('ADMIN_PS_AFTER_RESIZE'), 'Administrator PowerShell input failed after pane growth.');
    check('Administrator PS5 follows actual split resize and accepts fresh input after growth');
    await screenshot('administrator-powershell');
    check('Loopback shells retain their identities during administrator PS5', await evaluate(siblings));
    await ps.input("Write-Output ('ADMIN_PS_FINAL_' + 'OUTPUT'); exit");
    await closeNatural(ps.k, 'ADMIN_PS_FINAL_OUTPUT');

    const cmd = consoleFor(await launch('local:cmd', 'Command Prompt', 2));
    check('Administrator CMD is one nonpersistent LOCAL CMD view', await evaluate(`(()=>{const v=views.get(${cmd.k}),p=v.pane;return views.size===${before + 1}&&p.local&&p.administrator&&p.profileId==='local:cmd-admin'&&p.shellId==='local:cmd'&&p.shellFamily==='cmd'&&p.persistent===false&&v.wrapper.querySelector('.pane-location-badge').textContent==='LOCAL'&&v.wrapper.textContent.includes('Administrator')&&!v.files;})()`));
    await wait(`/(?:^|[\\r\\n])[A-Za-z]:\\\\[^\\r\\n]*>\\s*$/.test(__smokeTerminalText(views.get(${cmd.k})))`, 'Administrator CMD prompt did not appear.');
    const fixedPowerShell = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (!path.win32.isAbsolute(fixedPowerShell) || /[%!"&|<>^]/.test(fixedPowerShell)) throw new Error('Unsafe Windows PowerShell path for the read-only CMD token inspection.');
    await cmd.input(`"${fixedPowerShell}" -NoLogo -NoProfile -NonInteractive -Command "Write-Output ('ADMIN_CMD_TOKEN_'+([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))"`);
    await wait(cmd.has('ADMIN_CMD_TOKEN_True'), 'Administrator CMD did not inherit an administrator token.');
    await cmd.input('set "NERDSSH_ADMIN_VALUE=one"\recho ADMIN_CMD_VALUE_%NERDSSH_ADMIN_VALUE%\rset "NERDSSH_ADMIN_UNICODE=é漢字😀"\recho ADMIN_CMD_UNICODE_%NERDSSH_ADMIN_UNICODE%\rfor %i in (1 2) do (\recho ADMIN_CMD_LOOP_%i\r)');
    for (const marker of ['ADMIN_CMD_VALUE_one', 'ADMIN_CMD_UNICODE_é漢字😀', 'ADMIN_CMD_LOOP_1', 'ADMIN_CMD_LOOP_2']) await wait(cmd.has(marker), 'Administrator CMD failed to render ' + marker + '.');
    check('Actual administrator CMD accepts multiline commands, Unicode and grouped input');
    const cmdSize = await splitSize(cmd.k);
    await cmd.input('mode con');
    await wait(`(()=>{const text=__smokeTerminalText(views.get(${cmd.k}));return /Columns:\\s+${cmdSize.cols}(?!\\d)/.test(text)&&/Lines:\\s+${cmdSize.rows}(?!\\d)/.test(text);})()`, 'Administrator CMD dimensions did not follow the split layout.');
    await evaluate("$('layoutOne').click(); true"); await delay(300);
    await cmd.input('echo ADMIN_CMD_AFTER_RESIZE_%NERDSSH_ADMIN_VALUE%');
    await wait(cmd.has('ADMIN_CMD_AFTER_RESIZE_one'), 'Administrator CMD did not accept fresh input after pane growth.');
    check('Administrator CMD follows actual split resize and accepts fresh input after growth');
    await screenshot('administrator-command-prompt');
    check('Loopback shells retain their identities during administrator CMD', await evaluate(siblings));
    await cmd.input('echo ADMIN_CMD_TAIL_%NERDSSH_ADMIN_VALUE% & exit');
    await closeNatural(cmd.k, 'ADMIN_CMD_TAIL_one');

    const keys = await evaluate('({views:[...views.keys()].sort(),panes:[...panes.keys()].sort()})');
    const cancelled = await launch('local:powershell', 'Windows PowerShell cancellation check', 3, true);
    await wait(`JSON.stringify([...views.keys()].sort())===${JSON.stringify(JSON.stringify(keys.views))}&&JSON.stringify([...panes.keys()].sort())===${JSON.stringify(JSON.stringify(keys.panes))}`, 'UAC cancellation created a pane.');
    check('Cancelled UAC creates zero panes, leaves the app responsive and preserves loopback shells', await evaluate(`views.size===${before}&&![...views.values()].some(v=>v.ready&&v.pane.administrator)&&${siblings}&&1+1===2`));
    const cancellationCounts = await evaluate(`({views:views.size,panes:panes.size,siblingsPreserved:${siblings}})`);
    return { powershell: 'Passed actual UAC PS5 administrator token, trusted Windows PSReadLine/SaveNothing, Unicode, resize and natural exit.',
      commandPrompt: 'Passed actual UAC CMD administrator token, multiline/grouped commands, Unicode, resize and natural exit.',
      cancellation: { result: cancelled.cancelled, createdViews: cancellationCounts.views - keys.views.length,
        createdPanes: cancellationCounts.panes - keys.panes.length, siblingsPreserved: cancellationCounts.siblingsPreserved },
      consent: 'Windows RunAs requested real consent; first two prompts approved and third cancelled by the user. Alternate-account consent remains unverified.' };
  } finally {
    try { await evaluate(`(()=>{for(const id of ['localPowerShellAdmin','localAdmin','localCommandAdmin']){const toggle=document.getElementById(id);if(toggle)toggle.checked=false;}delete window.__smokeAdministrator;return true;})()`); } catch {}
  }
}
module.exports = { administratorSmoke };
