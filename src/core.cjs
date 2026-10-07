'use strict';
const { randomUUID, createHash, createHmac, timingSafeEqual } = require('node:crypto');
const { MAX_DISCOVERED_PANES, resourceLimitError } = require('./session-limits.cjs');

function text(value, label, max = 4096) {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new Error(`Invalid ${label}.`);
  return value;
}
function integer(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${label} (${min}–${max}).`);
  return value;
}
// Match the app's maximum supported live geometry before allocating renderer cells.
function geometry(cols, rows) {
  return { cols: integer(cols, 1, 1000, 'remote columns'), rows: integer(rows, 1, 500, 'remote rows') };
}
function pasteText(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 1024 * 1024) throw new Error('Clipboard exceeds 1 MB. Upload a file instead.');
  // Ordinary keyboard events still carry Ctrl+C etc. Only clipboard text is checked here.
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(value)) throw new Error('Clipboard contains terminal control characters. Paste was blocked; upload a file to transfer non-text data.');
  return value;
}
function id(value, prefix) {
  if (typeof value !== 'string' || !new RegExp(`^\\${prefix}[0-9]+$`).test(value)) throw new Error('Invalid remote identifier.');
  return value;
}
function shellQuote(value) { return `'${String(value).replace(/'/g, `'\\''`)}'`; }
function sessionName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/.test(value)) throw new Error('Use 1–64 letters, numbers, spaces, hyphens or underscores; start with a letter or number.');
  return value;
}
function profile(value) {
  if (!value || typeof value !== 'object') throw new Error('Connection settings are required.');
  const host = text(value.host, 'host', 253).trim();
  const username = text(value.username, 'username', 128).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9.:-]*$/.test(host)) throw new Error('Enter a hostname or IP address, not an SSH command.');
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.@-]*$/.test(username)) throw new Error('Invalid username.');
  const sessionMode = value.sessionMode ?? 'persistent';
  if (!['persistent', 'standard'].includes(sessionMode)) throw new Error('Invalid session mode.');
  const auth = value.auth || 'agent';
  if (!['agent', 'key', 'password'].includes(auth)) throw new Error('Unsupported sign-in method.');
  const remember = value.rememberPassword ?? false;
  if (typeof remember !== 'boolean') throw new Error('Remember password must be on or off.');
  const rememberPassword = auth === 'password' && remember;
  const uuid = value.id || randomUUID();
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(uuid)) throw new Error('Invalid connection ID.');
  const socket = text(value.socket || '', 'session socket', 64);
  if (socket && !/^[A-Za-z0-9_-]+$/.test(socket)) throw new Error('Invalid session socket name.');
  const startup = value.startup || 'all';
  if (!['all', 'restore', 'none'].includes(startup)) throw new Error('Invalid startup policy.');
  const keyPath = text(value.keyPath || '', 'private key path');
  if (auth === 'key' && !keyPath) throw new Error('Choose a private key file.');
  // Deliberate allowlist: plaintext passwords, arbitrary SSH options and renderer-supplied fields are never persisted.
  return { id: uuid, sessionMode, name: text(value.name || host, 'connection name', 80), host, username,
    port: integer(Number(value.port ?? 22), 1, 65535, 'port'), auth, rememberPassword, keyPath, socket,
    autoConnect: value.autoConnect !== false, startup, record: value.record === true,
    scrollback: integer(Number(value.scrollback ?? 100000), 1000, 500000, 'scrollback'),
    archiveMB: integer(Number(value.archiveMB ?? 256), 16, 4096, 'archive size'),
    uploadDirectory: text(value.uploadDirectory || '~/NerdSSHell-Uploads', 'upload directory') };
}
function tmuxPrefix(p) { return 'tmux' + (p.socket ? ` -L ${shellQuote(p.socket)}` : ''); }
function unescapeOctal(input) {
  const src = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const dst = Buffer.allocUnsafe(src.length); let w = 0;
  for (let r = 0; r < src.length; r++) {
    if (src[r] === 92 && r + 3 < src.length && src[r + 1] >= 48 && src[r + 1] <= 51 &&
      src[r + 2] >= 48 && src[r + 2] <= 55 && src[r + 3] >= 48 && src[r + 3] <= 55) {
      dst[w++] = (src[r + 1] - 48) * 64 + (src[r + 2] - 48) * 8 + src[r + 3] - 48; r += 3;
    } else dst[w++] = src[r];
  }
  return dst.subarray(0, w);
}
function unescapeFormat(s) { return s.replace(/\\(.)/g, '$1'); }
const SESSION_IDENTITY_OPTION = '@nerdsshell-id';
// Existing remote work keeps its original stable token throughout migration.
const LEGACY_SESSION_IDENTITY_OPTION = '@betterssh-id';
const SESSION_IDENTITY_FORMAT = `#{${SESSION_IDENTITY_OPTION}}|#{${LEGACY_SESSION_IDENTITY_OPTION}}`;
function parseSessionIdentity(value) {
  const pair = value.split('|');
  if (pair.length > 2) throw new Error('Invalid session identity.');
  // Old 13-column records used only the legacy token in this column.
  const [current, legacy] = pair.length === 1 ? ['', pair[0]] : pair;
  for (const token of [current, legacy]) if (token && !/^[a-f0-9-]{36}$/.test(token)) throw new Error('Invalid session identity.');
  if (current && legacy && current !== legacy) throw new Error('Conflicting remote session identities. No session was changed.');
  return { sessionToken: current || legacy, sessionIdentityOption: current ? SESSION_IDENTITY_OPTION : legacy ? LEGACY_SESSION_IDENTITY_OPTION : null };
}
const PANE_FORMAT = '#{session_id}\t#{q:session_name}\t#{window_id}\t#{window_index}\t#{q:window_name}\t#{pane_id}\t#{pane_index}\t#{pane_width}\t#{pane_height}\t#{pane_dead}\t' + SESSION_IDENTITY_FORMAT + '\t#{window_panes}\t#{q:pane_current_command}';
function parsePanes(data) {
  const result = [];
  for (const line of data.replace(/\n+$/, '').split('\n')) {
    if (!line) continue;
    if (result.length >= MAX_DISCOVERED_PANES) throw resourceLimitError(`The server session list exceeds the ${MAX_DISCOVERED_PANES}-pane safety limit. No sessions were changed.`);
    const a = line.split('\t');
    if (a.length !== 13) throw new Error('The server returned an unrecognized session list.');
    result.push({ sessionId: id(a[0], '$'), sessionName: unescapeFormat(a[1]), windowId: id(a[2], '@'),
      windowIndex: Number(a[3]), windowName: unescapeFormat(a[4]), paneId: id(a[5], '%'), paneIndex: Number(a[6]),
      ...geometry(Number(a[7]), Number(a[8])),
      dead: a[9] === '1', ...parseSessionIdentity(a[10]), windowPanes: Number(a[11]), command: unescapeFormat(a[12]) });
  }
  return result;
}
function paneKey(profileId, token, paneId) {
  if (!/^[a-f0-9-]{36}$/.test(token)) throw new Error('Invalid session identity.');
  id(paneId, '%');
  return `${profileId}/${token}/${paneId}`;
}
function restoreOrder(saved, current, policy = 'all') {
  const available = new Set(current); const out = [...new Set(saved)].filter(k => available.has(k));
  if (policy === 'none') return [];
  if (policy === 'all') for (const key of current) if (!out.includes(key)) out.push(key);
  return out;
}
function fingerprint(key) { return 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, ''); }
function hostPatternMatches(pattern, host) {
  if (pattern.startsWith('|1|')) {
    const a = pattern.split('|');
    if (a.length !== 4) return false;
    const actual = createHmac('sha1', Buffer.from(a[2], 'base64')).update(host).digest();
    const expected = Buffer.from(a[3], 'base64');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i').test(host);
}
function knownHostStatus(contents, host, port, key) {
  const target = port === 22 ? host : `[${host}]:${port}`;
  let matched = false, trusted = false;
  for (let line of contents.split(/\r?\n/)) {
    line = line.trim(); if (!line || line.startsWith('#')) continue;
    const fields = line.split(/\s+/); let marker = '';
    if (fields[0].startsWith('@')) marker = fields.shift();
    if (fields.length < 3) continue;
    const patterns = fields[0].split(',');
    if (patterns.some(p => p.startsWith('!') && hostPatternMatches(p.slice(1), target))) continue;
    if (!patterns.some(p => !p.startsWith('!') && hostPatternMatches(p, target))) continue;
    if (marker === '@cert-authority') continue; // Certificate trust is not silently downgraded to raw-key trust.
    const candidate = Buffer.from(fields[2], 'base64');
    const same = candidate.length === key.length && timingSafeEqual(candidate, key);
    if (marker === '@revoked' && same) return 'revoked';
    if (marker === '@revoked') continue;
    matched = true; if (same) trusted = true;
  }
  return trusted ? 'trusted' : matched ? 'changed' : 'unknown';
}
module.exports = { text, integer, geometry, pasteText, id, shellQuote, sessionName, profile, tmuxPrefix, unescapeOctal,
  PANE_FORMAT, parsePanes, paneKey, restoreOrder, fingerprint, knownHostStatus,
  SESSION_IDENTITY_OPTION, LEGACY_SESSION_IDENTITY_OPTION, SESSION_IDENTITY_FORMAT, parseSessionIdentity };
