/* global $, api, views, run, message, fit, withViewCapacity */
'use strict';
(() => {
  const aboutDialog = $('helpDialog');
  let pressedAboutBackdrop = false;
  function onAboutBackdrop(event) {
    if (event.target !== aboutDialog) return false;
    const bounds = aboutDialog.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
  }
  aboutDialog.addEventListener('pointerdown', event => { pressedAboutBackdrop = event.button === 0 && event.isPrimary !== false && onAboutBackdrop(event); });
  aboutDialog.addEventListener('pointercancel', () => { pressedAboutBackdrop = false; });
  aboutDialog.addEventListener('close', () => { pressedAboutBackdrop = false; });
  aboutDialog.addEventListener('click', event => {
    const dismiss = pressedAboutBackdrop && event.button === 0 && onAboutBackdrop(event);
    pressedAboutBackdrop = false;
    if (!dismiss) return;
    // Keep the modal inert through the complete click; never dispatch it to a
    // control underneath, and leave text-selection drags inside About alone.
    event.preventDefault(); event.stopPropagation(); aboutDialog.close();
  });
  $('sidebarToggle').onclick = () => {
    const collapsed = $('connectionSidebar').classList.toggle('collapsed');
    $('sidebarToggle').textContent = collapsed ? '»' : '‹';
    $('sidebarToggle').setAttribute('aria-expanded', String(!collapsed));
    $('sidebarToggle').setAttribute('aria-label', collapsed ? 'Expand Sidebar' : 'Collapse Sidebar');
    $('sidebarToggle').title = collapsed ? 'Expand Sidebar' : 'Collapse Sidebar';
    requestAnimationFrame(() => { for (const v of views.values()) fit(v); });
  };
  async function launchLocal(buttonId, toggleId, family) {
    const launcher = $(buttonId);
    if (launcher.disabled) return;
    const administrator = $(toggleId).checked;
    launcher.disabled = true;
    try { await withViewCapacity(async release => {
      const context = await api.workbenchContext(), shells = context.targets.filter(t => t.local);
      const selected = family === 'cmd' ? shells.find(t => t.id === 'local:cmd')
        : shells.find(t => t.id === 'local:pwsh') || shells.find(t => t.id === 'local:powershell');
      if (!selected) throw new Error(`No supported ${family === 'cmd' ? 'Command Prompt' : 'PowerShell'} installation was found.`);
      const result = administrator ? await api.localAdminOpen(selected.id) : await api.localOpen(selected.id);
      release();
      if (result?.cancelled) message('Administrator launch cancelled. No session was opened.');
      else if (result) await window.NerdSSHellWorkbench.acceptResult(result);
    });
    } finally { launcher.disabled = false; }
  }
  $('localPowerShell').onclick = () => run(launchLocal('localPowerShell', 'localAdmin', 'powershell'));
  $('localCommandPrompt').onclick = () => run(launchLocal('localCommandPrompt', 'localCommandAdmin', 'cmd'));
})();
