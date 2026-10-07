'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Remote } = require('../src/remote.cjs');
const { profile, PANE_FORMAT, parsePanes, paneKey, parseSessionIdentity, SESSION_IDENTITY_OPTION,
  LEGACY_SESSION_IDENTITY_OPTION, SESSION_IDENTITY_FORMAT } = require('../src/core.cjs');

const token = '11111111-2222-4333-8444-555555555555';
const replacement = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const settings = { id: 'fixture', host: 'server.example', username: 'tester', auth: 'password' };
function row(identity) { return ['$0', 'Existing work', '@0', '0', 'Shell', '%0', '0', '80', '24', '0', identity, '1', 'bash'].join('\t') + '\n'; }
function remote() { const r = new Remote(settings); r.connected = true; r.client = {}; return r; }
function pane(identity) { const p = parsePanes(row(identity))[0]; return { ...p, key: paneKey(settings.id, p.sessionToken, p.paneId), profileId: settings.id }; }

test('default upload directory adopts NerdSSHell while saved explicit legacy folders stay intact', () => {
  assert.equal(profile(settings).uploadDirectory, '~/NerdSSHell-Uploads');
  assert.equal(profile({ ...settings, uploadDirectory: '~/BetterSSH-Uploads' }).uploadDirectory, '~/BetterSSH-Uploads');
});

test('13-column discovery distinguishes current, legacy, matching dual and old plain-token identities', () => {
  assert.equal(PANE_FORMAT.split('\t').length, 13);
  for (const [identity, marker] of [[token + '|', SESSION_IDENTITY_OPTION], ['|' + token, LEGACY_SESSION_IDENTITY_OPTION],
    [token + '|' + token, SESSION_IDENTITY_OPTION], [token, LEGACY_SESSION_IDENTITY_OPTION]]) {
    const p = pane(identity);
    assert.equal(p.sessionToken, token); assert.equal(p.sessionIdentityOption, marker);
    assert.equal(p.key, 'fixture/' + token + '/%0');
  }
});

test('conflicting or malformed markers fail closed before metadata assignment or view reconciliation', async () => {
  for (const identity of [token + '|' + replacement, token + '|bad', token + '||']) {
    assert.throws(() => parseSessionIdentity(identity), /identit/);
    const r = remote(), p = pane('|' + token), view = { pane: p, active: true };
    r.panes = [p]; r.views.set(p.key, view);
    r.exec = async () => ({ code: 0, stdout: row(identity), stderr: '' });
    r.checked = async () => assert.fail('A malformed discovery must not mutate remote metadata.');
    await assert.rejects(r.discover(), /identit/);
    assert.equal(r.panes[0], p); assert.equal(r.views.get(p.key), view); assert.equal(view.active, true);
  }
});

test('legacy reconnect preserves stable keys, active views and verified controls without changing remote work', async () => {
  const r = remote(), p = pane('|' + token), view = { pane: p, active: true, initialized: true };
  r.panes = [p]; r.views.set(p.key, view);
  const control = { sessionToken: token, verified: true, closed: false, detach() { assert.fail('Existing work should remain attached.'); } };
  r.controls.set(p.sessionId, control);
  const commands = [];
  r.exec = async command => { commands.push(command); return { code: 0, stdout: row('|' + token), stderr: '' }; };
  r.checked = async () => assert.fail('Legacy reconnect must not write either identity marker.');
  const [found] = await r.discover();
  assert.equal(found.key, p.key); assert.equal(found.sessionToken, token);
  assert.equal(view.pane, found); assert.equal(view.active, true); assert.equal(view.initialized, true);
  assert.equal(await r.control(found), control);
  assert.equal(commands.length, 1); assert.match(commands[0], /list-panes/);
  assert.doesNotMatch(commands.join('\n'), /new-session|new-window|send-keys|kill-session|run-shell/);
});

test('unmarked discovery publishes matching current and downlevel markers under a both-empty guard without jobs', async () => {
  const r = remote(), commands = [];
  r.exec = async command => { commands.push(command); return { code: 0, stdout: row('|'), stderr: '' }; };
  r.checked = async command => {
    commands.push(command);
    if (command.includes('list-panes')) return row(token + '|' + token);
    assert.match(command, /if-shell -F/);
    assert.ok(command.includes('#{==:#{@nerdsshell-id},}'));
    assert.ok(command.includes('#{==:#{@betterssh-id},}'));
    assert.match(command, /set-option -o -t \$0 @nerdsshell-id [a-f0-9-]{36}/);
    const assigned = [...command.matchAll(/set-option -o -t \$0 (@(?:betterssh|nerdsshell)-id) ([a-f0-9-]{36})/g)];
    assert.equal(assigned.length, 2);
    assert.equal(assigned[0][1], LEGACY_SESSION_IDENTITY_OPTION); assert.equal(assigned[1][1], SESSION_IDENTITY_OPTION);
    assert.equal(assigned[0][2], assigned[1][2]);
    assert.ok(command.includes(`#{==:#{@betterssh-id},${assigned[0][2]}}`));
    return '';
  };
  const [found] = await r.discover(); assert.equal(found.sessionToken, token); assert.equal(found.sessionIdentityOption, SESSION_IDENTITY_OPTION);
  assert.equal(commands.length, 3);
  assert.doesNotMatch(commands.join('\n'), /new-session|new-window|send-keys|kill-session|run-shell/);
});

