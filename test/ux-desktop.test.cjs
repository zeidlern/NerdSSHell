'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { MAX_NOTE, noteText, readNoteFile, saveNewNoteFile, installDesktopTools } = require('../src/desktop-tools.cjs');
const { syntaxBootstrap } = require('../src/local-powershell.cjs');
const { spawnSync } = require('node:child_process');
const { launchArguments } = require('../src/local-remote.cjs');
const { bootstrap } = require('../src/elevated-pty.cjs');
const { tokens } = require('../ui/scratchpad.js');
const shell = { id: 'local:pwsh', executable: "C:\\Program Files\\PowerShell\\7\\pwsh.exe" };
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nerdsshell-notes-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const handlers = {}, app = {}, calls = [], dialogs = [];
  let open = { canceled: true }, save = { canceled: true }, accepted = false;
  installDesktopTools({ handle: (name, fn) => { handlers[name] = fn; }, app, getWindow: () => ({}),
    dialog: { showOpenDialog: async (_w, detail) => { dialogs.push(detail); return typeof open === 'function' ? open() : open; }, showSaveDialog: async (_w, detail) => { dialogs.push(detail); return typeof save === 'function' ? save() : save; } },
    confirm: async (...args) => { calls.push(args); return accepted; }, ...options });
  return { root, handlers, app, calls, dialogs, open(v) { open = v; }, save(v) { save = v; }, accept(v) { accepted = v; } };
}
test('scratchpad text limits are UTF-8 bytes, not JavaScript characters', () => {
  assert.equal(noteText('😀'.repeat(MAX_NOTE / 4)).length, MAX_NOTE / 2);
  for (const value of ['😀'.repeat(MAX_NOTE / 4 + 1), 'note\0hidden', null, {}, 42]) assert.throws(() => noteText(value), /UTF-8/);
});
test('explicit scratchpad read rejects binary UTF-8, NUL, directories and oversized files', t => {
  const h = fixture(t), file = path.join(h.root, 'note.txt');
  for (const bytes of [Buffer.from([0xc3, 0x28]), Buffer.from('hidden\0data'), Buffer.alloc(MAX_NOTE + 1, 97)]) {
    fs.writeFileSync(file, bytes); assert.throws(() => readNoteFile(file));
  }
  assert.throws(() => readNoteFile(h.root));
  fs.writeFileSync(file, 'Markdown **safe** 😀'); assert.equal(readNoteFile(file), 'Markdown **safe** 😀');
});
test('scratchpad Save As never overwrites an existing destination and removes own temporary file', t => {
  const h = fixture(t), file = path.join(h.root, 'note.md');
  saveNewNoteFile(file, 'first 😀');
  assert.throws(() => saveNewNoteFile(file, 'replacement'), /No file was overwritten/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'first 😀');
  assert.deepEqual(fs.readdirSync(h.root), ['note.md']);
});
test('scratchpad publication refuses hard-linked destinations without changing their targets', t => {
  const h = fixture(t), target = path.join(h.root, 'important.txt'), link = path.join(h.root, 'note.md');
  fs.writeFileSync(target, 'untouched');
  fs.linkSync(target, link);
  assert.throws(() => saveNewNoteFile(link, 'replacement'), /No file was overwritten/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'untouched'); assert.equal(fs.statSync(link).ino, fs.statSync(target).ino);
});
test('scratchpad cancel and dirty replacement cancellation do no file IO', async t => {
  const h = fixture(t);
  assert.equal(await h.handlers.scratchpadRead(), null);
  assert.equal(await h.handlers.scratchpadSave('not persisted'), null);
  h.handlers.scratchpadDirty(true);
  h.open({ canceled: false, filePaths: [path.join(h.root, 'does-not-exist')] });
  assert.equal(await h.handlers.scratchpadRead(), null);
  assert.equal(h.calls.length, 1); assert.equal(h.dialogs.length, 2);
  assert.equal(h.app.nerdsshellScratchpadDirty, true); assert.deepEqual(fs.readdirSync(h.root), []);
  assert.throws(() => h.handlers.scratchpadDirty('false'), /Invalid/);
});
test('scratchpad paths come only from native dialogs; explicit confirmed load returns bounded content', async t => {
  const h = fixture(t), file = path.join(h.root, 'note.md'); fs.writeFileSync(file, '# exact 😀');
  h.handlers.scratchpadDirty(true); h.accept(true); h.open({ canceled: false, filePaths: [file] });
  assert.deepEqual(await h.handlers.scratchpadRead('untrusted-renderer-path'), { name: 'note.md', text: '# exact 😀' });
  h.open({ canceled: false, filePaths: ['relative-note.md'] }); await assert.rejects(h.handlers.scratchpadRead(), /Choose one/);
  h.save({ canceled: false, filePath: path.join(h.root, 'saved.md') });
  assert.deepEqual(await h.handlers.scratchpadSave('saved text'), { name: 'saved.md' });
  assert.equal(fs.readFileSync(path.join(h.root, 'saved.md'), 'utf8'), 'saved text');
  assert.equal(h.app.nerdsshellScratchpadDirty, true, 'Only renderer acknowledgement of the saved revision clears dirty state');
});
test('scratchpad file dialogs serialize read/save and recover after errors', async t => {
  const h = fixture(t); let resolve;
  h.open(() => new Promise(r => { resolve = r; })); const pending = h.handlers.scratchpadRead();
  await assert.rejects(h.handlers.scratchpadSave('text'), /current scratchpad/);
  await assert.rejects(h.handlers.scratchpadRead(), /current scratchpad/);
  resolve({ canceled: false, filePaths: [path.join(h.root, 'missing')] }); await assert.rejects(pending);
  h.open({ canceled: true }); assert.equal(await h.handlers.scratchpadRead(), null);
});
test('safe lexical highlighting preserves malicious HTML and all original text as inert tokens', () => {
  const malicious = '# heading\n<script>alert(1)</script>\n![x](file:///secrets)\n**bold**\n"<img src=x onerror=alert(1)>"\n$variable = 42';
  for (const mode of ['auto', 'markdown', 'powershell', 'code', 'plain', 'unexpected']) {
    const result = tokens(malicious, mode);
    assert.equal(result.map(p => p.text).join(''), malicious);
    assert.ok(result.every(p => ['', 'bold', 'string', 'comment', 'variable', 'number', 'keyword'].includes(p.kind)));
  }
  assert.deepEqual(tokens('x'.repeat(100001)), [{ text: 'x'.repeat(100001), kind: '' }]);
  const dense = '$x '.repeat(18000);
  assert.deepEqual(tokens(dense, 'powershell'), [{ text: dense, kind: '' }], 'Dense syntax stays below the highlight DOM budget');
});
function rendererFixture() {
  const elements = {}, pending = [], dirty = [], notices = [], timers = new Map(), callbacks = [];
  let nextTimer = 0, byteCounts = 0;
  function element() {
    return { value: '', hidden: true, style: {}, attrs: {}, children: [], events: {}, mutations: 0,
      set innerHTML(_v) { throw new Error('Unsafe HTML rendering'); },
      setAttribute(k, v) { this.attrs[k] = v; }, append(v) { this.children.push(v); },
      replaceChildren(...nodes) { this.mutations++; this.children = nodes.flatMap(v => v.fragment ? v.children : [v]); },
      addEventListener(k, fn) { this.events[k] = fn; }, focus() {}, setPointerCapture() {} };
  }
  const $ = id => elements[id] ||= element(); $('scratchMode').value = 'auto';
  let read, save;
  const api = { scratchpadDirty: async value => { dirty.push(value); }, scratchpadRead: () => read,
    scratchpadSave: () => save, copy: async () => {} };
  const window = { innerWidth: 1000, addEventListener() {} };
  const flush = () => { const queued = [...timers.values()]; timers.clear(); for (const fn of queued) fn(); };
  class CountedEncoder extends TextEncoder { encode(text) { byteCounts++; return super.encode(text); } }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../ui/scratchpad.js'), 'utf8'), {
    window, $, api, document: { createElement: element, createDocumentFragment: () => ({ ...element(), fragment: true }), createTextNode: text => ({ textContent: text }) },
    views: new Map(), fit() {}, run: p => { pending.push(p); }, message: m => notices.push(m), TextEncoder: CountedEncoder,
    clearTimeout: id => timers.delete(id), setTimeout: fn => { const id = ++nextTimer; timers.set(id, fn); callbacks.push(fn); return id; }, requestAnimationFrame: fn => fn()
  });
  flush();
  return { $, dirty, notices, pending, flush, callbacks, byteCounts: () => byteCounts, timerCount: () => timers.size,
    read(p) { read = p; }, save(p) { save = p; }, edit(text, paint = true) {
      $('scratchText').events.beforeinput(); $('scratchText').value = text; $('scratchText').events.input(); if (paint) flush();
    } };
}
test('scratchpad DOM paints inert text only and keeps notes while collapsed', () => {
  const h = rendererFixture(), note = '# <script>throw Error("executed")</script>\n<img onerror="bad">';
  h.edit(note);
  assert.equal(h.$('scratchHighlight').children.map(v => v.textContent).join(''), note + '\n');
  h.$('scratchpadToggle').onclick(); h.$('scratchCollapse').onclick();
  assert.equal(h.$('scratchText').value, note); assert.equal(h.dirty.at(-1), true);
  assert.equal(h.$('scratchpad').hidden, true);
});

