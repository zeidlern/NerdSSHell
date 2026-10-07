'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { profile, shellQuote, sessionName, id, parsePanes, paneKey, restoreOrder, unescapeOctal, fingerprint, knownHostStatus } = require('../src/core.cjs');
const { Control } = require('../src/control.cjs');
const { StateStore, Archive, PlainText, workspace, appearance } = require('../src/storage.cjs');
const { Remote } = require('../src/remote.cjs');
const base = { name: 'Test', host: '127.0.0.1', username: 'runner', auth: 'password', id: 'test' };
const token = '11111111-2222-4333-8444-555555555555';
const temporaryDirectories = [];
test.after(() => { for (const p of temporaryDirectories) fs.rmSync(p, { recursive: true, force: true }); });
function temporary(_t) { const p = fs.mkdtempSync(path.join(os.tmpdir(), 'nerdsshell-test-')); temporaryDirectories.push(p); return p; }
class Stream extends EventEmitter { constructor() { super(); this.writes = []; } write(s) { this.writes.push(s); return true; } destroy() { this.destroyed = true; } }
function channel(t, options) { const s = new Stream(); const c = new Control(s, options); t.after(() => c.detach()); c.feed(Buffer.from('%begin 1 1 0\n%end 1 1 0\n')); return { c, s }; }
const paneLine = `$0\tmission\\ one\t@1\t0\tShell\t%2\t0\t120\t40\t0\t${token}\t1\tbash\n`;

test('profile validates and drops all secret/unknown fields', () => { const p = profile({ ...base, password: 'never-save', passphrase: 'never-save', command: 'evil' }); assert.equal(p.scrollback, 100000); assert.equal(p.record, false); assert.equal(p.startup, 'all'); assert.ok(!JSON.stringify(p).includes('never-save')); assert.ok(!('command' in p)); });
for (const host of ['-oProxyCommand=bad', 'host;rm', 'host\ncommand', 'host/path', '$(id)', '']) test('reject unsafe host ' + JSON.stringify(host), () => assert.throws(() => profile({ ...base, host })));
for (const port of [0, -1, 65536, 22.5, 'not-a-port']) test('reject invalid port ' + port, () => assert.throws(() => profile({ ...base, port })));
test('IPv6 address and standard DNS name accepted', () => { assert.equal(profile({ ...base, host: '2001:db8::1' }).host, '2001:db8::1'); assert.equal(profile({ ...base, host: 'my-server.local' }).host, 'my-server.local'); });
test('key authentication requires an explicit key file', () => assert.throws(() => profile({ ...base, auth: 'key' })));
test('UUID identity never uses session names as targets', () => { assert.equal(id('$10', '$'), '$10'); assert.equal(id('%12', '%'), '%12'); assert.throws(() => id('%1;kill-server', '%')); assert.throws(() => paneKey('p', 'bad', '%1')); });
test('session names permit readable labels, reject control syntax', () => { assert.equal(sessionName('Mission one_2-test'), 'Mission one_2-test'); for (const s of ['', 'a.b', 'a:b', '$(id)', 'x\ny', 'a'.repeat(65)]) assert.throws(() => sessionName(s)); });
test('POSIX quoting handles apostrophes without shell expansion', () => assert.equal(shellQuote("a'b;$(id)"), "'a'\\''b;$(id)'"));
test('tmux list parsing preserves escaped spaces and stable identities', () => { const [p] = parsePanes(paneLine); assert.equal(p.sessionName, 'mission one'); assert.equal(p.paneId, '%2'); assert.equal(p.sessionToken, token); assert.equal(p.cols, 120); });
test('malformed pane lists fail explicitly', () => assert.throws(() => parsePanes('unexpected server banner\n')));
test('restore all includes newly discovered sessions exactly once', () => assert.deepEqual(restoreOrder(['a', 'a', 'ended'], ['b', 'a', 'c'], 'all'), ['a', 'b', 'c']));
test('restore only does not recreate missing sessions', () => assert.deepEqual(restoreOrder(['old', 'a'], ['a', 'new'], 'restore'), ['a']));
test('dashboard-only startup opens no views', () => assert.deepEqual(restoreOrder(['a'], ['a'], 'none'), []));
test('octal protocol decoding preserves Unicode and escaped slashes', () => assert.equal(unescapeOctal(Buffer.from('héllo\\015\\012\\134')).toString(), 'héllo\r\n\\'));
test('octal decoding leaves malformed escapes literal', () => assert.equal(unescapeOctal('\\999\\12\\400').toString(), '\\999\\12\\400'));

