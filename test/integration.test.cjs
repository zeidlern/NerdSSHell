'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Remote } = require('../src/remote.cjs');
const { upload } = require('../src/transfer.cjs');
const { shellQuote: q } = require('../src/core.cjs');
const enabled = !!process.env.BETTERSSH_TEST_KEY;
const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout = 12000) { const start = Date.now(); while (Date.now() - start < timeout) { if (await fn()) return; await delay(100); } throw new Error('Condition did not become true.'); }
function fixture(socket, { id = 'ci', port = Number(process.env.BETTERSSH_TEST_PORT || 22222), hostKey = process.env.BETTERSSH_TEST_HOST_KEY } = {}) {
  const host = process.env.BETTERSSH_TEST_HOST || '127.0.0.1';
  if (host !== '127.0.0.1') throw new Error('Integration tests are restricted to the disposable loopback SSH server.');
  const p = { id, name: 'CI', host, port, username: process.env.BETTERSSH_TEST_USER || os.userInfo().username, auth: 'key', keyPath: process.env.BETTERSSH_TEST_KEY, socket, uploadDirectory: `/tmp/${socket}-uploads` };
  const pub = fs.readFileSync(hostKey + '.pub', 'utf8').trim().split(/\s+/);
  const knownHosts = `[${host}]:${p.port} ${pub[0]} ${pub[1]}\n`;
  return new Remote(p, { knownHosts, pins: {}, ask: async () => { throw new Error('A hermetic test must not prompt for credentials or install software.'); }, trust: async () => { throw new Error('Unexpected untrusted host.'); } });
}

test('real SSH: create, capture, resize, reattach without restarting, upload, end', { skip: !enabled, timeout: 90000 }, async t => {
  const socket = `betterssh-ci-${process.pid}`; let r = fixture(socket);
  t.after(async () => { try { if (!r.connected) { r = fixture(socket); await r.connect(); } await r.exec(`${r.prefix} kill-server 2>/dev/null; rm -rf ${q('/tmp/' + socket + '-uploads')} ${q('/tmp/' + socket + '-proof')}`); } finally { r.disconnect(); } });
  await r.connect(); assert.equal(r.panes.length, 0);
  const pane = await r.create('Mission one'); assert.ok(pane.key.includes(pane.sessionToken));
  const limit = (await r.checked(`${r.prefix} display-message -p -t ${q(pane.paneId)} ${q('#{history_limit}')}`)).trim(); assert.equal(Number(limit), 100000);
  let snapshot; r.on('snapshot', (key, value) => { if (key === pane.key) snapshot = value; });
  await r.open(pane.key); assert.ok(snapshot && snapshot.cols > 0 && snapshot.rows > 0);
  await r.resize(pane.key, 133, 47);
  assert.equal((await r.checked(`${r.prefix} display-message -p -t ${q(pane.paneId)} ${q('#{pane_width}x#{pane_height}')}`)).trim(), '133x47');
  const proof = '/tmp/' + socket + '-proof';
  await r.input(pane.key, `printf 'one launch\\n' >> ${q(proof)}; sleep 90\r`);
  await until(async () => (await r.checked(`cat ${q(proof)} 2>/dev/null || true`)).includes('one launch'));
  const pid = (await r.checked(`${r.prefix} display-message -p -t ${q(pane.paneId)} ${q('#{pane_pid}')}`)).trim();
  r.closeView(pane.key); assert.equal((await r.discover()).length, 1); r.disconnect();
  r = fixture(socket); await r.connect();
  assert.equal(r.panes[0].key, pane.key); assert.equal((await r.checked(`${r.prefix} display-message -p -t ${q(pane.paneId)} ${q('#{pane_pid}')}`)).trim(), pid);
  await r.open(pane.key);
  assert.equal((await r.checked(`cat ${q(proof)}`)).trim(), 'one launch', 'reattachment must not rerun the job');
  const localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'betterssh-upload-')); t.after(() => fs.rmSync(localDir, { recursive: true, force: true }));
  const local = path.join(localDir, "file with 'quotes'.txt"); fs.writeFileSync(local, 'upload-proof 😀\n');
  const paths = await upload(r, [local], { confirmOverwrite: async () => false }); assert.equal(paths.length, 1);
  assert.equal(await r.checked(`cat ${q(paths[0])}`), 'upload-proof 😀\n');
  fs.writeFileSync(local, 'replacement\n'); assert.deepEqual(await upload(r, [local], { confirmOverwrite: async () => false }), []);
  assert.equal(await r.checked(`cat ${q(paths[0])}`), 'upload-proof 😀\n');
  await upload(r, [local], { confirmOverwrite: async () => true }); assert.equal(await r.checked(`cat ${q(paths[0])}`), 'replacement\n');
  const linked = path.join(localDir, 'linked.txt'); fs.writeFileSync(linked, 'must not overwrite symlink\n');
  await r.checked(`ln -s ${q(paths[0])} ${q(path.posix.join(r.profile.uploadDirectory, 'linked.txt'))}`);
  await assert.rejects(upload(r, [linked]), /symbolic link/);
  assert.equal(await r.checked(`cat ${q(paths[0])}`), 'replacement\n');
  await r.endSession(pane.key); assert.equal(r.panes.length, 0);
  await assert.rejects(r.open(pane.key), /no longer available/);
});

