'use strict';
const { randomUUID } = require('node:crypto');
const { scriptText } = require('./action-catalog.cjs');

/** Match xterm's paste line endings and negotiated bracketed-paste behavior. */
function commandInput(code, bracketedPaste) {
  if (typeof bracketedPaste !== 'boolean') throw new Error('Invalid terminal paste mode.');
  const text = scriptText(code).replace(/\n/g, '\r');
  // One input event owns the whole paste and its Enter. Other keys/actions
  // cannot interleave between them in the existing per-view transport queue.
  return (bracketedPaste ? '\x1b[200~' + text + '\x1b[201~' : text) + '\r';
}

function installSessionCommands({ handle, connections, forKey, assertInput, resolveAction }) {
  // Weak keys release closed views without retaining their transport or data.
  const targets = new WeakMap();
  function capture(key) {
    if (typeof key !== 'string' || key.length > 240) throw new Error('Choose a valid session.');
    const runtime = forKey(key), remote = runtime.remote, view = remote.views.get(key), pane = remote.pane(key);
    if (!remote.connected || remote.closing || !view?.active || !view.initialized) throw new Error('The session is not ready. Command was not sent.');
    const token = pane.sessionToken, snapshot = view.snapshotSerial, client = remote.client;
    const record = remote.shells?.get(key), stream = record?.stream;
    return { runtime, remote, view, key, validate() {
      if (connections.get(runtime.profile.id) !== runtime || runtime.remote !== remote || !remote.connected || remote.closing ||
          remote.client !== client || remote.views.get(key) !== view || !view.active || !view.initialized ||
          view.snapshotSerial !== snapshot || remote.pane(key).sessionToken !== token ||
          remote.shells?.get(key) !== record || record?.stream !== stream || record?.dead || record?.channelClosed) {
        throw new Error('The session connection or identity changed. Command was not sent or retried. Select it again in the current session.');
      }
    } };
  }
  function context(key) {
    const owner = capture(key), prior = targets.get(owner.view);
    if (prior) {
      try { prior.owner.validate(); return prior.token; } catch { /* A new snapshot requires a new menu target. */ }
    }
    const token = randomUUID(); targets.set(owner.view, { token, owner }); return token;
  }
  handle('paneActionRun', async (key, request) => {
    if (!request || typeof request !== 'object' || Array.isArray(request) ||
        Object.keys(request).some(name => !['target', 'actionId', 'argument', 'bracketedPaste'].includes(name)) ||
        typeof request.target !== 'string' || request.target.length !== 36 ||
        typeof request.actionId !== 'string' || request.actionId.length > 100 ||
        request.argument !== undefined && (typeof request.argument !== 'string' || request.argument.length > 128)) {
      throw new Error('Choose an action from this session’s current menu.');
    }
    const owner = capture(key), target = targets.get(owner.view);
    if (!target || target.token !== request.target || target.owner.key !== key) throw new Error('The session action menu changed. Select the command again.');
    target.owner.validate(); assertInput(key);
    // The main process resolves the stable ID against saved configuration and
    // the real target OS/shell. Renderer code and platform claims are rejected.
    const plan = resolveAction(key, request.actionId, request.argument || '');
    if (plan.shell === 'cmd' && plan.code.split(/\r\n?|\n/).some(line => line.length > 8191)) {
      throw new Error('A Command Prompt input line exceeds 8,191 characters. Command was not sent.');
    }
    const input = commandInput(plan.code, request.bracketedPaste);
    target.owner.validate(); assertInput(key);
    // No await before admission: this queues beside normal terminal input,
    // using the provider's existing ordering, cancellation and resource limits.
    await owner.remote.input(key, input);
    return { key, actionId: request.actionId, title: plan.title };
  });
  return {
    context,
    forget(key) { const view = connections.get(String(key).split('/')[0])?.remote?.views?.get(key); if (view) targets.delete(view); },
    disconnect(id) { for (const view of connections.get(id)?.remote?.views?.values() || []) targets.delete(view); }
  };
}
module.exports = { commandInput, installSessionCommands };