test('control handshake, fragmented bytes and serialized command responses', async t => {
  const { c, s } = channel(t); await c.ready; const first = c.request('one'), second = c.request('two'); assert.deepEqual(s.writes, ['one\n']);
  c.feed(Buffer.from('%begin 2 2 1\nhel')); c.feed(Buffer.from('lo\n%end 2 2 1\n'));
  assert.equal((await first)[0].toString(), 'hello'); assert.deepEqual(s.writes, ['one\n', 'two\n']);
  c.feed(Buffer.from('%begin 2 3 1\n%end 2 3 1\n')); assert.deepEqual(await second, []);
});
test('control output decoded even when UTF-8 is split between packets', t => {
  const { c } = channel(t); const received = []; c.on('output', (pid, b) => received.push([pid, b.toString()]));
  const line = Buffer.from('%output %2 😀\\015\\012\n'); for (const b of line) c.feed(Buffer.from([b])); assert.deepEqual(received, [['%2', '😀\r\n']]);
});
test('extended output flow-control notifications supported', t => { const { c } = channel(t); let value; c.on('output', (id, b) => value = [id, b.toString()]); c.feed(Buffer.from('%extended-output %2 50 : hello\\012\n')); assert.deepEqual(value, ['%2', 'hello\n']); });
test('snapshot callback completes before later live output is emitted', async t => {
  const { c } = channel(t); const order = []; c.on('output', () => order.push('output'));
  const response = c.request('capture-pane', () => order.push('snapshot')); c.feed(Buffer.from('%begin 2 2 1\nscreen\n%end 2 2 1\n%output %2 live\n')); await response; assert.deepEqual(order, ['snapshot', 'output']);
});
test('mismatched guard-looking content is retained in command output', async t => { const { c } = channel(t); const job = c.request('capture-pane'); c.feed(Buffer.from('%begin 3 2 1\n%end 9 99 1\n%end 3 2 1\n')); assert.equal((await job)[0].toString(), '%end 9 99 1'); });
test('command errors reject only their own request', async t => { const { c } = channel(t); const job = c.request('unknown'); c.feed(Buffer.from('%begin 2 2 1\nbad command\n%error 2 2 1\n')); await assert.rejects(job, /bad command/); assert.equal(c.closed, false); });
test('command timeout closes the channel so late replies cannot be misassigned', async t => { const { c, s } = channel(t, { timeout: 15 }); const a = c.request('slow'), b = c.request('later'); const results = await Promise.allSettled([a, b]); assert.ok(results.every(x => x.status === 'rejected')); assert.equal(s.destroyed, true); assert.equal(s.writes.length, 1); });
test('detach never sends kill, exit or interrupt to a remote shell', t => { const { c, s } = channel(t); c.detach(); assert.deepEqual(s.writes, []); assert.equal(s.destroyed, true); });
test('protocol injection rejected before transport write', async t => { const { c, s } = channel(t); await assert.rejects(c.request('list-panes\nkill-server')); assert.deepEqual(s.writes, []); });
test('bounded protocol buffer rejects unbounded remote data', t => { const { c } = channel(t, { maxBuffer: 40 }); assert.throws(() => c.feed(Buffer.alloc(41, 65)), /limit/); });