test('two real loopback SSH endpoints with different host keys keep overlapping tmux IDs isolated', {
  skip: !enabled || !process.env.BETTERSSH_TEST_HOST_KEY_2, timeout: 90000
}, async t => {
  const socketA = `betterssh-ci-dual-${process.pid}-a`, socketB = `betterssh-ci-dual-${process.pid}-b`;
  const aOptions = { id: 'ci-A' }, bOptions = { id: 'ci-B', port: Number(process.env.BETTERSSH_TEST_PORT_2), hostKey: process.env.BETTERSSH_TEST_HOST_KEY_2 };
  let a = fixture(socketA, aOptions), b = fixture(socketB, bOptions);
  const keyA = fs.readFileSync(process.env.BETTERSSH_TEST_HOST_KEY + '.pub', 'utf8').split(/\s+/)[1];
  const keyB = fs.readFileSync(process.env.BETTERSSH_TEST_HOST_KEY_2 + '.pub', 'utf8').split(/\s+/)[1];
  assert.notEqual(keyA, keyB, 'independent endpoints need distinct host identities');
  t.after(async () => {
    for (const [current, socket, options] of [[a, socketA, aOptions], [b, socketB, bOptions]]) {
      let remote = current;
      try {
        if (!remote.connected) { remote = fixture(socket, options); await remote.connect(); }
        await remote.exec(`${remote.prefix} kill-server 2>/dev/null; rm -f ${q('/tmp/' + socket + '-proof')}`);
      } finally { remote.disconnect(); }
    }
  });
  await Promise.all([a.connect(), b.connect()]);
  const [pa, pb] = await Promise.all([a.create('Same name'), b.create('Same name')]);
  assert.equal(pa.sessionId, pb.sessionId);
  assert.equal(pa.paneId, pb.paneId);
  assert.notEqual(pa.key, pb.key);
  const outputA = [], outputB = [];
  a.on('output', (_key, bytes) => outputA.push(bytes.toString()));
  b.on('output', (_key, bytes) => outputB.push(bytes.toString()));
  await Promise.all([a.open(pa.key), b.open(pb.key)]);
  await Promise.all([a.resize(pa.key, 92, 30), b.resize(pb.key, 103, 33)]);
  assert.equal((await a.checked(`${a.prefix} display-message -p -t ${q(pa.paneId)} ${q('#{pane_width}x#{pane_height}')}`)).trim(), '92x30');
  assert.equal((await b.checked(`${b.prefix} display-message -p -t ${q(pb.paneId)} ${q('#{pane_width}x#{pane_height}')}`)).trim(), '103x33');
  await Promise.all([
    a.input(pa.key, `printf 'ALPHA_ONLY\n' >> ${q('/tmp/' + socketA + '-proof')}; echo ALPHA_ONLY; sleep 30\r`),
    b.input(pb.key, `printf 'BETA_ONLY\n' >> ${q('/tmp/' + socketB + '-proof')}; echo BETA_ONLY; sleep 30\r`)
  ]);
  await until(async () => outputA.join('').includes('ALPHA_ONLY') && outputB.join('').includes('BETA_ONLY'));
  assert.doesNotMatch(outputA.join(''), /BETA_ONLY/);
  assert.doesNotMatch(outputB.join(''), /ALPHA_ONLY/);
  const pidA = (await a.checked(`${a.prefix} display-message -p -t ${q(pa.paneId)} ${q('#{pane_pid}')}`)).trim();
  const pidB = (await b.checked(`${b.prefix} display-message -p -t ${q(pb.paneId)} ${q('#{pane_pid}')}`)).trim();
  a.closeView(pa.key); b.closeView(pb.key); a.disconnect(); b.disconnect();
  a = fixture(socketA, aOptions); b = fixture(socketB, bOptions);
  await Promise.all([a.connect(), b.connect()]);
  assert.equal(a.panes[0].key, pa.key); assert.equal(b.panes[0].key, pb.key);
  assert.equal((await a.checked(`${a.prefix} display-message -p -t ${q(pa.paneId)} ${q('#{pane_pid}')}`)).trim(), pidA);
  assert.equal((await b.checked(`${b.prefix} display-message -p -t ${q(pb.paneId)} ${q('#{pane_pid}')}`)).trim(), pidB);
  assert.equal((await a.checked(`cat ${q('/tmp/' + socketA + '-proof')}`)).trim(), 'ALPHA_ONLY');
  assert.equal((await b.checked(`cat ${q('/tmp/' + socketB + '-proof')}`)).trim(), 'BETA_ONLY');
  await Promise.all([a.endSession(pa.key), b.endSession(pb.key)]);
});
