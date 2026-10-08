'use strict';
const { terminalBaud } = require('./core.cjs');
/** Session-scoped lifecycle operations. Native consent is bound to the original transport. */
function isStandardSession(remote, key) {
  return !!(remote?.profile?.local || remote?.isStandard?.(key) || remote?.shells?.has(key));
}
function installSessionActions({ handle, runtime, connections, forKey, dialog, getWindow, forget, withViewSlot = (_remote, _key, operation) => operation() }) {
  const pending = new Set();
  function capture(key) {
    const r = forKey(key), remote = r.remote, pane = remote.pane(key), token = pane.sessionToken;
    return { r, remote, pane, validate() {
      if (connections.get(r.profile.id) !== r || r.remote !== remote || !remote.connected || remote.closing || remote.pane(key).sessionToken !== token) {
        throw new Error('The session connection or identity changed. Nothing was terminated; review the current session.');
      }
    } };
  }
  async function askOnce(key, options, operation) {
    if (pending.has(key)) throw new Error('Finish the existing confirmation for this session first.');
    if (pending.size >= 16) throw new Error('Too many session confirmations are open. Finish one first.');
    pending.add(key);
    try {
      const answer = await dialog.showMessageBox(getWindow(), { ...options, defaultId: 1, cancelId: 1, noLink: true });
      if (answer.response !== 0) return false;
      return await operation();
    } finally { pending.delete(key); }
  }
  handle('create', (id, name, persistent = true, baud) => {
    if (typeof persistent !== 'boolean') throw new Error('Choose whether the new session is persistent.');
    if (baud !== undefined) terminalBaud(baud);
    const remote = runtime(id).remote;
    if (baud !== undefined && (remote.profile.local || persistent)) throw new Error('Terminal baud overrides apply only to new Standard SSH shells.');
    return withViewSlot(remote, undefined, () => remote.profile.local ? remote.create(name) : remote.createSession(name, persistent, baud));
  });
  handle('close', async key => {
    if (typeof key !== 'string' || key.length > 240) throw new Error('Invalid session.');
    const remote = connections.get(key.split('/')[0])?.remote;
    if (!remote?.shells?.has(key)) { forget(key); remote?.closeView(key); return true; }
    const owner = capture(key), view = remote.views.get(key);
    return askOnce(key, { type: 'question', title: remote.profile.local ? 'End local session?' : 'Close standard SSH shell?',
      message: remote.profile.local ? 'Closing this tab terminates its local shell and running processes.' : 'Closing this tab closes its console.', detail: 'This session is not persistent and cannot be reattached.', buttons: [remote.profile.local ? 'End session' : 'Disconnect', 'Cancel'] }, () => {
      owner.validate();
      if (remote.views.get(key) !== view) throw new Error('The session view changed. Nothing was closed.');
      forget(key); remote.closeView(key); return true;
    });
  });
  handle('end', async key => {
    const owner = capture(key), { r, remote, pane } = owner;
    const count = remote.panes.filter(p => p.sessionId === pane.sessionId && p.sessionToken === pane.sessionToken).length;
    return askOnce(key, { type: 'warning', title: 'End session',
      message: `Are you sure you want to end “${pane.sessionName}” on ${r.profile.name}?`,
      detail: `This terminates all ${count} terminal pane(s) in this session, including their running work.`, buttons: ['End session', 'Cancel'] }, async () => {
      owner.validate(); await remote.endSession(key); forget(key); return true;
    });
  });
}
module.exports = { installSessionActions, isStandardSession };
