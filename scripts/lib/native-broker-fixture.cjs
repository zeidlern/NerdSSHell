'use strict';
// Test/acceptance support only. This file is excluded from application packaging.
// The unchanged native helper remains responsible for checking every ancestor,
// owner, ACL, reparse point and native image. Never change the user's real Temp.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PREFIX = 'NerdSSHell-Native-Fixture-';
const MAX_FRAME = 65536;
const MAX_FAILURE = 1024;
const samePath = (first, second) => process.platform === 'win32'
  ? path.normalize(first).toLowerCase() === path.normalize(second).toLowerCase()
  : path.normalize(first) === path.normalize(second);

function fixtureEnvironment(environment, directory) {
  if (!environment || typeof environment !== 'object' || typeof directory !== 'string' ||
      !path.isAbsolute(directory) || directory.length > 1024 || /[\x00-\x1f\x7f]/.test(directory))
    throw new Error('Invalid native fixture environment.');
  const child = { ...environment };
  for (const key of Object.keys(child)) if (['temp', 'tmp'].includes(key.toLowerCase())) delete child[key];
  child.TEMP = directory;
  child.TMP = directory;
  return child;
}

function createNativeBrokerFixture({ profile = os.homedir() } = {}) {
  const home = fs.realpathSync.native(profile);
  const requested = fs.mkdtempSync(path.join(home, PREFIX));
  const directory = fs.realpathSync.native(requested);
  const initial = fs.lstatSync(directory);
  let removed = false;
  function checkOwnedRoot() {
    if (!samePath(path.dirname(directory), home) || !path.basename(directory).startsWith(PREFIX) ||
        !samePath(fs.realpathSync.native(directory), directory)) throw new Error('Native fixture cleanup path changed.');
    const current = fs.lstatSync(directory);
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== initial.dev || current.ino !== initial.ino)
      throw new Error('Native fixture cleanup identity changed.');
  }
  checkOwnedRoot();
  function containsNative() {
    const pending = [directory];
    let count = 0;
    while (pending.length) {
      const parent = pending.pop();
      for (const name of fs.readdirSync(parent)) {
        if (++count > 4096) throw new Error('Native fixture cleanup exceeded its artifact bound.');
        if (/^NerdSSHell-ConPTY-/i.test(name) || /^(?:conpty\.dll|OpenConsole\.exe)$/i.test(name)) return true;
        const current = fs.lstatSync(path.join(parent, name));
        if (current.isSymbolicLink()) throw new Error('Native fixture cleanup found a reparse point.');
        if (current.isDirectory()) pending.push(path.join(parent, name));
      }
    }
    return false;
  }
  return {
    directory,
    environment: environment => fixtureEnvironment(environment, directory),
    async dispose({ timeoutMs = 5000 } = {}) {
      if (removed) return;
      if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 5000) throw new Error('Invalid native fixture cleanup timeout.');
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        checkOwnedRoot();
        if (!containsNative()) break;
        if (Date.now() >= deadline) throw new Error('Native fixture stage or native files survived cleanup; fixture preserved.');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      checkOwnedRoot();
      fs.rmSync(directory, { recursive: true, force: false, maxRetries: 10, retryDelay: 100 });
      removed = true;
    }
  };
}

// Observe a copy of bounded fixture protocol metadata. Terminal data is skipped,
// never retained or exposed; the application's parser and GUI remain unchanged.
function observeFixtureFrames(child, { onFailure = () => {} } = {}) {
  const result = { failure: '', error: '', dispose,
    diagnostic: () => JSON.stringify({ failure: result.failure, error: result.error }) };
  let header = Buffer.alloc(5), headerBytes = 0, remaining = 0, type = '', payload;
  let payloadBytes = 0, stopped = false, failureSeen = false;
  function invalid(message) { result.error ||= message; stopped = true; payload = undefined; }
  function receive(chunk) {
    if (stopped) return;
    let offset = 0;
    while (offset < chunk.length && !stopped) {
      if (headerBytes < 5) {
        const count = Math.min(5 - headerBytes, chunk.length - offset);
        chunk.copy(header, headerBytes, offset, offset + count); headerBytes += count; offset += count;
        if (headerBytes < 5) continue;
        type = String.fromCharCode(header[0]); remaining = header.readUInt32LE(1);
        if (!['D', 'R', 'X', 'E', 'F'].includes(type) || remaining > MAX_FRAME ||
            (['R', 'X'].includes(type) && remaining) || (type === 'E' && remaining !== 4) ||
            (type === 'F' && remaining > MAX_FAILURE)) { invalid('Invalid native fixture frame.'); break; }
        payloadBytes = 0; payload = type === 'F' ? Buffer.alloc(remaining) : undefined;
      }
      const count = Math.min(remaining, chunk.length - offset);
      if (payload) { chunk.copy(payload, payloadBytes, offset, offset + count); payloadBytes += count; }
      remaining -= count; offset += count;
      if (!remaining) {
        if (type === 'F' && !failureSeen) {
          failureSeen = true;
          result.failure = payload.toString('utf8');
          try { onFailure(result.failure); } catch { invalid('Native fixture diagnostic callback failed.'); }
        }
        payload = undefined; headerBytes = 0;
      }
    }
  }
  function end() { if (!stopped && headerBytes) invalid('Truncated native fixture frame.'); }
  function dispose() { stopped = true; payload = undefined; child.stdout.off('data', receive); child.stdout.off('end', end); }
  child.stdout.on('data', receive); child.stdout.on('end', end);
  return result;
}

module.exports = { createNativeBrokerFixture, fixtureEnvironment, observeFixtureFrames };
