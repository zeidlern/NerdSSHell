'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { PUBLIC_LINKS, installPublicLinks } = require('../src/public-links.cjs');

function fixture() {
  let handler; const opened = [];
  installPublicLinks({ handle(name, fn) { assert.equal(name, 'publicLink'); handler = fn; }, shell: { openExternal(url) { opened.push(url); return Promise.resolve(); } } });
  return { open: destination => handler(destination), opened };
}
test('Help opens only the exact project documentation and support destinations', async () => {
  const f = fixture();
  for (const destination of Object.keys(PUBLIC_LINKS)) await f.open(destination);
  assert.deepEqual(f.opened, Object.values(PUBLIC_LINKS));
  for (const url of f.opened) {
    const parsed = new URL(url);
    assert.equal(parsed.protocol, 'https:'); assert.equal(parsed.host, 'github.com');
    assert.equal(parsed.username + parsed.password + parsed.search + parsed.hash, '');
    assert.ok(parsed.pathname === '/zeidlern/NerdSSHell' || parsed.pathname.startsWith('/zeidlern/NerdSSHell/'));
  }
});
test('Help rejects arbitrary URLs, protocol handlers, coercion and inherited property names before browser I/O', () => {
  const f = fixture();
  for (const destination of [null, undefined, {}, ['manual'], 1, 'https://github.com/zeidlern/NerdSSHell', 'https://attacker.invalid', 'javascript:alert(1)', 'file:///C:/Windows/System32/cmd.exe', 'ms-settings:', 'manual\n', 'constructor', '__proto__', 'toString', { toString: () => 'manual' }]) {
    assert.throws(() => f.open(destination), /Unknown help destination/);
  }
  assert.deepEqual(f.opened, []);
});
test('Browser launch failure is reported to the caller', async () => {
  let handler;
  installPublicLinks({ handle(_name, fn) { handler = fn; }, shell: { openExternal: async () => { throw Error('No browser available'); } } });
  await assert.rejects(handler('manual'), /No browser available/);
});
