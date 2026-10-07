'use strict';
// Isolated Windows/Electron spelling acceptance. Hidden window, synthetic notes,
// disposable user data, no shells, and all external requests are intercepted.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
if (!process.versions.electron) {
  const { spawn } = require('node:child_process');
  const output = path.resolve(process.argv[2] || path.join(__dirname, '..', '.local', 'scratchpad-spelling-smoke'));
  const child = spawn(require('electron'), [__filename, output], { windowsHide: true, stdio: 'inherit' });
  child.on('error', error => { console.error(error); process.exitCode = 1; });
  child.on('exit', code => {
    if (code !== 0) { process.exitCode = 1; return; }
    try {
      const report = JSON.parse(fs.readFileSync(path.join(output, 'report.json'), 'utf8'));
      const log = JSON.parse(fs.readFileSync(path.join(output, 'net-log.json'), 'utf8'));
      report.remoteURLs = [...new Set(log.events.flatMap(event => Object.values(event.params || {}).filter(value => typeof value === 'string' && /^https?:\/\//.test(value))))];
      assert.deepEqual(report.remoteURLs, [], 'The complete process net log must contain no external HTTP or HTTPS URLs.');
      report.checks.push('Complete process net log contains no external HTTP or HTTPS request URLs');
      fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
      const resolved = path.resolve(report.disposableDataDirectory);
      if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('nerdsshell-spelling-')) fs.rmSync(resolved, { recursive: true, force: true });
      console.log(JSON.stringify(report));
    } catch (error) { console.error(error); process.exitCode = 1; }
  });
  return;
}
const { app, BrowserWindow, protocol, session } = require('electron');
const { configureScratchpadSpelling, installScratchpadSpelling } = require('../src/scratchpad-spelling.cjs');
const { UI_URL } = require('../src/app-protocol.cjs');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nerdsshell-spelling-'));
const output = path.resolve(process.argv[2] || path.join(__dirname, '..', '.local', 'scratchpad-spelling-smoke'));
fs.mkdirSync(output, { recursive: true });
for (const name of ['report.json', 'failure.txt']) fs.rmSync(path.join(output, name), { force: true });
app.setPath('userData', directory);
app.commandLine.appendSwitch('log-net-log', path.join(output, 'net-log.json'));
protocol.registerSchemesAsPrivileged([{ scheme: 'betterssh', privileges: { standard: true, secure: true } }]);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [], external = [], dictionaries = [];
const note = 'mispellling notes \nWrite-Output "safe preview"\n';
let window, nativeParams, contextSequence = 0, menu, spellingReadinessAttempts = 0;
const check = (name, value) => { assert.equal(value, true, name); checks.push(name); console.log(name); };
const evaluate = code => window.webContents.executeJavaScript(code);
async function wait(predicate, name) {
  for (let attempt = 0; attempt < 120; attempt++) { if (await predicate()) return; await delay(50); }
  throw Error(name);
}
async function context() {
  const before = contextSequence;
  const point = await evaluate(`(() => { const r = document.getElementById('scratchText').getBoundingClientRect(); return { x: Math.round(r.left + 30), y: Math.round(r.top + 22) }; })()`);
  window.webContents.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, ...point });
  window.webContents.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, ...point });
  await wait(() => contextSequence > before, 'Native spelling context menu did not arrive.');
  await delay(100);
}
async function waitForSpellingWord() {
  for (let attempt = 0; attempt < 120; attempt++) {
    spellingReadinessAttempts = attempt + 1;
    if (attempt % 12 === 0) {
      // A genuine edit asks a newly initialized provider to check this same
      // paragraph again. Keep the owned synthetic note unchanged, and allow
      // callbacks to settle between edits instead of cancelling every check.
      await evaluate(`(() => { const e=document.getElementById('scratchText');e.focus();e.setSelectionRange(e.value.length,e.value.length);return true;})()`);
      window.webContents.insertText(' ');
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
    }
    await delay(150); await context();
    if (nativeParams?.misspelledWord === 'mispellling' && nativeParams.dictionarySuggestions?.length) return;
  }
  throw Error('Native spelling did not annotate the first paragraph within 30 seconds.');
}
async function diagnostics() {
  return { electron: process.versions.electron, chrome: process.versions.chrome, windows: os.release(),
    languages: session.defaultSession.getSpellCheckerLanguages(), enabled: session.defaultSession.isSpellCheckerEnabled(),
    spellingReadinessAttempts, external, dictionaries,
    context: nativeParams && { misspelledWord: nativeParams.misspelledWord, dictionarySuggestions: nativeParams.dictionarySuggestions,
      isEditable: nativeParams.isEditable, formControlType: nativeParams.formControlType, spellcheckEnabled: nativeParams.spellcheckEnabled },
    editor: await evaluate(`(() => { const e=document.getElementById('scratchText');return {value:e.value,start:e.selectionStart,end:e.selectionEnd,active:document.activeElement.id,highlight:e.dataset.highlight};})()`) };
}
async function main() {
  assert.equal(process.platform, 'win32', 'This fixture establishes Windows native spelling only.');
  await app.whenReady();
  const currentSession = session.defaultSession;
  configureScratchpadSpelling(currentSession);
  currentSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => { external.push(details.url); callback({ cancel: true }); });
  for (const name of ['spellcheck-dictionary-download-begin', 'spellcheck-dictionary-download-success', 'spellcheck-dictionary-download-failure']) currentSession.on(name, (_event, language) => dictionaries.push({ event: name, language }));
  const root = path.resolve(__dirname, '..'), html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');
  const scratchpad = html.match(/<aside id="scratchpad"[\s\S]*?<\/aside>/)[0].replace(' hidden ', ' ');
  const fixtureHTML = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'none'"><link rel="stylesheet" href="ui/style.css"><link rel="stylesheet" href="ui/desktop-ux.css"><main><button id="scratchpadToggle" type="button">Scratchpad</button>${scratchpad}<textarea id="other" spellcheck="false"></textarea></main><script src="fixture.js"></script><script src="ui/scratchpad.js"></script>`;
  const bootstrap = `const $=id=>document.getElementById(id),api={scratchpadDirty:async()=>{},scratchpadRead:async()=>null,scratchpadSave:async()=>null,copy:async()=>{}},views=new Map(),fit=()=>{},run=()=>{},message=()=>{};`;
  protocol.handle('betterssh', request => {
    const routes = { [UI_URL]: [fixtureHTML, 'text/html'], 'betterssh://app/ui/fixture.js': [bootstrap, 'text/javascript'],
      'betterssh://app/ui/ui/style.css': [fs.readFileSync(path.join(root, 'ui', 'style.css')), 'text/css'],
      'betterssh://app/ui/ui/desktop-ux.css': [fs.readFileSync(path.join(root, 'ui', 'desktop-ux.css')), 'text/css'],
      'betterssh://app/ui/ui/scratchpad.js': [fs.readFileSync(path.join(root, 'ui', 'scratchpad.js')), 'text/javascript'] };
    const resource = routes[request.url]; return new Response(resource ? resource[0] : 'Not found', { status: resource ? 200 : 404, headers: { 'Content-Type': resource ? resource[1] : 'text/plain' } });
  });
  currentSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  currentSession.setPermissionCheckHandler(() => false);
  window = new BrowserWindow({ show: false, width: 900, height: 550, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: true, backgroundThrottling: false } });
  window.webContents.on('context-menu', (_event, params) => { nativeParams = params; contextSequence++; });
  installScratchpadSpelling({ getWindow: () => window, Menu: { buildFromTemplate: items => ({ popup: () => { menu = { items }; } }) } });
  await window.loadURL(UI_URL);
  await evaluate(`document.getElementById('scratchText').focus(); true`);
  window.webContents.focus();
  window.webContents.insertText('mispellling notes ');
  // Native Windows spelling initializes asynchronously. Moving to another
  // paragraph before the first callback arrives can invalidate its marker.
  // Observe a real suggestion rather than guessing a cold-start delay.
  await waitForSpellingWord();
  check('Native spelling annotates the first paragraph before the fixture moves its caret', true);
  await evaluate(`(() => { const e=document.getElementById('scratchText');e.setSelectionRange(e.value.length,e.value.length);return true;})()`);
  window.webContents.insertText('\nWrite-Output "safe preview"\n');
  await wait(async () => await evaluate(`document.getElementById('scratchText').value`) === note, 'Synthetic native typing did not reach the scratchpad.');
  await wait(async () => await evaluate(`document.getElementById('scratchText').dataset.highlight === 'current' && !document.getElementById('scratchHighlight').hidden`), 'Actual scratchpad syntax preview did not settle.');
  await delay(200);
  const highlighted = await window.webContents.capturePage(); fs.writeFileSync(path.join(output, 'spelling-highlighted.png'), highlighted.toPNG());
  check('Actual scratchpad renderer highlights notes while the native textarea retains spelling', await evaluate(`getComputedStyle(document.getElementById('scratchText')).color === 'rgba(0, 0, 0, 0)' && document.getElementById('scratchText').spellcheck && !!document.getElementById('scratchHighlight').querySelector('.syntax-keyword')`));
  for (let attempt = 0; attempt < 20; attempt++) {
    await delay(150); await context();
    if (nativeParams.misspelledWord === 'mispellling' && nativeParams.dictionarySuggestions.length) break;
  }
  check('Pinned Windows Electron returns a misspelled word and local spelling suggestions', nativeParams.misspelledWord === 'mispellling' && nativeParams.dictionarySuggestions.length > 0);
  check('Native context identifies the exact trusted main-frame scratchpad', nativeParams.frame === window.webContents.mainFrame && nativeParams.isEditable && nativeParams.formControlType === 'text-area' && await evaluate(`document.getElementById('scratchText').spellcheck`));
  check('Guarded spelling helper opens a correction menu for the underlined word', !!menu?.items.some(x => x.click));
  const selected = menu.items.find(x => x.click), replacement = nativeParams.dictionarySuggestions.find(x => x.replace(/&/g, '&&') === selected.label);
  selected.click();
  await wait(async () => await evaluate(`document.getElementById('scratchText').value`) !== note, 'Native spelling replacement did not change the selected word.');
  check('Native correction changes only the underlined word', await evaluate(`document.getElementById('scratchText').value`) === replacement + note.slice('mispellling'.length));
  window.webContents.undo();
  await wait(async () => await evaluate(`document.getElementById('scratchText').value`) === note, 'Native spelling undo did not restore the word.');
  check('Spelling corrections retain native undo', true);
  await delay(200); await context();
  const stale = menu.items.find(x => x.click);
  await evaluate(`document.getElementById('other').focus(); true`); stale.click(); await delay(100);
  check('Changing input focus invalidates an open correction target', await evaluate(`document.getElementById('scratchText').value`) === note && await evaluate(`document.getElementById('other').value === ''`));
  check('No spelling dictionary was downloaded and no external request was attempted', external.length === 0 && !dictionaries.some(x => x.event === 'spellcheck-dictionary-download-success'));
  await require('./Scratchpad-Wrap-Smoke.cjs').scratchpadWrapSmoke({ evaluate,
    wait: (source, detail) => wait(async () => await evaluate(source), detail), check,
    screenshot: async name => fs.writeFileSync(path.join(output, name + '.png'), (await window.webContents.capturePage()).toPNG())
  });
  window.destroy(); window = null;
  const report = { electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform, checks, external, dictionaries,
    disposableDataDirectory: directory, spellingReadinessAttempts, suggestions: nativeParams.dictionarySuggestions, nativeSpellcheckEnabledFlag: nativeParams.spellcheckEnabled };
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
main().then(() => app.exit(0)).catch(async error => {
  console.error(error); fs.writeFileSync(path.join(output, 'failure.txt'), String(error.stack || error));
  try { const detail = await diagnostics(); fs.writeFileSync(path.join(output, 'diagnostics.json'), JSON.stringify(detail, null, 2)); console.error(JSON.stringify(detail)); } catch {}
  window?.destroy(); app.exit(1);
});
app.on('quit', () => {
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('nerdsshell-spelling-')) {
    try { fs.rmSync(resolved, { recursive: true, force: true }); } catch {}
  }
});