test('scratchpad wrap toggles presentation without changing text, selection or dirty state', () => {
  const h = rendererFixture(), editor = h.$('scratchText'), mirror = h.$('scratchHighlight');
  const note = '$value = "' + 'long note '.repeat(80) + '"\n\tlast line  ';
  h.edit(note); editor.selectionStart = 9; editor.selectionEnd = 25; editor.selectionDirection = 'backward';
  editor.scrollLeft = 150; editor.scrollTop = 60;
  const dirtyCalls = h.dirty.length, mutations = mirror.mutations;
  h.$('scratchWrap').onclick();
  assert.equal(h.$('scratchpad').attrs['data-wrap'], 'on');
  assert.equal(h.$('scratchWrap').attrs['aria-pressed'], 'true'); assert.equal(editor.wrap, 'soft');
  assert.equal(editor.scrollLeft, 0); assert.equal(mirror.scrollLeft, 0); assert.equal(mirror.scrollTop, 60);
  h.$('scratchCollapse').onclick(); h.$('scratchpadToggle').onclick();
  assert.equal(h.$('scratchpad').attrs['data-wrap'], 'on');
  h.$('scratchWrap').onclick();
  assert.equal(h.$('scratchpad').attrs['data-wrap'], 'off');
  assert.equal(h.$('scratchWrap').attrs['aria-pressed'], 'false'); assert.equal(editor.wrap, 'off');
  assert.equal(editor.value, note); assert.equal(editor.selectionStart, 9); assert.equal(editor.selectionEnd, 25);
  assert.equal(editor.selectionDirection, 'backward'); assert.equal(h.dirty.length, dirtyCalls);
  assert.equal(mirror.mutations, mutations, 'Wrapping does not rebuild syntax or alter the note revision');
});