const hostkey = Buffer.from('test server key'), otherkey = Buffer.from('different server key');
const known = `server.example ssh-ed25519 ${hostkey.toString('base64')}\n`;
test('OpenSSH fingerprint format is stable', () => assert.match(fingerprint(hostkey), /^SHA256:[A-Za-z0-9+/]{43}$/));
test('known_hosts accepts exact key and rejects mismatch', () => { assert.equal(knownHostStatus(known, 'server.example', 22, hostkey), 'trusted'); assert.equal(knownHostStatus(known, 'server.example', 22, otherkey), 'changed'); });
test('nondefault ports use bracketed known_hosts notation', () => assert.equal(knownHostStatus(`[server.example]:2222 ssh-ed25519 ${hostkey.toString('base64')}`, 'server.example', 2222, hostkey), 'trusted'));
test('hashed known_hosts entries supported', () => { const salt = Buffer.from('salt'); const hash = crypto.createHmac('sha1', salt).update('server.example').digest('base64'); assert.equal(knownHostStatus(`|1|${salt.toString('base64')}|${hash} ssh-ed25519 ${hostkey.toString('base64')}`, 'server.example', 22, hostkey), 'trusted'); });
test('revoked host keys always blocked', () => assert.equal(knownHostStatus(known + '@revoked ' + known, 'server.example', 22, hostkey), 'revoked'));
test('negative known_hosts patterns take precedence', () => assert.equal(knownHostStatus(`*.example,!server.example ssh-ed25519 ${hostkey.toString('base64')}`, 'server.example', 22, hostkey), 'unknown'));
test('certificate authority entries do not silently trust raw server keys', () => assert.equal(knownHostStatus('@cert-authority ' + known, 'server.example', 22, hostkey), 'unknown'));
test('saved trust pins cannot be bypassed by another known_hosts key', async () => { const r = new Remote({ ...base, host: 'server.example' }, { pins: { 'server.example:22': fingerprint(otherkey) }, knownHosts: known }); await assert.rejects(r.verifyHost(hostkey), /changed/); });
test('unknown host requires affirmative confirmation before persisting trust', async () => { let saved = false; const r = new Remote(base, { pins: {}, knownHosts: '', trust: async () => false, savePin: () => { saved = true; } }); assert.equal(await r.verifyHost(hostkey), false); assert.equal(saved, false); });

test('workspace validation clamps splits and deduplicates tabs', () => assert.deepEqual(workspace({ layout: 4, splitX: 100, splitY: -1, order: ['a', 'a', 42] }), { layout: 4, twoPaneOrientation: 'side-by-side', splitX: 80, splitY: 20, order: ['a'], slots: [], active: '' }));
test('stacked layout and its divider persist without changing existing layout values', t => { const dir = temporary(t), s = new StateStore(dir); s.setWorkspace({ layout: 2, twoPaneOrientation: 'stacked', splitY: 63 }); const loaded = new StateStore(dir); assert.equal(loaded.data.workspace.layout, 2); assert.equal(loaded.data.workspace.twoPaneOrientation, 'stacked'); assert.equal(loaded.data.workspace.splitY, 63); assert.equal(workspace({ layout: 2 }).twoPaneOrientation, 'side-by-side'); assert.equal(workspace({ twoPaneOrientation: 'unexpected' }).twoPaneOrientation, 'side-by-side'); });

