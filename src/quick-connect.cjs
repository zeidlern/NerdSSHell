'use strict';
// Pure Quick Connect address/default/history validation. No credentials or I/O.
const { isIP } = require('node:net');
const MAX_RECENT = 50;
function record(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Invalid ' + label + '.');
  return value;
}
function hostName(value) {
  if (typeof value !== 'string' || value.length > 253 || /[\x00-\x20\x7f]/.test(value)) throw new Error('Enter an IP address or DNS name, not a command.');
  const host = value.toLowerCase();
  if (!host) throw new Error('Enter an IP address or DNS name.');
  if (isIP(host) === 4) return host;
  if (host.includes(':')) {
    const parts = host.split('%');
    if (parts.length > 2 || isIP(parts[0]) !== 6 || parts.length === 2 && !/^[a-z0-9_.-]{1,32}$/.test(parts[1])) throw new Error('Invalid IPv6 address.');
    return host;
  }
  if (/^\d+(?:\.\d+){3}$/.test(host)) throw new Error('Invalid IPv4 address.');
  const dns = host.endsWith('.') ? host.slice(0, -1) : host;
  if (!dns.split('.').every(label => /^[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/.test(label))) throw new Error('Invalid DNS name.');
  return host;
}
function username(value, optional = false) {
  if (typeof value !== 'string' || value.length > 128 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('Invalid username.');
  const name = value.trim();
  if (!(optional && name === '') && !/^[A-Za-z0-9_][A-Za-z0-9_.@-]*$/.test(name)) throw new Error('Invalid username.');
  return name;
}
function port(value) {
  if (!(typeof value === 'number' || typeof value === 'string' && /^\d{1,5}$/.test(value)) || !Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 65535) throw new Error('Port must be between 1 and 65535.');
  return Number(value);
}
function settings(value = {}) {
  record(value, ['username','port','auth','keyPath','historyEnabled'], 'Quick Connect settings');
  const auth = value.auth === undefined ? 'password' : value.auth;
  if (!['password','agent','key'].includes(auth)) throw new Error('Unsupported sign-in method.');
  const keyPath = value.keyPath === undefined ? '' : value.keyPath;
  if (typeof keyPath !== 'string' || keyPath.length > 4096 || /[\x00-\x1f\x7f]/.test(keyPath) || auth === 'key' && !keyPath.trim()) throw new Error('Choose a private key file.');
  if (value.historyEnabled !== undefined && typeof value.historyEnabled !== 'boolean') throw new Error('Recent history must be on or off.');
  return { username: username(value.username === undefined ? '' : value.username, true), port: port(value.port === undefined ? 22 : value.port), auth, keyPath, historyEnabled: value.historyEnabled !== false };
}
function parseAddress(value, defaults = {}) {
  const config = settings(defaults);
  if (typeof value !== 'string' || value.length > 512 || /[\x00-\x1f\x7f]/.test(value)) throw new Error('Enter one IP address or DNS name.');
  let input = value.trim();
  if (/^ssh:\/\//i.test(input)) { input = input.slice(6); if (input.endsWith('/')) input = input.slice(0,-1); }
  if (!input || /[\s/\\?#]/.test(input)) throw new Error('Enter a destination, not a command or URL path.');
  let name = config.username;
  const at = input.lastIndexOf('@');
  if (at >= 0) { name = username(input.slice(0,at)); input = input.slice(at+1); }
  let host, targetPort = config.port;
  if (input.startsWith('[')) {
    const match = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(input);
    if (!match || isIP(match[1].split('%')[0]) !== 6) throw new Error('Use [IPv6-address]:port for an IPv6 port override.');
    host = hostName(match[1]); if (match[2] !== undefined) targetPort = port(match[2]);
  } else if (isIP(input.split('%')[0]) === 6) host = hostName(input);
  else {
    const colon = input.indexOf(':');
    if (colon >= 0) { if (input.indexOf(':',colon+1) >= 0) throw new Error('Invalid destination.'); targetPort = port(input.slice(colon+1)); input = input.slice(0,colon); }
    host = hostName(input);
  }
  return { host, port: targetPort, username: name };
}
function recent(value = []) {
  if (!Array.isArray(value) || value.length > MAX_RECENT) throw new Error('Recent destinations exceed their limit.');
  const result = [], seen = new Set();
  for (const entry of value) {
    record(entry, ['host','port','username'], 'recent destination');
    const target = { host: hostName(entry.host), port: port(entry.port), username: username(entry.username) };
    const identity = JSON.stringify([target.host,target.port,target.username]);
    if (!seen.has(identity)) { result.push(target); seen.add(identity); }
  }
  return result;
}
function addRecent(value, target) {
  const prior = recent(value), checked = recent([{host:target.host,port:target.port,username:target.username}])[0];
  return [checked,...prior.filter(item => item.host !== checked.host || item.port !== checked.port || item.username !== checked.username)].slice(0,MAX_RECENT);
}
function formatAddress(target) {
  const checked = recent([{host:target.host,port:target.port,username:target.username}])[0];
  return checked.username + '@' + (checked.host.includes(':') ? '['+checked.host+']' : checked.host) + (checked.port === 22 ? '' : ':'+checked.port);
}
module.exports = { MAX_RECENT, hostName, settings, parseAddress, recent, addRecent, formatAddress };