test('scratchpad shows each keystroke immediately and never displays a stale highlight', () => {
  const h = rendererFixture(), editor = h.$('scratchText'), mirror = h.$('scratchHighlight');
  h.edit('$initial = 1'); assert.equal(editor.attrs['data-highlight'], 'current');
  const mutations = mirror.mutations;
  h.edit('$next = 2', false); const stalePaint = h.callbacks.at(-1);
  assert.equal(editor.value, '$next = 2'); assert.equal(editor.attrs['data-highlight'], 'pending'); assert.equal(mirror.hidden, true);
  assert.equal(mirror.mutations, mutations, 'Typing does not synchronously rebuild the syntax DOM');
  h.edit('$latest = 3', false); assert.equal(h.timerCount(), 1, 'Rapid edits coalesce the preview');
  stalePaint(); assert.equal(mirror.hidden, true); assert.equal(mirror.mutations, mutations, 'An obsolete paint cannot hide current text');
  h.flush();
  assert.equal(editor.attrs['data-highlight'], 'current'); assert.equal(mirror.hidden, false);
  assert.equal(mirror.children.map(v => v.textContent).join(''), '$latest = 3\n');
  assert.equal(mirror.mutations, mutations + 1, 'The fresh inert fragment publishes in one DOM replacement');
});

test('scratchpad leaves IME composition visible until committed', () => {
  const h = rendererFixture(), editor = h.$('scratchText'), mirror = h.$('scratchHighlight');
  h.edit('$value = 1'); editor.events.compositionstart();
  h.edit('$value = "に"', false); h.flush();
  assert.equal(editor.attrs['data-highlight'], 'pending'); assert.equal(mirror.hidden, true); assert.equal(h.timerCount(), 0);
  assert.equal(h.dirty.at(-1), true, 'Composition edits still participate in unsaved-note protection');
  editor.events.compositionend(); h.edit('$value = "日本語"', false); h.flush();
  assert.equal(editor.attrs['data-highlight'], 'current'); assert.equal(mirror.children.map(v => v.textContent).join(''), '$value = "日本語"\n');
});

