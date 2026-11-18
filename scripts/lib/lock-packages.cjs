'use strict';

const assert = require('node:assert/strict');

function lockedPackages(lock, runtimeOnly) {
  const entries = Object.entries(lock.packages);
  const localTargets = new Set();
  for (const [name, entry] of entries) {
    if (!entry.link) continue;
    assert.ok(name.startsWith('node_modules/'), 'Invalid local package link');
    const segments = typeof entry.resolved === 'string' ? entry.resolved.split('/') : [];
    assert.ok(segments.length && segments.every(segment => /^[\w@-][\w.@-]*$/.test(segment) && segment !== 'node_modules'),
      'Local package target must be an ordinary path inside the source tree');
    localTargets.add(entry.resolved);
  }
  const packages = [];
  for (const [name, placement] of entries) {
    if (!name || localTargets.has(name)) continue;
    assert.ok(name.startsWith('node_modules/'), 'Invalid locked package placement');
    // npm records the canonical identity and build/runtime flags on a local link's target.
    const entry = placement.link ? lock.packages[placement.resolved] : placement;
    assert.ok(typeof entry?.version === 'string' && (!placement.link || entry.name), 'Invalid locked package identity');
    if (!runtimeOnly || (!entry.dev && !entry.optional)) packages.push([name, entry]);
  }
  return packages.sort(([a], [b]) => a.localeCompare(b));
}

module.exports = { lockedPackages };