test('a concurrent downlevel assignment fails the both-empty guard and is read back without overwrite or retry', async () => {
  const r = remote(); let writes = 0;
  r.exec = async () => ({ code: 0, stdout: row('|'), stderr: '' });
  r.checked = async command => {
    if (command.includes('list-panes')) return row('|' + replacement);
    assert.ok(command.includes('#{==:#{@betterssh-id},}'));
    writes++; return 'NERDSSHELL_IDENTITY_CHANGED';
  };
  const [found] = await r.discover(); assert.equal(found.sessionToken, replacement); assert.equal(writes, 1);
  assert.equal(found.sessionIdentityOption, LEGACY_SESSION_IDENTITY_OPTION);
});

test('downlevel discovery reads the newly assigned legacy UUID and keeps the same pane key without reassignment', async () => {
  const r = remote(); let current = '', legacy = '', assignments = 0;
  r.exec = async () => ({ code: 0, stdout: row(current + '|' + legacy), stderr: '' });
  r.checked = async command => {
    if (command.includes('list-panes')) return row(current + '|' + legacy);
    const assigned = [...command.matchAll(/set-option -o -t \$0 (@(?:betterssh|nerdsshell)-id) ([a-f0-9-]{36})/g)];
    assert.equal(assigned.length, 2); assignments++;
    legacy = assigned[0][2]; current = assigned[1][2]; return '';
  };
  const [newPane] = await r.discover();
  // The old client reads only its single marker column and assigns if empty.
  const oldPane = parsePanes(row(legacy))[0];
  assert.ok(oldPane.sessionToken); assert.equal(oldPane.sessionToken, newPane.sessionToken);
  assert.equal(paneKey(settings.id, oldPane.sessionToken, oldPane.paneId), newPane.key);
  assert.equal(current, legacy);
  await r.discover(); assert.equal(assignments, 1);
});

test('stale connection discovery cannot assign identities or publish old panes into its replacement', async () => {
  const r = remote(), p = pane(token + '|'); r.panes = [p];
  let finish; r.exec = () => new Promise(resolve => { finish = resolve; });
  r.checked = async () => assert.fail('Stale discovery must not assign an identity.');
  const pending = r.discover(); r.client = {}; finish({ code: 0, stdout: row('|'), stderr: '' });
  await assert.rejects(pending, /Connection changed/); assert.equal(r.panes[0], p);
});

for (const marker of [SESSION_IDENTITY_OPTION, LEGACY_SESSION_IDENTITY_OPTION]) {
  for (const operation of ['rename', 'endSession']) {
    test(operation + ' binds the observed ' + marker + ' and atomically rejects a changed/conflicting other marker', async () => {
      const r = remote(), p = pane(marker === SESSION_IDENTITY_OPTION ? token + '|' : '|' + token);
      r.panes = [p]; let command, rediscovered = false;
      r.checked = async value => { command = value; return 'NERDSSHELL_IDENTITY_CHANGED'; };
      r.discover = async () => { rediscovered = true; return []; };
      await assert.rejects(r[operation](p.key, 'Renamed'), operation === 'rename' ? /not renamed/ : /not terminated/);
      const other = marker === SESSION_IDENTITY_OPTION ? LEGACY_SESSION_IDENTITY_OPTION : SESSION_IDENTITY_OPTION;
      assert.ok(command.includes(`#{==:#{${marker}},${token}}`));
      assert.ok(command.includes(`#{||:#{==:#{${other}},},#{==:#{${other}},${token}}}`));
      assert.match(command, /if-shell -F -t '\$0'/);
      assert.equal(rediscovered, false);
    });
  }
}

class Stream extends EventEmitter {
  constructor() { super(); this.seq = 0; setImmediate(() => this.reply()); }
  reply() { const n = this.seq++; this.emit('data', Buffer.from(`%begin ${n} ${n} 0\n%end ${n} ${n} 0\n`)); }
  write() { queueMicrotask(() => this.reply()); return true; }
  destroy() { this.destroyed = true; this.emit('close'); }
}

test('attachment rejects a current marker downgraded to the same legacy token before attaching', async () => {
  const r = remote(), p = pane(token + '|'); r.panes = [p];
  r.views.set(p.key, { pane: p, active: true });
  r.checked = async command => { assert.ok(command.includes(SESSION_IDENTITY_FORMAT)); return '|' + token; };
  r.client.exec = () => assert.fail('Downgraded identity must not open a control channel.');
  await assert.rejects(r.control(p), /identity changed/); assert.equal(r.controls.size, 0);
});

test('attachment rechecks both markers after opening and detaches an unverified channel on conflict or downgrade', async () => {
  for (const changed of ['|' + token, token + '|' + replacement]) {
    const r = remote(), p = pane(token + '|'); r.panes = [p];
    r.views.set(p.key, { pane: p, active: true });
    let reads = 0, stream;
    r.checked = async command => command.includes(SESSION_IDENTITY_FORMAT) ? (++reads === 1 ? token + '|' : changed) : '';
    r.client.exec = (_command, callback) => { stream = new Stream(); callback(null, stream); };
    await assert.rejects(r.control(p), /identit/);
    assert.equal(reads, 2); assert.equal(stream.destroyed, true); assert.equal(r.controls.size, 0);
  }
});