test('scratchpad large and dense notes keep native visible text with bounded highlight DOM', () => {
  const h = rendererFixture(), editor = h.$('scratchText'), mirror = h.$('scratchHighlight');
  h.edit('$x = 1');
  h.edit('😀'.repeat(262145), false);
  assert.equal(h.byteCounts(), 0, 'Large UTF-8 allocation is outside the keystroke path');
  assert.equal(editor.attrs['data-highlight'], 'pending'); assert.equal(mirror.hidden, true);
  h.flush();
  assert.equal(h.byteCounts(), 1); assert.match(h.$('scratchStatus').textContent, /Over the 1 MiB save limit/);
  assert.equal(editor.attrs['data-highlight'], 'plain'); assert.equal(mirror.children.length, 0);
  h.edit('$x '.repeat(18000)); assert.equal(editor.attrs['data-highlight'], 'plain'); assert.equal(mirror.children.length, 0);
  assert.doesNotMatch(h.$('scratchStatus').textContent, /Over the 1 MiB/);
  h.$('scratchMode').value = 'plain'; h.$('scratchMode').onchange();
  assert.equal(editor.attrs['data-highlight'], 'plain'); assert.equal(editor.value, '$x '.repeat(18000));
});
test('scratchpad edits made during a native Open dialog cannot be silently replaced', async () => {
  const h = rendererFixture(); let resolve;
  h.read(new Promise(r => { resolve = r; })); h.$('scratchOpen').onclick();
  h.edit('new unsaved text'); resolve({ text: 'older file', name: 'fixture.md' });
  await assert.rejects(h.pending.at(-1), /changed while the file dialog/);
  assert.equal(h.$('scratchText').value, 'new unsaved text'); assert.equal(h.dirty.at(-1), true);
});
test('scratchpad Save acknowledges only its captured revision; new edits stay unsaved', async () => {
  const h = rendererFixture(); let resolve;
  h.edit('saved revision'); h.save(new Promise(r => { resolve = r; })); h.$('scratchSave').onclick();
  h.edit('new revision'); resolve({ name: 'fixture.md' }); await h.pending.at(-1);
  assert.equal(h.$('scratchText').value, 'new revision'); assert.equal(h.dirty.at(-1), true);
  h.save(Promise.resolve({ name: 'fixture2.md' })); h.$('scratchSave').onclick(); await h.pending.at(-1);
  assert.equal(h.dirty.at(-1), false);
});
test('PSReadLine bootstrap uses only the fixed shell module and process-local options', () => {
  const script = syntaxBootstrap();
  assert.match(script, /Combine\(\$PSHOME, 'Modules', 'PSReadLine', 'PSReadLine.psd1'\)/);
  assert.match(script, /Microsoft.PowerShell.Core\\Import-Module -Name \$nerdsshellModule/);
  assert.match(script, /PSReadLine\\Set-PSReadLineOption -HistorySaveStyle SaveNothing/);
  assert.doesNotMatch(script, /Install-Module|PSModulePath|ExecutionPolicy|Set-Content|PROFILE|Invoke-Expression/i);
  assert.match(script, /catch \{ \}/);
});
if (process.platform === 'win32') for (const flavor of ['ordinary', 'embedded administrator']) for (const supportsColors of [false, true]) test(flavor + ' PSReadLine ' + (supportsColors ? 'modern color support' : 'legacy unsupported Colors') + ' retains disabled history in actual Windows PowerShell', t => {
  const h = fixture(t), moduleDirectory = path.join(h.root, 'PSReadLine');
  fs.mkdirSync(moduleDirectory);
  const manifest = path.join(moduleDirectory, 'PSReadLine.psd1');
  fs.writeFileSync(manifest, "@{ RootModule='PSReadLine.psm1'; ModuleVersion='1.0.0'; FunctionsToExport=@('Set-PSReadLineOption','Get-PSReadLineOption') }");
  // Parameter binding reproduces the legacy module rejecting -Colors before
  // a combined setter can apply -HistorySaveStyle. No global module is changed.
  const fixtureModule =
    "$script:history='SaveIncrementally'; $script:historyWrites=0; $script:colorWrites=0;\n" +
    "function Set-PSReadLineOption { [CmdletBinding()] param([string]$HistorySaveStyle" + (supportsColors ? ',[hashtable]$Colors' : '') + ")\n" +
    "if($PSBoundParameters.ContainsKey('HistorySaveStyle')){$script:history=$HistorySaveStyle;$script:historyWrites++};" +
    (supportsColors ? "if($PSBoundParameters.ContainsKey('Colors')){if($Colors.Count -ne 9){throw 'Expected fixed colors'};$script:colorWrites++};" : '') + "}\n" +
    "function Get-PSReadLineOption { [pscustomobject]@{HistorySaveStyle=$script:history;HistoryWrites=$script:historyWrites;ColorWrites=$script:colorWrites} }";
  const trustedPath = "[System.IO.Path]::Combine($PSHOME, 'Modules', 'PSReadLine', 'PSReadLine.psd1')";
  const production = flavor === 'ordinary' ? syntaxBootstrap()
    : /const string syntax = @"([\s\S]*?)";/.exec(fs.readFileSync(path.join(__dirname, '../src/elevated-console.cs'), 'utf8'))[1].replaceAll('""', '"').replaceAll('[IO.', '[System.IO.');
  assert.ok(production.includes(trustedPath));
  assert.doesNotMatch(production, /PSModulePath|PROFILE|ExecutionPolicy|Install-Module/i);
  const trustedImport = 'Microsoft.PowerShell.Core\\Import-Module -Name $nerdsshellModule -Force -ErrorAction Stop';
  assert.ok(production.includes(trustedImport));
  // In-memory fixture avoids changing this PC's module-file execution policy.
  // Observe within the bootstrap scope where its trusted import is loaded.
  const script = "$nerdsshellFixtureModule=New-Module -Name PSReadLine -ScriptBlock {" + fixtureModule + "};\n" +
    production.replace(trustedPath, "'" + manifest.replaceAll("'", "''") + "'")
    .replace(trustedImport, 'Microsoft.PowerShell.Core\\Import-Module -ModuleInfo $nerdsshellFixtureModule -Force -ErrorAction Stop')
    .replace(/\}\s*$/, "$option=PSReadLine\\Get-PSReadLineOption; $option | ConvertTo-Json -Compress\n}\n");
  const executable = require('../src/local-remote.cjs').installedShells().find(s => s.id === 'local:powershell')?.executable;
  assert.ok(executable, 'Windows PowerShell 5.1 is required for Windows compatibility acceptance');
  const result = spawnSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { encoding: 'utf8', timeout: 20000, maxBuffer: 65536, windowsHide: true, shell: false });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  assert.ok(result.stdout.trim(), result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), { HistorySaveStyle: 'SaveNothing', HistoryWrites: 1, ColorWrites: supportsColors ? 1 : 0 });
});

