'use strict';
// Metadata allowlist only. Never walk a connection/client object or capture its errors/secrets.
function boundedText(value, limit = 256) {
  if (typeof value !== 'string') return '';
  return value.slice(0, limit).replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/gu,
    c => `[U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}]`).slice(0, limit);
}
function diagnosticSnapshot(connections, journal, environment) {
  const targets = [];
  for (const [id, r] of connections) {
    if (targets.length >= 64) break;
    const p = r.profile || {};
    targets.push({ target: p.local || id.startsWith('local:') ? 'LOCAL' : 'REMOTE',
      name: boundedText(p.name), host: boundedText(p.host), user: boundedText(p.username),
      state: boundedText(r.state, 32), mode: boundedText(p.sessionMode, 32),
      openViews: Number.isSafeInteger(r.remote?.views?.size) ? r.remote.views.size : 0 });
  }
  return { capturedAt: new Date().toISOString(), version: boundedText(environment.version, 64),
    platform: boundedText(environment.platform, 32), architecture: boundedText(environment.architecture, 32),
    connections: targets, omittedConnections: Math.max(0, connections.size - targets.length),
    events: journal.slice(-100).map(e => ({ at: boundedText(e.at, 40), event: boundedText(e.event, 128), profileId: boundedText(e.profileId, 100) })),
    limits: { connections: 64, events: 100, metadataCharacters: 256 },
    note: 'Snapshot of this app only, not a server-health scan. No terminal output, command bodies, keys or passwords are collected. Connection metadata may identify you; edit before sharing. Controls are displayed as U+ labels. This is not automatic secret redaction.' };
}
module.exports = { boundedText, diagnosticSnapshot };
