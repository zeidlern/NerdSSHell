'use strict';
// Real UI, CSS and xterm in Chromium with a fully synthetic in-memory bridge.
// Requires an external Playwright installation; never touches saved user data.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.NERDSSHELL_PLAYWRIGHT || 'playwright');
const { appearance } = require('../ui/appearance.js');
const root = path.resolve(__dirname, '..'), output = path.resolve(process.argv[2] || path.join(root, '.local/nerdsshell-ui'));
const initial = {
  version: require('../package.json').version,
  profiles: [{ id: 'fixture', name: 'Engineering Lab', host: 'server.example', port: 22, username: 'tester', auth: 'agent', sessionMode: 'persistent', startup: 'all', autoConnect: false, scrollback: 1000, record: false }],
  workspace: { order: [], active: '', layout: 4, twoPaneOrientation: 'side-by-side', splitX: 50, splitY: 50 },
  appearance: appearance(), notifications: { enabled: true, audio: true, desktop: true, visual: true },
  sessionDefaults: { scrollback: 100000, archiveMB: 256, record: false, startup: 'all', autoConnect: true },
  actionConfiguration: { custom: [], favoritesByOS: {} }
};
function bridge(initialState) {
  const state = structuredClone(initialState), handlers = [], sessionPanes = new Map(), calls = [], shells = new Map();
  const emit = event => handlers.forEach(fn => fn(event));
  const basics = [{ id: 'system.info', title: 'System information', enabled: true, group: 'System', description: 'Show system details', risk: 'info' }, { id: 'system.disk', title: 'Disk space', enabled: true, group: 'System', description: 'Show disk usage', risk: 'info' }];
  let localSequence = 0, sequence = 0, customId = 0;
  const row = (key, name) => ({ key, profileId: 'fixture', sessionId: key, sessionToken: 'token-' + key, sessionName: name, windowId: '@0', windowName: 'Shell', windowPanes: 1, paneId: '%0', paneIndex: 0, dead: false, standard: false, local: false });
  sessionPanes.set('fixture/build', row('fixture/build', 'Build agent'));
  sessionPanes.set('fixture/logs', row('fixture/logs', 'Service logs'));
  const inject = (key, text) => emit({ type: 'output', key, epoch: 1, sequence: ++sequence, data: btoa(text) });
  async function localOpen(shellId, administrator = false) {
    calls.push(['localOpen', shellId, administrator]);
    const n = ++localSequence, cmd = shellId === 'local:cmd', profileId = shellId + (administrator ? '-admin' : '');
    const profile = { id: profileId, name: cmd ? 'Command Prompt' : 'PowerShell', local: true, sessionMode: 'standard', autoConnect: false, shellId, shellFamily: cmd ? 'cmd' : 'powershell', scrollback: 1000 };
    const pane = { ...row(profileId + '/shell-' + n, profile.name + ' ' + n), profileId, local: true, standard: true, sessionType: 'local', persistent: false, administrator, shellId, shellFamily: profile.shellFamily };
    sessionPanes.set(pane.key, pane); shells.set(profile.id, profile); return { profile, pane };
  }
  window.__fixture = { calls, state, inject, emit, cancelClose: false, failSave: false };
  window.betterssh = {
    state: async () => structuredClone(state), onEvent: fn => handlers.push(fn), workspace: async () => {},
    connect: async id => { const panes = [...sessionPanes.values()].filter(p => p.profileId === id); emit({ type: 'status', profileId: id, state: 'connected', detail: 'Connected' }); emit({ type: 'panes', profileId: id, panes }); emit({ type: 'connected', profileId: id, panes }); },
    open: async key => { const p = sessionPanes.get(key); const prompt = p.local ? p.shellFamily === 'cmd' ? 'C:\\Fixture>' : 'PS C:\\Fixture>' : 'tester@server:~$'; emit({ type: 'snapshot', key, data: btoa(p.sessionName + '\r\n' + prompt + ' '), cols: 90, rows: 25, cursorX: prompt.length + 1, cursorY: 1, alternate: false, modes: [0, 0, 0, 0, 0, 0, 1] }); },
    close: async key => { calls.push(['close', key]); if (window.__fixture.cancelClose) return false; if (sessionPanes.get(key)?.local) { sessionPanes.delete(key); emit({ type: 'standard-ended', key }); } return true; },
    end: async key => { calls.push(['end', key]); if (window.__fixture.cancelClose) return false; sessionPanes.delete(key); emit({ type: 'ended', key }); return true; },
    resize: async () => {}, ack: async () => {}, input: async (key, text) => { calls.push(['input', key, text]); inject(key, text); },
    activeSession: async key => { calls.push(['activeSession', key]); return true; }, sessionAttention: async (key, value) => calls.push(['attention', key, value]),
    paneActions: async key => { const p = sessionPanes.get(key), os = p.local ? 'Windows' : 'Ubuntu', fixture = window.__fixture.favoriteFixture?.key === key ? window.__fixture.favoriteFixture : null; return { os, title: p.sessionName, platform: { shell: p.local ? p.shellFamily : 'posix' }, actions: fixture?.actions || basics, favorites: fixture?.favorites || state.actionConfiguration.favoritesByOS[os] || ['system.info'], target: 'target-' + key }; },
    paneActionRun: async (key, request) => { calls.push(['action', key, request]); return { key, actionId: request.actionId }; },
    workbenchContext: async () => ({ targets: [{ id: 'local:pwsh', local: true, title: 'PowerShell' }, { id: 'local:cmd', local: true, title: 'Command Prompt' }], preferences: { favorites: ['system.info'] } }),
    workbenchDetect: async () => {}, localOpen: id => localOpen(id), localAdminOpen: id => localOpen(id, true),
    actionConfiguration: async () => ({ ...structuredClone(state.actionConfiguration), osTypes: ['Windows', 'Ubuntu', 'Debian', 'Fedora', 'Arch', 'Linux', 'Unknown'], defaults: ['system.info'] }),
    actionTemplates: async () => structuredClone(basics), actionPreview: async () => ({ code: 'Get-ComputerInfo' }), actionNewId: async () => 'custom.fixture-' + ++customId,
    savePreferences: async value => { calls.push(['savePreferences', structuredClone(value)]); if (window.__fixture.failSave) throw new Error('Synthetic save failure'); Object.assign(state, structuredClone(value)); return structuredClone(value); },
    copy: async () => {}, paste: async () => null, scratchpadDirty: async () => {}, scratchpadRead: async () => null, scratchpadSave: async () => null,
    fullscreen: async () => {}, inputLock: async (_key, value) => value, discover: async () => {}, deleteProfile: async () => false
  };
}
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.NERDSSHELL_UI_BROWSER ? { executablePath: process.env.NERDSSHELL_UI_BROWSER } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } }), errors = [], external = [], checks = [];
  const check = (name, value = true) => { assert.equal(value, true, name); checks.push(name); console.log(name); };
  const wait = async (predicate, argument) => { for (let attempt = 0; attempt < 150; attempt++) { if (await page.evaluate(predicate, argument)) return; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error('UI condition did not settle: ' + predicate); };
  try {
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://nerdsshell.test') { external.push(url.href); return route.abort(); }
      const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
      const type = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
      await route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(file) });
    });
    await page.addInitScript(bridge, initial);
    await page.goto('http://nerdsshell.test/ui/index.html');
    await wait(() => document.querySelector('.connection-actions button'));
    check('NerdSSHell identity and dark icon load from bundled assets', await page.evaluate(() => document.title === 'NerdSSHell' && document.querySelector('.brand-tagline').textContent === 'Built for Windows nerds with Linux problems' && document.querySelector('#brandIcon').naturalWidth === 64));
    check('Fresh UI uses the logo-blue accent', await page.evaluate(() => document.documentElement.style.getPropertyValue('--accent') === '#00aaf0'));
    await page.locator('#help').click(); await wait(() => document.querySelector('#aboutBrandIcon').naturalWidth === 512);
    check('About loads the large theme-matched mascot through bundled assets', await page.evaluate(() => document.querySelector('#aboutBrandIcon').getAttribute('src').endsWith('app-dark-512.png') && document.querySelector('#aboutBrandIcon').getBoundingClientRect().width >= 140));
    await page.screenshot({ path: path.join(output, 'about-dark.png') }); await page.locator('#closeHelp').click();
    await page.locator('#scratchpadToggle').click();
    await page.locator('#scratchText').fill('A mispelled scratchpad note $variable = 1');
    check('Scratchpad spelling is enabled and fresh text is visible before syntax painting', await page.locator('#scratchText').evaluate(node => node.spellcheck && node.lang === 'en-US' && (node.getAttribute('data-highlight') !== 'pending' || getComputedStyle(node).color !== 'rgba(0, 0, 0, 0)')));
    await wait(() => document.querySelector('#scratchText').getAttribute('data-highlight') === 'current');
    check('Scratchpad idle highlighting preserves native editing and the exact note', await page.evaluate(() => document.querySelector('#scratchText').value === 'A mispelled scratchpad note $variable = 1' && document.querySelector('#scratchHighlight').textContent === 'A mispelled scratchpad note $variable = 1\n'));
    await require('./Scratchpad-Wrap-Smoke.cjs').scratchpadWrapSmoke({
      evaluate: source => page.evaluate(source), wait: source => wait(source), check,
      screenshot: name => page.screenshot({ path: path.join(output, name + '.png') })
    });
    await page.locator('#scratchCollapse').click();
    check('Scratchpad is first and compact shell launchers keep both Administrator toggles inline', await page.evaluate(() => {
      const list = document.querySelector('.local-launcher');
      return list.firstElementChild.id === 'scratchpadToggle' && [...document.querySelectorAll('.shell-launcher')].every(row => { const a = row.querySelector('button').getBoundingClientRect(), b = row.querySelector('label').getBoundingClientRect(); return Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 2 && b.right <= row.getBoundingClientRect().right + 1; });
    }));
    check('Redundant global Actions button and bottom session bar are removed', await page.locator('#wbLaunch,#statusbar,#newSessionBottom').count() === 0);
    await page.getByRole('button', { name: 'Preferences', exact: true }).click();
    await wait(() => !document.querySelector('#savePreferences').disabled);
    for (const category of ['copy', 'terminal', 'system', 'actions', 'favorites', 'notifications', 'sessions']) {
      await page.locator('#preferenceTab-' + category).click();
      check('Preferences selects only ' + category, await page.locator('.preferences-content>.preference-section:visible').count() === 1 && await page.locator('#preferences-' + category).isVisible());
    }
    await page.locator('#preferenceTab-copy').click(); await page.locator('[name=copyOnSelect]').uncheck();
    await page.locator('#preferenceTab-notifications').click(); await page.locator('[name=notificationAudio]').uncheck();
    await page.locator('#preferenceTab-system').click(); await page.locator('#themeLight').click();
    await wait(() => document.querySelector('#brandIcon').getAttribute('src').endsWith('app-light-64.png') && document.querySelector('#brandIcon').complete);
    check('Large About artwork follows the light appearance preview', await page.locator('#aboutBrandIcon').getAttribute('src') === 'branding/app-light-512.png');
    await page.screenshot({ path: path.join(output, 'preferences-system-light.png') });
    await page.locator('#cancelPreferences').click();
    check('Cancel restores saved settings and dark branding across categories', await page.evaluate(() => __fixture.state.appearance.copyOnSelect && __fixture.state.notifications.audio && document.documentElement.style.getPropertyValue('--bg') === '#242328' && document.querySelector('#brandIcon').getAttribute('src').endsWith('app-dark-64.png')));
    await page.locator('#preferences').click(); await wait(() => !document.querySelector('#savePreferences').disabled);
    await page.locator('#preferenceTab-copy').click(); await page.locator('[name=copyOnSelect]').uncheck();
    await page.locator('#preferenceTab-notifications').click(); await page.locator('[name=notificationAudio]').uncheck();
    await page.locator('#preferenceTab-sessions').click(); await page.locator('#preferences-sessions [name=scrollback]').fill('22000');
    await page.locator('#savePreferences').click(); await wait(() => !document.querySelector('#preferencesDialog').open);
    check('Save commits all categories atomically without changing saved connections', await page.evaluate(expected => __fixture.calls.filter(c => c[0] === 'savePreferences').length === 1 && !__fixture.state.appearance.copyOnSelect && !__fixture.state.notifications.audio && __fixture.state.sessionDefaults.scrollback === 22000 && JSON.stringify(__fixture.state.profiles) === expected, JSON.stringify(initial.profiles)));
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await wait(() => document.querySelectorAll('.terminal-pane').length === 2);
    await page.locator('#localPowerShell').click(); await wait(() => document.querySelectorAll('.terminal-pane').length === 3);
    await wait(() => document.activeElement?.closest('.terminal-pane')?.dataset.paneKey.startsWith('local:pwsh'));
    check('Launching a PowerShell session transfers keyboard focus to its terminal');
    await page.locator('#localCommandAdmin').check(); await page.locator('#localCommandPrompt').click();
    await wait(() => document.querySelectorAll('.terminal-pane').length === 4 && [...document.querySelectorAll('.pane-state')].every(n => n.textContent.startsWith('Live')));
    await wait(() => document.activeElement?.closest('.terminal-pane')?.dataset.paneKey.startsWith('local:cmd'));
    check('Launching Command Prompt transfers keyboard focus from its launcher');
    check('Local PowerShell and Administrator Command Prompt share the sidebar session system', await page.evaluate(() => document.querySelectorAll('.local-connection .session-item').length === 2 && __fixture.calls.some(c => c[0] === 'localOpen' && c[1] === 'local:cmd' && c[2] === true)));
    check('Every session has a metadata-derived location badge and locals have no Disconnect control', await page.evaluate(() => [...document.querySelectorAll('.terminal-pane')].every(pane => { const local = pane.dataset.paneKey.startsWith('local:'); return pane.querySelector('.pane-location-badge').textContent === (local ? 'LOCAL' : 'REMOTE') && !!pane.querySelector('.pane-disconnect') === !local; })));
    const firstKey = 'fixture/build', first = page.locator('[data-pane-key="' + firstKey + '"]');
    await first.locator('.pane-action-select').first().selectOption('system.info');
    await wait(key => __fixture.calls.some(c => c[0] === 'action' && c[1] === key), firstKey);
    check('An Action dispatches to its owning session without creating another terminal', await page.evaluate(key => __fixture.calls.some(c => c[0] === 'action' && c[1] === key && c[2].actionId === 'system.info') && document.querySelectorAll('.terminal-pane').length === 4 && !document.querySelector('#workbenchDialog').open, firstKey));
    check('Favorites are native buttons beside a separate Configure Favorites control', await first.locator('.pane-favorites').evaluate(row => row.tagName === 'DIV' && row.getAttribute('role') === 'group' && [...row.children].every(button => button.tagName === 'BUTTON' && button.type === 'button')) && await first.locator('.pane-favorite-select').count() === 0 && await first.getByRole('button', { name: 'Configure Favorites…', exact: true }).isVisible());
    const priorFavorites = await page.evaluate(key => __fixture.calls.filter(c => c[0] === 'action' && c[1] === key).length, firstKey);
    await first.getByRole('button', { name: 'System information', exact: true }).dblclick();
    check('A native Favorite double-click dispatches once to its original session', await page.evaluate(({ key, count }) => __fixture.calls.filter(c => c[0] === 'action' && c[1] === key).length === count + 1 && document.querySelectorAll('.terminal-pane').length === 4 && !document.querySelector('#workbenchDialog').open, { key: firstKey, count: priorFavorites }));
    await first.getByRole('button', { name: 'Configure Favorites…', exact: true }).click();
    await wait(() => document.querySelector('#preferencesDialog').open && !document.querySelector('#savePreferences').disabled);
    check('Configure Favorites opens the correct Preferences category', await page.locator('#preferences-favorites').isVisible());
    await page.screenshot({ path: path.join(output, 'preferences-favorites-dark.png') });
    await page.locator('#cancelPreferences').click();
    const beforeKeys = await page.locator('.terminal-pane').evaluateAll(nodes => nodes.map(n => n.dataset.paneKey));
    for (const choice of ['1', '2-side-by-side', '2-stacked', '4']) {
      await page.locator('[data-layout-choice="' + choice + '"]').click();
      check('Layout ' + choice + ' retains every session identity', JSON.stringify(await page.locator('.terminal-pane').evaluateAll(nodes => nodes.map(n => n.dataset.paneKey))) === JSON.stringify(beforeKeys));
    }
    const beforeMove = await page.evaluate(() => slots.slice()), inputBeforeMove = await page.evaluate(() => __fixture.calls.filter(c => c[0] === 'input').length);
    await page.locator('[data-pane-key="' + beforeMove[3] + '"] .pane-move').dragTo(page.locator('[data-pane-key="' + beforeMove[0] + '"] .pane-move'));
    await wait(previous => slots[0] === previous[3] && document.activeElement.closest('.terminal-pane')?.dataset.paneKey === previous[3], beforeMove);
    check('Dragging a terminal handle swaps quadrants and focuses it without session input', await page.evaluate(({ previous, inputs }) => slots[0] === previous[3] && slots[3] === previous[0] && document.activeElement.closest('.terminal-pane')?.dataset.paneKey === previous[3] && __fixture.calls.filter(c => c[0] === 'input').length === inputs, { previous: beforeMove, inputs: inputBeforeMove }));
    await page.locator('[data-pane-key="' + beforeMove[1] + '"] .terminal-host').click();
    check('Selecting another visible terminal keeps the assigned quadrant positions', await page.evaluate(previous => slots[0] === previous[3] && slots[3] === previous[0], beforeMove));
    check('Ordinary idle SSH, PowerShell and Command Prompt shells do not request attention', await page.evaluate(() => !__fixture.calls.some(call => call[0] === 'attention' && call[2].waiting)));
    await page.locator('#tabs .tab').last().click();
    await page.evaluate(key => __fixture.inject(key, '\r\nApprove this operation? [y/N] '), firstKey);
    await wait(key => document.querySelector('[data-pane-key="' + key + '"]').classList.contains('waiting'), firstKey);
    check('A real xterm approval prompt marks the background header, tab and sidebar', await page.evaluate(() => !!document.querySelector('.terminal-pane.waiting .waiting-indicator:not([hidden])') && !!document.querySelector('#tabs .tab.waiting') && !!document.querySelector('#connections .session-item.waiting')));
    await page.screenshot({ path: path.join(output, 'workspace-dark-waiting.png') });
    await page.evaluate(key => __fixture.inject(key, '\r\nWorking again...\r\n'), firstKey);
    await wait(() => !document.querySelector('.terminal-pane.waiting'));
    check('Resumed terminal output clears waiting indicators', await page.locator('#tabs .tab.waiting,#connections .session-item.waiting').count() === 0);
    await page.locator('#sidebarToggle').click();
    check('Collapsed sidebar exposes a distinct accessible Expand Sidebar control', await page.getByRole('button', { name: 'Expand Sidebar', exact: true }).isVisible() && await page.locator('#localPowerShell .launcher-icon').isVisible());
    await page.setViewportSize({ width: 900, height: 600 });
    await page.screenshot({ path: path.join(output, 'workspace-900-collapsed.png') });
    check('Four terminals fit the narrow workspace without overflowing their panes', await page.locator('.terminal-pane').evaluateAll(nodes => nodes.every(node => { const box = node.getBoundingClientRect(), terminal = node.querySelector('.terminal-host').getBoundingClientRect(); return terminal.width > 50 && terminal.height > 30 && terminal.right <= box.right + 1 && terminal.bottom <= box.bottom + 1; })));
    await page.evaluate(async key => {
      const actions = Array.from({ length: 32 }, (_, index) => ({ id: 'synthetic.favorite.' + index, title: 'Favorite command ' + (index + 1), enabled: true }));
      __fixture.favoriteFixture = { key, actions, favorites: actions.map(action => action.id) };
      await BetterSSHPanes.refresh(views.get(key));
    }, firstKey);
    check('All 32 favorites fit a horizontally scrollable row at 900 by 600', await first.locator('.pane-favorites').evaluate(row => { const pane = row.closest('.terminal-pane').getBoundingClientRect(), box = row.getBoundingClientRect(); return row.children.length === 32 && box.width > 50 && box.right <= pane.right + 1 && row.scrollWidth > row.clientWidth && getComputedStyle(row).overflowX === 'auto'; }) && await first.getByRole('button', { name: 'Configure Favorites…', exact: true }).isVisible());
    await first.locator('.pane-favorite-button').last().focus();
    check('Keyboard focus reveals the last Favorite without overflowing its pane', await first.locator('.pane-favorites').evaluate(row => { const box = row.getBoundingClientRect(), last = row.lastElementChild.getBoundingClientRect(); return row.scrollLeft > 0 && last.left >= box.left - 1 && last.right <= box.right + 1; }));
    await page.screenshot({ path: path.join(output, 'workspace-favorites-32-900.png') });
    await page.evaluate(async key => { delete __fixture.favoriteFixture; await BetterSSHPanes.refresh(views.get(key)); }, firstKey);
    await page.locator('#sidebarToggle').click(); await page.locator('#preferences').click(); await wait(() => !document.querySelector('#savePreferences').disabled);
    await page.locator('#preferenceTab-system').click(); await page.locator('#themeLight').click();
    await page.screenshot({ path: path.join(output, 'preferences-900-light.png') });
    check('Two-pane Preferences keeps its footer and active settings reachable at 900 by 600', await page.locator('#savePreferences').isVisible() && await page.locator('#preferenceTab-notifications').isVisible() && await page.locator('#preferences-system').isVisible());
    await page.locator('#cancelPreferences').click();
    check('Browser reported no JavaScript errors or external requests', errors.length === 0 && external.length === 0);
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ result: 'PASS', scope: 'Real Chromium UI and xterm, synthetic in-memory IPC; Windows UAC/toasts are separate acceptance.', checks, errors, external }, null, 2));
    console.log('PASS: ' + checks.length + ' NerdSSHell UI checks. Screenshots: ' + output);
  } catch (error) {
    console.error(JSON.stringify({ errors, external, state: await page.evaluate(() => ({ slots, active, focus: document.activeElement?.outerHTML.slice(0, 200), notice: document.querySelector('#notice')?.textContent, calls: window.__fixture?.calls.filter(c => c[0] !== 'savePreferences').slice(-12), panes: document.querySelectorAll('.terminal-pane').length })) }, null, 2));
    await page.screenshot({ path: path.join(output, 'failure.png') }); throw error;
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