if (process.platform === 'win32') for (const flavor of ['ordinary', 'embedded administrator']) for (const scenario of ['numeric versions', 'linked version', 'linked root', 'version bound']) test(flavor + ' fixed PS5 fallback: ' + scenario, t => {
  const h = fixture(t), root = path.join(h.root, 'PSReadLine'), target = path.join(h.root, 'owned-link-target');
  const makeManifest = folder => { fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(path.join(folder, 'PSReadLine.psd1'), '# inert fixture'); };
  let expected = path.join(root, '10.0', 'PSReadLine.psd1');
  if (scenario === 'linked root') {
    makeManifest(target); fs.symlinkSync(target, root, 'junction');
  } else {
    fs.mkdirSync(root);
    if (scenario === 'version bound') {
      for (let i = 1; i <= 33; i++) makeManifest(path.join(root, '1.0.' + i));
    } else {
      for (const version of ['1.9', '1.10', '2.0', '10.0', '99.0-preview', '100.0.0.0.0']) makeManifest(path.join(root, version));
      if (scenario === 'linked version') { makeManifest(target); fs.symlinkSync(target, path.join(root, '99.0'), 'junction'); }
    }
  }
  const production = flavor === 'ordinary' ? syntaxBootstrap()
    : /const string syntax = @"([\s\S]*?)";/.exec(fs.readFileSync(path.join(__dirname, '../src/elevated-console.cs'), 'utf8'))[1].replaceAll('""', '"').replaceAll('[IO.', '[System.IO.');
  const bundle = "[System.IO.Path]::Combine($PSHOME, 'Modules', 'PSReadLine', 'PSReadLine.psd1')";
  const fallback = "[System.IO.Path]::Combine([Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles), 'WindowsPowerShell', 'Modules', 'PSReadLine')";
  const importLine = 'Microsoft.PowerShell.Core\\Import-Module -Name $nerdsshellModule -Force -ErrorAction Stop';
  for (const literal of [bundle, fallback, importLine]) assert.ok(production.includes(literal), literal);
  assert.doesNotMatch(production, /PSModulePath|ExecutionPolicy|PROFILE|Install-Module/i);
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const script = "$global:fixtureSelected=$null; $fixtureModule=New-Module -Name PSReadLine -ScriptBlock { $script:history='SaveIncrementally'; function Set-PSReadLineOption {[CmdletBinding()]param([string]$HistorySaveStyle,[hashtable]$Colors);if($HistorySaveStyle){$script:history=$HistorySaveStyle}}; function Get-PSReadLineOption {[pscustomobject]@{HistorySaveStyle=$script:history}} };\n" +
    production.replace(bundle, quote(path.join(h.root, 'missing-bundle.psd1'))).replace(fallback, quote(root))
      .replace(importLine, '$global:fixtureSelected=$nerdsshellModule; Microsoft.PowerShell.Core\\Import-Module -ModuleInfo $fixtureModule -Force -ErrorAction Stop') +
    "; @{Selected=$global:fixtureSelected} | ConvertTo-Json -Compress";
  const executable = require('../src/local-remote.cjs').installedShells().find(s => s.id === 'local:powershell').executable;
  const result = spawnSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { encoding: 'utf8', windowsHide: true, shell: false, timeout: 20000, maxBuffer: 65536 });
  const refused = scenario === 'linked root' || scenario === 'version bound';
  assert.equal(result.status, refused && flavor === 'embedded administrator' ? 2 : 0, result.stderr || String(result.error));
  if (result.status === 0) assert.equal(JSON.parse(result.stdout.trim()).Selected, refused ? null : expected);
});