test('pane placements roundtrip with empty slots and reject duplicate, foreign and malformed keys', t => {
  const s = new StateStore(temporary(t)); s.setWorkspace({ layout: 4, order: ['a', 'b'], active: 'a', slots: [null, 'b', null, 'a'] });
  assert.deepEqual(new StateStore(s.directory).data.workspace.slots, [null, 'b', null, 'a']);
  assert.deepEqual(workspace({ layout: 4, order: ['a', 'b'], slots: ['a', 'a', 'foreign', {}] }).slots, ['a', null, null, null]);
  for (const slots of [null, {}, ['a'], Array(1000).fill('a')]) assert.deepEqual(workspace({ layout: 4, order: ['a'], slots }).slots, []);
  assert.deepEqual(workspace({ layout: 2, order: ['a'], slots: ['a', 42] }).slots, ['a', null]);
});
test('appearance accepts hex colors and rejects CSS injection', () => { assert.equal(appearance({ accent: '#Aa22Bb' }).accent, '#aa22bb'); assert.throws(() => appearance({ accent: 'url(file:///secret)' }), /Invalid accent color/); });
test('old appearance settings retain UI colors and the standard terminal palette', () => {
  const colors = appearance({ accent: '#123456', terminalBackground: '#101010' });
  assert.equal(colors.accent, '#123456'); assert.equal(colors.terminalBackground, '#101010');
  assert.equal(colors.palette.red, '#cc0000'); assert.equal(colors.palette.extendedAnsi.length, 240);
  for (const [index, expected] of [[16, '#000000'], [21, '#0000ff'], [196, '#ff0000'], [232, '#080808'], [255, '#eeeeee']]) assert.equal(colors.palette.extendedAnsi[index - 16], expected);
});
test('terminal palette rejects non-object settings and executable color values', () => {
  for (const palette of [null, [], 'red', 42, { red: 'url(https://example.invalid)' }, { brightBlue: '<script>' }, { green: '\x1b[32m' }]) assert.throws(() => appearance({ palette }), /Invalid/);
});
test('indexed palette enforces exact length and validates every slot including holes', () => {
  const colors = appearance().palette.extendedAnsi;
  for (const extendedAnsi of [null, {}, new Array(240), colors.slice(1), [...colors, '#000000'], colors.map((value, i) => i === 239 ? 'red' : value)]) assert.throws(() => appearance({ palette: { extendedAnsi } }), /indexed|240/);
});
test('custom terminal colors persist without changing connection or workspace settings', t => {
  const s = new StateStore(temporary(t)); s.putProfile(base); s.setWorkspace({ layout: 2, twoPaneOrientation: 'stacked', order: ['one'] });
  const before = JSON.parse(JSON.stringify(s.data)); const colors = appearance({ accent: '#112233', palette: { red: '#Aa22Bb' } }); colors.palette.extendedAnsi[180] = '#abcdef';
  s.setAppearance(colors); const loaded = new StateStore(s.directory);
  assert.deepEqual(loaded.data.profiles, before.profiles); assert.deepEqual(loaded.data.pins, before.pins); assert.deepEqual(loaded.data.workspace, before.workspace);
  assert.equal(loaded.data.appearance.palette.red, '#aa22bb'); assert.equal(loaded.data.appearance.palette.extendedAnsi[180], '#abcdef');
});
test('validated palettes never retain caller-owned arrays or mutate other defaults', () => {
  const input = appearance(), validated = appearance(input); input.palette.extendedAnsi[0] = '#123456';
  assert.equal(validated.palette.extendedAnsi[0], '#000000'); validated.palette.red = '#123456'; assert.equal(appearance().palette.red, '#cc0000');
});
test('saved settings roundtrip without credentials', t => { const dir = temporary(t), s = new StateStore(dir); s.putProfile({ ...base, password: 'secret' }); s.setWorkspace({ layout: 4, order: ['one'], active: 'one' }); s.setAppearance({ accent: '#aa2244' }); const raw = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'); assert.ok(!raw.includes('secret')); const loaded = new StateStore(dir); assert.equal(loaded.data.profiles[0].host, base.host); assert.equal(loaded.data.workspace.layout, 4); assert.equal(loaded.data.appearance.accent, '#aa2244'); });
test('existing settings without appearance load the default colors', t => { const dir = temporary(t), s = new StateStore(dir); s.setWorkspace({ layout: 2 }); const file = path.join(dir, 'settings.json'), raw = JSON.parse(fs.readFileSync(file, 'utf8')); delete raw.appearance; fs.writeFileSync(file, JSON.stringify(raw)); const loaded = new StateStore(dir); assert.equal(loaded.data.workspace.layout, 2); assert.equal(loaded.data.appearance.terminalBackground, '#000000'); });
test('corrupt settings fail without overwriting the original', t => { const dir = temporary(t), file = path.join(dir, 'settings.json'); fs.writeFileSync(file, '{broken'); assert.throws(() => new StateStore(dir), /has not been changed/); assert.equal(fs.readFileSync(file, 'utf8'), '{broken'); });
test('plain-text filtering strips split OSC and CSI sequences', () => { const f = new PlainText(); assert.equal(f.push(Buffer.from('A\x1b]52;c;SEC')), 'A'); assert.equal(f.push(Buffer.from('RET\x07B\x1b[31')), 'B'); assert.equal(f.push(Buffer.from('mred\x1b[0m')), 'red'); });
test('plain-text filtering preserves fragmented UTF-8', () => { const f = new PlainText(), b = Buffer.from('😀'); assert.equal(f.push(b.subarray(0, 2)), ''); assert.equal(f.push(b.subarray(2)), '😀'); });
test('CRLF and split CRLF become exactly one newline', () => { const f = new PlainText(); assert.equal(f.push(Buffer.from('a\r\nb\r')), 'a\nb'); assert.equal(f.push(Buffer.from('\nc\rd')), '\nc\nd'); });
test('archive search matches text spanning network records', async t => { const a = new Archive(temporary(t), 'test'); t.after(() => a.close()); a.append('session', Buffer.from('a very imp')); a.append('session', Buffer.from('ortant message\r\n')); const rows = await a.search('session', 'important'); assert.equal(rows.length, 1); assert.equal(rows[0].text, 'a very important message'); });
test('archive search isolates sessions and caps output', async t => { const a = new Archive(temporary(t), 'test'); t.after(() => a.close()); a.append('one', Buffer.from('a\nb\nc\n')); a.append('two', Buffer.from('hidden\n')); assert.deepEqual((await a.search('one', '', 2)).map(r => r.text), ['b', 'c']); });
test('archive export never silently overwrites a file', async t => { const dir = temporary(t), a = new Archive(dir, 'test'); t.after(() => a.close()); a.append('key', Buffer.from('hello\n')); const dest = path.join(dir, 'export.txt'); await a.exportTo('key', dest); assert.equal(fs.readFileSync(dest, 'utf8'), 'hello\n'); await assert.rejects(a.exportTo('key', dest)); });
test('archive rotation prunes old segments to its storage cap', async t => { const a = new Archive(temporary(t), 'test', 1, 256); t.after(() => a.close()); a.limit = 700; for (let i = 0; i < 10; i++) { a.append('key', Buffer.from('x'.repeat(220) + '\n')); await a.flush(); } const files = await a.files(); const total = files.reduce((sum, file) => sum + fs.statSync(path.join(a.dir, file)).size, 0); assert.ok(total <= 700); });
test('remote view close cannot terminate sessions', () => { const r = new Remote(base); let detached = 0; r.views.set('k', { active: true, pane: { sessionId: '$0' } }); r.controls.set('$0', { detach() { detached++; } }); r.closeView('k'); assert.equal(detached, 1); assert.equal(r.views.size, 0); });
test('closing one of two views of a session keeps the shared channel alive', () => { const r = new Remote(base); let detached = 0; for (const k of ['a', 'b']) r.views.set(k, { active: true, pane: { sessionId: '$0' } }); r.controls.set('$0', { detach() { detached++; } }); r.closeView('a'); assert.equal(detached, 0); });
test('disconnected input is rejected rather than queued', async () => { const r = new Remote(base); await assert.rejects(r.input('missing', 'danger\r'), /not sent/); });
test('session termination uses an atomic UUID check, not a name', async () => { const r = new Remote(base); const p = { key: 'k', sessionId: '$0', sessionToken: token }; r.panes = [p]; let command; r.checked = async c => { command = c; return ''; }; r.discover = async () => []; await r.endSession('k'); assert.match(command, /if-shell -F/); assert.ok(command.includes(token)); assert.match(command, /kill-session -t \$0/); });
test('a changed UUID prevents session termination', async () => { const r = new Remote(base); r.panes = [{ key: 'k', sessionId: '$0', sessionToken: token }]; r.checked = async () => 'NERDSSHELL_IDENTITY_CHANGED'; await assert.rejects(r.endSession('k'), /not terminated/); });