test('ordinary reviewed launch retains exact command after fixed bootstrap without interpolating it', () => {
  const command = 'Write-Output "😀\'$(not-expanded-by-JavaScript)"';
  const args = launchArguments(command);
  assert.deepEqual(args.slice(0, 4), ['-NoLogo', '-NoProfile', '-NoExit', '-EncodedCommand']);
  assert.equal(Buffer.from(args[4], 'base64').toString('utf16le'), syntaxBootstrap() + command);
  assert.equal(Buffer.from(launchArguments()[4], 'base64').toString('utf16le'), syntaxBootstrap());
  assert.throws(() => launchArguments('x'.repeat(8193)), /8 KiB/);
});
test('administrator bootstrap authenticates the copied helper before compiling the fixed broker', () => {
  const script = bootstrap(path.resolve("fixture's-helper.cs"), 'a'.repeat(64), shell.id);
  assert.match(script, /OpenRead/); assert.match(script, /fixture''s-helper.cs/);
  assert.match(script, /New-Object byte\[\] 131073/); assert.doesNotMatch(script, /ReadAllBytes/);
  assert.ok(script.indexOf('Helper integrity failure') < script.indexOf('Add-Type'));
  assert.match(script, /\[NerdSSHell\.ElevatedConsole\]::Broker/);
  assert.doesNotMatch(script, /Password|Credential|ExecutionPolicy|Invoke-Expression|sudo|Restart-Computer/);
});

test('desktop administrator default fails closed rather than launching an external or unreviewed shell', async t => {
  const h = fixture(t);
  await assert.rejects(h.handlers.localAdminOpen(shell.id), /Embedded administrator hosting is unavailable/);
  await assert.rejects(h.handlers.localAdminOpen('remote:host'), /local shell/);
  assert.deepEqual(fs.readdirSync(h.root), []);
});

test('main desktop administrator handler validates targets and rejects concurrent prompts', async t => {
  let resolve, launches = 0;
  const h = fixture(t, { adminLaunch: () => { launches++; return new Promise(r => { resolve = r; }); } });
  await assert.rejects(h.handlers.localAdminOpen('remote'), /local shell/);
  const pending = h.handlers.localAdminOpen('local:pwsh');
  await assert.rejects(h.handlers.localAdminOpen('local:powershell'), /UAC prompt/);
  assert.equal(launches, 1); resolve({ cancelled: true }); assert.deepEqual(await pending, { cancelled: true });
});

test('desktop Command Prompt administrator launch uses the same serialized fixed-ID boundary', async t => {
  const calls = [], h = fixture(t, { adminLaunch: async id => { calls.push(id); return { cancelled: false, shellId: id }; } });
  assert.deepEqual(await h.handlers.localAdminOpen('local:cmd'), { cancelled: false, shellId: 'local:cmd' });
  for (const id of ['local:cmd-admin', 'local:cmd /k echo wrong', 'C:\\untrusted\\cmd.exe', {}, ['local:cmd']]) await assert.rejects(h.handlers.localAdminOpen(id), /local shell installation/);
  assert.deepEqual(calls, ['local:cmd']);
});
